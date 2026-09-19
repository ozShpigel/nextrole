using System.Net;
using System.Text.Json;
using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Greenhouse;
using ApplicationTracker.Infrastructure.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// Vector-to-job alignment, split-and-retry on a 400, and 429 handling.
/// </summary>
/// <remarks>
/// Alignment gets the most attention here because its failure mode has no
/// symptom: a misaligned batch writes real vectors onto real jobs, produces the
/// expected row count and logs a clean run. Nothing downstream can tell.
/// </remarks>
public class VoyageEmbeddingClientTests
{
    private const int Dims = 4;

    private static VoyageEmbeddingClient Client(StubHandler handler, int dimensions = Dims) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("https://api.voyageai.com/") },
            new GreenhouseEmbeddingOptions { Model = "voyage-4", Dimensions = dimensions, ApiKey = "test-key" },
            NullLogger<VoyageEmbeddingClient>.Instance,
            // Tests must not actually sleep through a backoff.
            baseDelay: TimeSpan.FromMilliseconds(1));

    private static string EmbeddingsJson(int totalTokens, params (int Index, float[] Vector)[] items)
    {
        var data = items.Select(i =>
            $$"""{ "object": "embedding", "index": {{i.Index}}, "embedding": [{{string.Join(",", i.Vector.Select(v => v.ToString(System.Globalization.CultureInfo.InvariantCulture)))}}] }""");

        return $$"""{ "object": "list", "data": [{{string.Join(",", data)}}], "model": "voyage-4", "usage": { "total_tokens": {{totalTokens}} } }""";
    }

    private static float[] Vec(float seed) => [seed, seed, seed, seed];

    // ---- alignment ---------------------------------------------------------

    [Fact]
    public async Task Zips_vectors_to_inputs_by_index_not_by_arrival_order()
    {
        // The API is documented to return results in input order, but `index`
        // is what actually binds a vector to its text. Returned here shuffled
        // on purpose: reading positionally would give every text the wrong
        // vector, and nothing would notice.
        var handler = new StubHandler().EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(
            42,
            (2, Vec(30f)),
            (0, Vec(10f)),
            (1, Vec(20f))));

        var result = await Client(handler).EmbedAsync(["a", "b", "c"], "document", default);

        Assert.Equal(Vec(10f), result.Vectors[0]);
        Assert.Equal(Vec(20f), result.Vectors[1]);
        Assert.Equal(Vec(30f), result.Vectors[2]);
        Assert.Equal(42, result.TotalTokens);
    }

    [Fact]
    public async Task Throws_when_the_count_does_not_match()
    {
        var handler = new StubHandler().EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(
            10, (0, Vec(1f)), (1, Vec(2f))));

        var e = await Assert.ThrowsAsync<EmbeddingException>(() =>
            Client(handler).EmbedAsync(["a", "b", "c"], "document", default));

        Assert.Contains("Refusing to guess", e.Message);
    }

    [Fact]
    public async Task Throws_when_an_index_is_repeated()
    {
        // Count matches, so a naive check passes -- but index 1 was never
        // returned, which means one input has no vector and another has two.
        var handler = new StubHandler().EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(
            10, (0, Vec(1f)), (0, Vec(2f))));

        await Assert.ThrowsAsync<EmbeddingException>(() =>
            Client(handler).EmbedAsync(["a", "b"], "document", default));
    }

    [Fact]
    public async Task Throws_when_an_index_is_out_of_range()
    {
        var handler = new StubHandler().EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(
            10, (0, Vec(1f)), (7, Vec(2f))));

        await Assert.ThrowsAsync<EmbeddingException>(() =>
            Client(handler).EmbedAsync(["a", "b"], "document", default));
    }

    [Fact]
    public async Task Throws_when_the_dimensions_are_not_what_the_index_expects()
    {
        // A 1024-stored / 512-queried mismatch does not fail at query time --
        // $vectorSearch just returns nothing, which reads as "no candidates".
        // Catching it at write time is the only place it is loud.
        var handler = new StubHandler().EnqueueJson(HttpStatusCode.OK,
            """{ "data": [ { "index": 0, "embedding": [1,2] } ], "usage": { "total_tokens": 1 } }""");

        var e = await Assert.ThrowsAsync<EmbeddingException>(() =>
            Client(handler).EmbedAsync(["a"], "document", default));

        Assert.Contains("dimension", e.Message);
    }

    // ---- request shape -----------------------------------------------------

    [Fact]
    public async Task Sends_the_model_dimensions_and_input_type()
    {
        var handler = new StubHandler().EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(1, (0, Vec(1f))));

        await Client(handler).EmbedAsync(["a"], "query", default);

        using var sent = JsonDocument.Parse(handler.RequestBodies[0]);
        Assert.Equal("voyage-4", sent.RootElement.GetProperty("model").GetString());
        Assert.Equal("query", sent.RootElement.GetProperty("input_type").GetString());
        Assert.Equal(Dims, sent.RootElement.GetProperty("output_dimension").GetInt32());
    }

    [Fact]
    public async Task An_empty_batch_costs_no_call()
    {
        var handler = new StubHandler();
        var result = await Client(handler).EmbedAsync([], "document", default);

        Assert.Empty(result.Vectors);
        Assert.Equal(0, handler.Calls);
    }

    // ---- split and retry on 400 -------------------------------------------

    [Fact]
    public async Task Splits_and_retries_when_the_batch_is_rejected_as_too_large()
    {
        var handler = new StubHandler()
            .EnqueueJson(HttpStatusCode.BadRequest,
                """{ "detail": "The total number of tokens exceeds the max allowed 320000" }""")
            .EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(5, (0, Vec(1f)), (1, Vec(2f))))
            .EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(7, (0, Vec(3f)), (1, Vec(4f))));

        var result = await Client(handler).EmbedAsync(["a", "b", "c", "d"], "document", default);

        Assert.Equal(3, handler.Calls);
        // Halves concatenated in order: the vectors still line up with the
        // inputs index for index, which is the whole point of splitting this
        // way rather than re-packing.
        Assert.Equal([Vec(1f), Vec(2f), Vec(3f), Vec(4f)], result.Vectors);
        // Both halves' usage is summed, so the cost report stays honest across
        // a split.
        Assert.Equal(12, result.TotalTokens);
    }

    [Fact]
    public async Task Splits_recursively_when_a_half_is_still_too_large()
    {
        var tooLarge = """{ "detail": "batch is too large" }""";
        var handler = new StubHandler()
            .EnqueueJson(HttpStatusCode.BadRequest, tooLarge)                                  // 4
            .EnqueueJson(HttpStatusCode.BadRequest, tooLarge)                                  // left 2
            .EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(1, (0, Vec(1f))))                   // left 1
            .EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(1, (0, Vec(2f))))                   // left 1
            .EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(2, (0, Vec(3f)), (1, Vec(4f))));    // right 2

        var result = await Client(handler).EmbedAsync(["a", "b", "c", "d"], "document", default);

        Assert.Equal([Vec(1f), Vec(2f), Vec(3f), Vec(4f)], result.Vectors);
    }

    [Fact]
    public async Task A_single_text_that_is_too_large_fails_rather_than_disappearing()
    {
        // A batch of one cannot be split. Failing here sends the company to the
        // DLQ; silently dropping the job would let a run report success while
        // one posting is missing forever.
        var handler = new StubHandler()
            .EnqueueJson(HttpStatusCode.BadRequest, """{ "detail": "too large" }""");

        await Assert.ThrowsAsync<EmbeddingException>(() =>
            Client(handler).EmbedAsync(["a"], "document", default));

        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task A_400_that_is_not_about_size_is_not_split()
    {
        // An unknown model is a 400 too. Halving it would turn one config
        // mistake into an exponential number of calls against a billed API.
        var handler = new StubHandler()
            .EnqueueJson(HttpStatusCode.BadRequest, """{ "detail": "Model nonsense-1 not found" }""");

        var e = await Assert.ThrowsAsync<EmbeddingException>(() =>
            Client(handler).EmbedAsync(["a", "b", "c", "d"], "document", default));

        Assert.Equal(1, handler.Calls);
        Assert.Contains("not found", e.Message);
    }

    // ---- 429 ---------------------------------------------------------------

    [Fact]
    public async Task Retries_a_429_and_succeeds()
    {
        var handler = new StubHandler()
            .EnqueueJson(HttpStatusCode.TooManyRequests, """{ "detail": "rate limited" }""")
            .EnqueueJson(HttpStatusCode.TooManyRequests, """{ "detail": "rate limited" }""")
            .EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(9, (0, Vec(1f))));

        var result = await Client(handler).EmbedAsync(["a"], "document", default);

        Assert.Equal(3, handler.Calls);
        Assert.Equal(Vec(1f), result.Vectors[0]);
    }

    [Fact]
    public async Task Honours_Retry_After_when_the_server_sends_one()
    {
        var handler = new StubHandler()
            .Enqueue(_ =>
            {
                var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
                response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(
                    TimeSpan.FromMilliseconds(5));
                return response;
            })
            .EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(1, (0, Vec(1f))));

        var result = await Client(handler).EmbedAsync(["a"], "document", default);

        Assert.Equal(2, handler.Calls);
        Assert.Single(result.Vectors);
    }

    [Fact]
    public async Task Gives_up_after_the_attempt_cap_rather_than_retrying_forever()
    {
        var handler = new StubHandler();
        for (var i = 0; i < 10; i++)
            handler.EnqueueJson(HttpStatusCode.TooManyRequests, """{ "detail": "rate limited" }""");

        var e = await Assert.ThrowsAsync<EmbeddingException>(() =>
            Client(handler).EmbedAsync(["a"], "document", default));

        // Bounded: a company that cannot be embedded must reach the DLQ, not
        // occupy the consumer indefinitely.
        Assert.Equal(5, handler.Calls);
        Assert.Contains("429", e.Message);
    }

    [Fact]
    public async Task Retries_a_500_on_the_same_path_as_a_429()
    {
        var handler = new StubHandler()
            .EnqueueJson(HttpStatusCode.InternalServerError, "boom")
            .EnqueueJson(HttpStatusCode.OK, EmbeddingsJson(1, (0, Vec(1f))));

        var result = await Client(handler).EmbedAsync(["a"], "document", default);

        Assert.Equal(2, handler.Calls);
        Assert.Single(result.Vectors);
    }
}
