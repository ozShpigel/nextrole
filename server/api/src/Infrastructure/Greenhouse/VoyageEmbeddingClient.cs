using ApplicationTracker.Core.Greenhouse;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Infrastructure.Greenhouse;

/// <summary>
/// Voyage <c>/v1/embeddings</c>. Handles the two failure modes that are not
/// simply "it broke": a batch too large for the API, and rate limiting.
/// </summary>
public sealed class VoyageEmbeddingClient : IEmbeddingClient
{
    private readonly HttpClient _http;
    private readonly string _model;
    private readonly int _dimensions;
    private readonly ILogger<VoyageEmbeddingClient> _log;
    private readonly TimeSpan _baseDelay;

    /// <summary>
    /// The one embedding client. Both the ingestion project and the API resolve
    /// this exact type, from the same <see cref="GreenhouseEmbeddingOptions"/>.
    /// </summary>
    /// <remarks>
    /// They differ in <c>input_type</c> and nothing else -- <c>document</c> on
    /// write, <c>query</c> on read -- which is why that is a per-call argument
    /// while the model and dimensions are construction-time configuration
    /// neither caller can override.
    /// </remarks>
    public VoyageEmbeddingClient(
        HttpClient http, GreenhouseEmbeddingOptions options, ILogger<VoyageEmbeddingClient> log,
        TimeSpan? baseDelay = null)
    {
        options.Validate();

        _http = http;
        _model = options.Model;
        _dimensions = options.Dimensions;
        _log = log;
        // Injectable so the 429 test does not actually sleep for half a minute.
        _baseDelay = baseDelay ?? TimeSpan.FromSeconds(2);
    }

    private const int MaxRateLimitAttempts = 5;

    public Task<EmbeddingBatchResult> EmbedAsync(
        IReadOnlyList<string> texts, string inputType, CancellationToken ct) =>
        texts.Count == 0
            ? Task.FromResult(new EmbeddingBatchResult([], 0))
            : EmbedWithSplitAsync(texts, inputType, ct);

    /// <summary>
    /// Embed one batch, halving and retrying if the API rejects it as too large.
    /// </summary>
    /// <remarks>
    /// The split is on 400 only, and only when there is more than one text to
    /// split. A 400 on a single text is not a size problem this can solve, so it
    /// propagates: the company fails and lands in the DLQ, rather than that one
    /// job vanishing from a run that reports success.
    ///
    /// Halving rather than re-packing, because the estimate already said this
    /// batch fit. It is the estimate that was wrong, and re-running the same
    /// estimator would produce the same batch.
    /// </remarks>
    private async Task<EmbeddingBatchResult> EmbedWithSplitAsync(
        IReadOnlyList<string> texts, string inputType, CancellationToken ct)
    {
        try
        {
            return await PostAsync(texts, inputType, ct);
        }
        catch (EmbeddingTooLargeException) when (texts.Count > 1)
        {
            var half = texts.Count / 2;
            _log.LogWarning(
                "Voyage rejected a batch of {Count} as too large; splitting into {A} + {B}",
                texts.Count, half, texts.Count - half);

            var left = await EmbedWithSplitAsync([.. texts.Take(half)], inputType, ct);
            var right = await EmbedWithSplitAsync([.. texts.Skip(half)], inputType, ct);

            // Concatenated in order. The halves were taken in order and each
            // half preserves its own, so the result still lines up with `texts`
            // index for index, which is the only thing tying a vector to a job.
            return new EmbeddingBatchResult(
                [.. left.Vectors, .. right.Vectors],
                left.TotalTokens + right.TotalTokens);
        }
        catch (EmbeddingTooLargeException e)
        {
            // A batch of one cannot be split, so the filter above did not
            // match. Without this the private nested type escapes the class and
            // a caller catching EmbeddingException misses it entirely -- the
            // company would still fail, but with an exception nothing declares
            // and nothing documents. Caught by
            // A_single_text_that_is_too_large_fails_rather_than_disappearing.
            throw new EmbeddingException(
                "Voyage rejected a single text as too large, and a batch of one cannot be split further. "
                + $"The posting is beyond what {_model} accepts in one request: {e.Message}", e);
        }
    }

