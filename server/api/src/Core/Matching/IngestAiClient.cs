using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;

namespace ApplicationTracker.Core.Matching;

/// <summary>
/// One posting as the ingest-time AI passes need to see it.
/// </summary>
/// <remarks>
/// Source-neutral on purpose. Both ingests produce it -- PoolIngest from a
/// scraped LinkedIn listing, the Greenhouse ingest from a board posting -- and
/// neither the endpoints nor this client need to know which.
/// </remarks>
/// <param name="JobId">
/// Correlation key. The response is matched back on this, never on position.
/// </param>
public sealed record IngestJob(
    string JobId,
    string Title,
    string? Company,
    string? Location,
    string? Description);

/// <summary>
/// The two user-independent AI passes an ingest runs once per posting:
/// <c>job-facts</c> (stated requirements) and <c>job-parse</c> (the Analyst).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why these run at ingest and not per user.</b> Neither pass sees a
/// profile, so their output cannot differ between users --
/// <c>BuildAnalysisBatchPrompt</c> takes no profile at all. Doing them per user
/// was measured at <b>2.1x the entire global ingest pipeline</b>, spent
/// recomputing something identical every time. Running them once and storing
/// the result on the job is what leaves the per-user scan with a single
/// Evaluator call.
/// </para>
/// <para>
/// <b>It also keeps a guard honest.</b> <c>EnforceEvidenceCaps</c> constrains
/// the Evaluator using the Analyst's reading, and <c>ClaimGrounding</c>
/// computes the gap list from <c>must_have_tech</c>. Both only mean something
/// because a DIFFERENT call produced the evidence: a model that authors the
/// numbers its own cap is computed from is not capped at all (AGENTS.md, and
/// the Zscaler case -- 12 absent requirements, 1 self-reported gap, 20/20).
/// </para>
/// <para>
/// <b>It holds no credential and acts as nobody.</b> No session token, no user
/// identity -- these endpoints read no profile and score nothing. The caller
/// supplies <c>X-Api-Key</c> and <c>X-Source</c> on the HttpClient.
/// </para>
/// <para>
/// Lives in Core so both ingests share ONE implementation. The camelCase ->
/// snake_case mapping below has to agree with thousands of existing rows, and
/// a second copy of it is a second thing to get wrong.
/// </para>
/// </remarks>
public sealed class IngestAiClient
{
    private readonly HttpClient _http;
    private readonly ILogger _log;

    public IngestAiClient(HttpClient http, ILogger log)
    {
        _http = http;
        _log = log;
    }

