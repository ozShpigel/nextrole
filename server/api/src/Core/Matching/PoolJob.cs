namespace ApplicationTracker.Core.Matching;

// A job from the shared pool, as the API reads it. A thin projection of the
// scraper's DiscoveredJob — only the fields scoring and display need.
public sealed record PoolJob
{
    public string Id { get; init; } = "";
    public string Title { get; init; } = "";
    public string Company { get; init; } = "";
    public string? Location { get; init; }
    public string? Description { get; init; }
    public string? JobUrl { get; init; }
    public string? DatePosted { get; init; }
    public string? CompanyLogo { get; init; }
    public Dictionary<string, object?>? CompanyProfile { get; init; }
    public DateTime? FirstSeenAt { get; init; }
    // From the pool's own per-job extraction (extracted.must_have_tech /
    // nice_to_have_tech): what the posting asks for, read once at ingest and
    // user-independent. The candidate filter already reads must-haves; scoring
    // reads both, to compute the gap list and to check the rationale's claims
    // against the profile instead of trusting the model's account of them.
    public string[] MustHaveTech { get; init; } = [];
    public string[] NiceToHaveTech { get; init; } = [];
    // The ingest's stored Analyst read, and the stamp it was produced under.
    // Null Parsed means the scan must parse inline — see PoolScanService.
    // A ParseVersion that differs from the current one is STALE, not wrong:
    // it is still used, and the ingest backfill replaces it in its own time.
    public ParsedJob? Parsed { get; init; }
    public string? ParseVersion { get; init; }
}