    private async Task<EmbeddingBatchResult> PostAsync(
        IReadOnlyList<string> texts, string inputType, CancellationToken ct)
    {
        var request = new VoyageRequest
        {
            Input = texts,
            Model = _model,
            InputType = inputType,
            OutputDimension = _dimensions,
        };

        for (var attempt = 1; ; attempt++)
        {
            using var response = await _http.PostAsJsonAsync("v1/embeddings", request, ct);

            if (response.StatusCode == HttpStatusCode.TooManyRequests || (int)response.StatusCode >= 500)
            {
                if (attempt >= MaxRateLimitAttempts)
                    throw new EmbeddingException(
                        $"Voyage returned {(int)response.StatusCode} on all {MaxRateLimitAttempts} attempts.");

                // Honour Retry-After when the server sends one; otherwise
                // exponential with jitter. Jitter matters because every company
                // in a fan-out would otherwise back off at the same instant and
                // retry in lockstep.
                var wait = response.Headers.RetryAfter?.Delta
                    ?? TimeSpan.FromMilliseconds(
                        _baseDelay.TotalMilliseconds * Math.Pow(2, attempt - 1)
                        * (0.75 + Random.Shared.NextDouble() * 0.5));

                _log.LogWarning(
                    "Voyage returned {Status}; retrying in {Wait:n1}s (attempt {Attempt}/{Max})",
                    (int)response.StatusCode, wait.TotalSeconds, attempt, MaxRateLimitAttempts);

                await Task.Delay(wait, ct);
                continue;
            }

            if (response.StatusCode == HttpStatusCode.BadRequest)
            {
                var detail = await SafeBodyAsync(response, ct);
                // Only a size complaint is splittable. A malformed request or an
                // unknown model is a 400 too, and halving that forever would turn
                // one configuration mistake into an exponential number of calls.
                if (LooksLikeTooLarge(detail))
                    throw new EmbeddingTooLargeException(detail);

                throw new EmbeddingException($"Voyage rejected the request: {detail}");
            }

            if (!response.IsSuccessStatusCode)
                throw new EmbeddingException(
                    $"Voyage returned {(int)response.StatusCode}: {await SafeBodyAsync(response, ct)}");

            var parsed = await response.Content.ReadFromJsonAsync<VoyageResponse>(ct)
                ?? throw new EmbeddingException("Voyage returned a body that did not parse.");

            return Align(texts, parsed);
        }
    }

    /// <summary>
    /// Zip vectors back to inputs by index, having first proved the zip is valid.
    /// </summary>
    /// <remarks>
    /// <b>Response order is the only thing tying a vector to its text</b>, so
    /// every assumption behind that is checked rather than trusted: the count
    /// must match, every <c>index</c> must appear exactly once and in range, and
    /// every vector must have the dimensions the Atlas index was built for.
    ///
    /// The failure this prevents has no symptom. A misaligned batch stores real
    /// vectors on real jobs, writes the expected number of rows, and logs a
    /// clean run. The only evidence is retrieval returning plausible-looking
    /// nonsense, months later.
    /// </remarks>
    private EmbeddingBatchResult Align(IReadOnlyList<string> texts, VoyageResponse parsed)
    {
        var data = parsed.Data ?? [];

        if (data.Count != texts.Count)
            throw new EmbeddingException(
                $"Voyage returned {data.Count} embeddings for {texts.Count} inputs. "
                + "Refusing to guess which vector belongs to which job.");

        var vectors = new float[texts.Count][];

        foreach (var item in data)
        {
            if (item.Index < 0 || item.Index >= texts.Count)
                throw new EmbeddingException(
                    $"Voyage returned index {item.Index}, outside 0..{texts.Count - 1}.");

            if (vectors[item.Index] is not null)
                throw new EmbeddingException($"Voyage returned index {item.Index} more than once.");

            if (item.Embedding is null || item.Embedding.Length != _dimensions)
                throw new EmbeddingException(
                    $"Voyage returned a {item.Embedding?.Length.ToString() ?? "null"}-dimension vector "
                    + $"at index {item.Index}; the index is built for {_dimensions}.");

            vectors[item.Index] = item.Embedding;
        }

        return new EmbeddingBatchResult(vectors, parsed.Usage?.TotalTokens ?? 0);
    }

    private static bool LooksLikeTooLarge(string detail)
    {
        var d = detail.ToLowerInvariant();
        return d.Contains("too large")
            || d.Contains("max allowed")
            || d.Contains("token limit")
            || d.Contains("exceeds")
            || (d.Contains("tokens") && d.Contains("limit"));
    }

    private static async Task<string> SafeBodyAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            return body.Length > 500 ? body[..500] : body;
        }
        catch
        {
            return "";
        }
    }

    private sealed class EmbeddingTooLargeException : Exception
    {
        public EmbeddingTooLargeException(string message) : base(message) { }
    }

    private sealed record VoyageRequest
    {
        [JsonPropertyName("input")] public required IReadOnlyList<string> Input { get; init; }
        [JsonPropertyName("model")] public required string Model { get; init; }
        [JsonPropertyName("input_type")] public required string InputType { get; init; }
        [JsonPropertyName("output_dimension")] public required int OutputDimension { get; init; }
    }

    private sealed record VoyageResponse
    {
        [JsonPropertyName("data")] public List<VoyageDatum>? Data { get; init; }
        [JsonPropertyName("usage")] public VoyageUsage? Usage { get; init; }
    }

    private sealed record VoyageDatum
    {
        [JsonPropertyName("index")] public int Index { get; init; }
        [JsonPropertyName("embedding")] public float[]? Embedding { get; init; }
    }

    private sealed record VoyageUsage
    {
        [JsonPropertyName("total_tokens")] public int TotalTokens { get; init; }
    }
}