    /// <summary>
    /// Stated requirements for jobs entering a pool, keyed by job id.
    /// </summary>
    /// <remarks>
    /// Returns what it got rather than throwing. A chunk that fails contributes
    /// nothing and is retried on a later run: a posting is worth keeping even
    /// when the facts about it are not available yet.
    /// </remarks>
    public async Task<Dictionary<string, BsonDocument>> ExtractFactsAsync(
        IReadOnlyList<IngestJob> jobs, CancellationToken ct)
    {
        if (jobs.Count == 0) return [];

        var body = new
        {
            jobs = jobs.Select(j => new
            {
                jobId = j.JobId,
                title = j.Title,
                company = j.Company,
                location = j.Location,
                description = j.Description,
            }),
        };

        try
        {
            using var response = await _http.PostAsJsonAsync("/api/match/job-facts", body, ct);
            if (!response.IsSuccessStatusCode)
            {
                _log.LogWarning("job-facts returned {Status} for a chunk of {Count}; retried next run",
                    (int)response.StatusCode, jobs.Count);
                return [];
            }

            return FactsFrom(await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct));
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _log.LogWarning(e, "job-facts failed for a chunk of {Count}; retried next run", jobs.Count);
            return [];
        }
    }

    /// <summary>The ingest's Analyst read, plus the version stamp it was produced under.</summary>
    /// <remarks>
    /// A failure here is not fatal either: the scan falls through to an inline
    /// Analyst call for that job only, which is the behaviour that existed
    /// before the cache, so a miss is never worse than no cache.
    /// </remarks>
    public async Task<(Dictionary<string, BsonDocument> Parsed, string? Version)> ParseAsync(
        IReadOnlyList<IngestJob> jobs, CancellationToken ct)
    {
        if (jobs.Count == 0) return ([], null);

        var body = new
        {
            jobs = jobs.Select(j => new
            {
                jobId = j.JobId,
                title = j.Title,
                company = j.Company,
                description = j.Description,
            }),
        };

        try
        {
            using var response = await _http.PostAsJsonAsync("/api/match/job-parse", body, ct);
            if (!response.IsSuccessStatusCode)
            {
                _log.LogWarning("job-parse returned {Status} for a chunk of {Count}; the scan parses inline",
                    (int)response.StatusCode, jobs.Count);
                return ([], null);
            }

            var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
            var version = payload.TryGetProperty("parseVersion", out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString()
                : null;
            return (ParsedFrom(payload), version);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _log.LogWarning(e, "job-parse failed for a chunk of {Count}; the scan parses inline", jobs.Count);
            return ([], null);
        }
    }

    /// <summary>Chunk size for <see cref="ExtractFactsAsync"/>. The endpoint rejects more than 200.</summary>
    public const int FactsChunkSize = 50;

    /// <summary>
    /// Chunk size for <see cref="ParseAsync"/>. The endpoint rejects more than 25.
    /// </summary>
    /// <remarks>
    /// Lower than the facts chunk because a parse emits a full ParsedJob per
    /// job (~746 output tokens at the median, measured over 813 postings), so
    /// the RESPONSE bounds the batch, not the request. Overflowing max_tokens
    /// loses every job in the batch and cannot be fixed by retrying.
    /// </remarks>
    public const int ParseChunkSize = 10;

    /// <remarks>
    /// The API answers camelCase; the stored <c>extracted</c> document is
    /// snake_case, because the scraper wrote it that way and thousands of rows
    /// already carry those names. The mapping is here rather than at the write,
    /// so the one place that has to agree with history is the one place that
    /// talks to the API.
    /// </remarks>
    private static Dictionary<string, BsonDocument> FactsFrom(JsonElement payload)
    {
        var facts = new Dictionary<string, BsonDocument>();
        if (!payload.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array)
            return facts;

        foreach (var r in results.EnumerateArray())
        {
            var jobId = Str(r, "jobId");
            if (string.IsNullOrEmpty(jobId)) continue;

            facts[jobId] = new BsonDocument
            {
                { "required_years", Num(r, "requiredYears") },
                { "must_have_tech", Strings(r, "mustHaveTech") },
                { "nice_to_have_tech", Strings(r, "niceToHaveTech") },
                { "seniority", (BsonValue?)Str(r, "seniority") ?? BsonNull.Value },
                { "domain", (BsonValue?)Str(r, "domain") ?? BsonNull.Value },
                { "location", (BsonValue?)Str(r, "location") ?? BsonNull.Value },
            };
        }
        return facts;
    }

    // Correlating by jobId rather than by position is deliberate and
    // load-bearing: a response the caller cannot line up must contribute
    // nothing rather than fall back to list order, which would attach one
    // job's parse to another. Two independently deployed services make that a
    // real window, not a theoretical one.
    private static Dictionary<string, BsonDocument> ParsedFrom(JsonElement payload)
    {
        var parsed = new Dictionary<string, BsonDocument>();
        if (!payload.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array)
            return parsed;

        foreach (var r in results.EnumerateArray())
        {
            var jobId = Str(r, "jobId");
            if (string.IsNullOrEmpty(jobId)) continue;
            if (!r.TryGetProperty("parsed", out var doc) || doc.ValueKind != JsonValueKind.Object) continue;

            parsed[jobId] = BsonDocument.Parse(doc.GetRawText());
        }
        return parsed;
    }

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static BsonValue Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
            ? new BsonInt32(v.GetInt32())
            : BsonNull.Value;

    private static BsonArray Strings(JsonElement e, string name)
    {
        var array = new BsonArray();
        if (e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array)
            foreach (var item in v.EnumerateArray())
                if (item.ValueKind == JsonValueKind.String) array.Add(item.GetString());
        return array;
    }
}
