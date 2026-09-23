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

// IngestAiClient MOVED TO ApplicationTracker.Core.Matching.
//
// The Greenhouse ingest runs the same two user-independent passes, and a second
// copy of the camelCase -> snake_case mapping is a second thing to get wrong
// against rows that already exist. PoolIngest now maps its ScrapedJob to the
// shared IngestJob record and uses the Core client.
