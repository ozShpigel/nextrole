using System.Net.Http.Json;
using System.Text.Json.Serialization;
using ApplicationTracker.Core.Matching;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Infrastructure.Listings;

/// <summary>
/// One posting fetched directly by URL, as the scraper returns it.
/// </summary>
public sealed record FetchedListing
{
    [JsonPropertyName("title")] public string Title { get; init; } = "";
    [JsonPropertyName("company")] public string Company { get; init; } = "";
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("job_url")] public string? JobUrl { get; init; }
    [JsonPropertyName("company_logo")] public string? CompanyLogo { get; init; }
    [JsonPropertyName("company_profile")] public Dictionary<string, object?>? CompanyProfile { get; init; }
}

public interface IListingsClient
{
    /// <summary>
    /// Fetch one posting by URL, or null if it could not be read.
    /// </summary>
    /// <remarks>
    /// Null is an ordinary outcome, not an exception: a bad link, an expired
    /// posting and a changed page structure all land here, and the caller
    /// reports them per URL rather than failing a batch of five for one.
    /// </remarks>
    Task<FetchedListing?> FetchByUrlAsync(string url, CancellationToken ct = default);
}

/// <summary>
/// The API's one call into the scraper.
/// </summary>
/// <remarks>
/// This makes the dependency bidirectional, which it was not before: the
/// scraper called the API and never the reverse. That is deliberate and it is
/// the direction the slimming is heading — the Python service becomes a library
/// the .NET side calls, rather than an orchestrator that consumes the API
/// (docs/scraper-slimming.md). <c>PoolIngest</c> is the other caller.
///
/// It exists because fetching a LinkedIn posting needs jobspy, and jobspy is
/// Python. Nothing else about importing a job does.
/// </remarks>
public sealed class ListingsClient : IListingsClient
{
    private readonly HttpClient _http;
    private readonly ILogger<ListingsClient> _log;

    public ListingsClient(HttpClient http, ILogger<ListingsClient> log)
    {
        _http = http;
        _log = log;
    }

    public async Task<FetchedListing?> FetchByUrlAsync(string url, CancellationToken ct = default)
    {
        try
        {
            using var response = await _http.PostAsJsonAsync("/scrape/url", new { url }, ct);
            if (!response.IsSuccessStatusCode)
            {
                _log.LogWarning("Listing fetch returned {Status} for {Url}", (int)response.StatusCode, url);
                return null;
            }

            var payload = await response.Content.ReadFromJsonAsync<FetchResponse>(cancellationToken: ct);
            return payload?.Job;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _log.LogWarning(e, "Listing fetch failed for {Url}", url);
            return null;
        }
    }

    private sealed record FetchResponse
    {
        [JsonPropertyName("job")] public FetchedListing? Job { get; init; }
    }
}
