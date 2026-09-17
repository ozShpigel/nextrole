using System.Text.Json.Serialization;

namespace ApplicationTracker.Core.Matching;

/// <summary>
/// The Matches page's query over the shared pool.
/// </summary>
/// <remarks>
/// Browse is a different read from scoring, so it has its own query and its own
/// projection rather than widening <see cref="PoolJob"/>, which is deliberately
/// thin because every scan carries it.
/// </remarks>
public sealed record PoolBrowseQuery
{
    public int? MinScore { get; init; }
    public IReadOnlyList<string> Verdicts { get; init; } = [];
    public int DaysBack { get; init; } = 14;
    public string? Location { get; init; }
    /// <summary>Free text across title, company and description.</summary>
    public string? Text { get; init; }
    public bool? IsRemote { get; init; }
    public IReadOnlyList<string> Levels { get; init; } = [];
    public bool IncludeDismissed { get; init; }
    public bool IncludeSaved { get; init; } = true;
    public int Limit { get; init; } = 50;
    public int Offset { get; init; }

    public const int MaxLimit = 200;

    /// <summary>Clamp what the query string supplied into what the query may be.</summary>
    public PoolBrowseQuery Clamped() => this with
    {
        Limit = Math.Max(1, Math.Min(Limit, MaxLimit)),
        Offset = Math.Max(0, Offset),
        DaysBack = Math.Max(1, DaysBack),
    };
}

/// <summary>
/// One row of the Matches list.
/// </summary>
/// <remarks>
/// The JSON names are snake_case, which the rest of this API is not. That is
/// deliberate and it is a contract, not a style slip: this response was served
/// by the Python scraper until Phase 1b, and the client reads these exact
/// names. Moving the endpoint and renaming its fields in one change would make
/// any regression ambiguous — and the dangerous ones are silent, since a
/// missing <c>saved_to_tracker</c> reads as <c>undefined</c>, which is falsy,
/// so a saved job would quietly render as unsaved.
///
/// Normalising to camelCase with the client is worth doing, as its own change.
///
/// Typing it at all is already an improvement: the scraper returned the raw
/// Mongo document with <c>_id</c> stripped, so the wire contract was "whatever
/// fields discovered_jobs happens to have" and any storage change leaked
/// straight to the browser.
/// </remarks>
public sealed record PoolJobListItem
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
    [JsonPropertyName("actual_job_level")] public string? ActualJobLevel { get; init; }
    [JsonPropertyName("is_remote")] public bool? IsRemote { get; init; }
    [JsonPropertyName("company_logo")] public string? CompanyLogo { get; init; }
    [JsonPropertyName("company_profile")] public Dictionary<string, object?>? CompanyProfile { get; init; }
    [JsonPropertyName("is_duplicate")] public bool IsDuplicate { get; init; }
    [JsonPropertyName("discovered_at")] public DateTime? DiscoveredAt { get; init; }

    // ── This user's, merged in from jobScores and poolJobState ──────────────
    [JsonPropertyName("score")] public int? Score { get; init; }
    [JsonPropertyName("verdict")] public string? Verdict { get; init; }
    [JsonPropertyName("should_apply")] public bool? ShouldApply { get; init; }
    /// <summary>
    /// The stored MatchResponse, re-emitted as an object rather than a string.
    /// JobScore.MatchAnalysis holds JSON text; the client expects a parsed
    /// object under this name, as the scraper's json.loads produced.
    /// </summary>
    [JsonPropertyName("match_analysis")] public System.Text.Json.JsonElement? MatchAnalysis { get; init; }
    [JsonPropertyName("saved_to_tracker")] public bool SavedToTracker { get; init; }
    [JsonPropertyName("dismissed")] public bool Dismissed { get; init; }
}

public sealed record PoolBrowseResult
{
    [JsonPropertyName("jobs")] public IReadOnlyList<PoolJobListItem> Jobs { get; init; } = [];
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("offset")] public int Offset { get; init; }
}
