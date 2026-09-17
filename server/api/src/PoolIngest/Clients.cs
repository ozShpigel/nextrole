using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;

namespace ApplicationTracker.PoolIngest;

// ── The scrape (listings / the Python service) ──────────────────────────────

public sealed record ScrapedJob
{
    [JsonPropertyName("id")] public string Id { get; init; } = "";
    [JsonPropertyName("title")] public string Title { get; init; } = "";
    [JsonPropertyName("company")] public string Company { get; init; } = "";
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("job_url")] public string? JobUrl { get; init; }
    [JsonPropertyName("date_posted")] public string? DatePosted { get; init; }
    [JsonPropertyName("site")] public string? Site { get; init; }
    [JsonPropertyName("job_level")] public string? JobLevel { get; init; }
    [JsonPropertyName("is_remote")] public bool? IsRemote { get; init; }
    [JsonPropertyName("company_logo")] public string? CompanyLogo { get; init; }
    [JsonPropertyName("company_profile")] public Dictionary<string, object?>? CompanyProfile { get; init; }
}

public sealed record ScrapeStats
{
    [JsonPropertyName("searches_total")] public int SearchesTotal { get; init; }
    [JsonPropertyName("searches_failed")] public int SearchesFailed { get; init; }
    [JsonPropertyName("searches_empty")] public int SearchesEmpty { get; init; }
}

public sealed record ScrapeResponse
{
    [JsonPropertyName("jobs")] public List<ScrapedJob> Jobs { get; init; } = [];
    [JsonPropertyName("stats")] public ScrapeStats Stats { get; init; } = new();
}

/// <summary>
/// The jobspy adapter, over HTTP.
/// </summary>
/// <remarks>
/// The only reason this is a network call rather than a function call is that
/// jobspy is Python. Packaging both runtimes into one image to shell out would
/// roughly double it and give one image two dependency trees; reaching the
/// other container over the Docker socket would hand the Docker daemon to a
/// process that parses hostile HTML. An HTTP call is the cheap option.
/// </remarks>
public sealed class ScrapeClient
{
    private readonly HttpClient _http;
    private readonly ILogger<ScrapeClient> _log;

    public ScrapeClient(HttpClient http, ILogger<ScrapeClient> log)
    {
        _http = http;
        _log = log;
    }

    public async Task<ScrapeResponse> ScrapeAsync(RolesConfig config, List<string> roles, CancellationToken ct)
    {
        var body = new
        {
            job_titles = roles,
            locations = config.Locations,
            site_names = config.SiteNames,
            results_wanted = config.ResultsWanted,
            hours_old = config.HoursOld,
            country = config.Country,
        };

        _log.LogInformation("Scraping {Roles} role(s) x {Locations} location(s)",
            roles.Count, config.Locations.Count);

        using var response = await _http.PostAsJsonAsync("/scrape", body, ct);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<ScrapeResponse>(cancellationToken: ct)
            ?? throw new InvalidOperationException("Scrape returned no body.");

        _log.LogInformation(
            "Scraped {Jobs} job(s) over {Total} search(es) ({Failed} failed, {Empty} empty)",
            result.Jobs.Count, result.Stats.SearchesTotal,
            result.Stats.SearchesFailed, result.Stats.SearchesEmpty);

        return result;
    }
}

// ── The AI calls (the API) ──────────────────────────────────────────────────

/// <summary>
/// Job facts and the Analyst parse, both delegated to the API.
/// </summary>
/// <remarks>
/// Claude is never called from here, following the mailbot — which could
/// reference Core and deliberately does not. One copy of the prompt config, one
/// Anthropic key, one set of rate-limit buckets, and `AGENTS.md`'s "all Claude
/// calls live in the API" stays literally true.
///
/// The usual hazard of an HTTP boundary does not apply: every call this makes
/// is user-independent, which is exactly the set that passes an explicit null
/// identity. There is no credential to forward and nothing to get wrong. The
/// requests carry <c>X-Api-Key</c> and <c>X-Source</c> and no session token,
/// because this process acts as nobody.
/// </remarks>
public sealed class IngestAiClient
{
    private readonly HttpClient _http;
    private readonly ILogger<IngestAiClient> _log;

    public IngestAiClient(HttpClient http, ILogger<IngestAiClient> log)
    {
        _http = http;
        _log = log;
    }

    /// <summary>
    /// Stated requirements for jobs entering the pool, keyed by job id.
    /// </summary>
    /// <remarks>
    /// A chunk that fails contributes nothing and is retried on a later run: a
    /// posting is worth keeping even when the facts about it are not available
    /// yet. So this returns what it got rather than throwing.
    /// </remarks>
    public async Task<Dictionary<string, BsonDocument>> ExtractFactsAsync(
        IReadOnlyList<ScrapedJob> jobs, CancellationToken ct)
    {
        var body = new
        {
            jobs = jobs.Select(j => new
            {
                jobId = j.Id,
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

            var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
            return FactsFrom(payload);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _log.LogWarning(e, "job-facts failed for a chunk of {Count}; retried next run", jobs.Count);
            return [];
        }
    }

    /// <summary>The ingest's Analyst read, plus the version stamp it was produced under.</summary>
    public async Task<(Dictionary<string, BsonDocument> Parsed, string? Version)> ParseAsync(
        IReadOnlyList<ScrapedJob> jobs, CancellationToken ct)
    {
        var body = new
        {
            jobs = jobs.Select(j => new
            {
                jobId = j.Id,
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

    /// <remarks>
    /// The API answers camelCase; the stored `extracted` document is snake_case,
    /// because the scraper wrote it that way and 3,700 rows already carry those
    /// names. The mapping is here rather than at the write, so the one place
    /// that has to agree with history is the one place that talks to the API.
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
