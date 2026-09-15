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

    // Company enrichment the ingest already scraped and stored on the pool
    // document. It is user-independent — a company's news and its employee
    // reviews are the same for everyone — so it belongs here beside the
    // extracted facts rather than being re-fetched per user.
    //
    // These were collected, stored and then never read: the scan built its
    // MatchBatchItem without them, so the Evaluator's <company_news> and
    // <employee_reviews> blocks never appeared on a single pool-scored job.
    public List<CompanyNewsItem>? CompanyNews { get; init; }
    // Null unless it carries actual evidence — see PoolJobRepository. An
    // empty object here would not merely be useless: EnforceEvidenceCaps
    // treats a non-null GlassdoorData as "pace evidence exists elsewhere" and
    // lifts a cap on that basis, so an evidence-free object would raise scores
    // while supplying nothing to raise them with.
    public GlassdoorData? GlassdoorData { get; init; }
    // The ingest's stored Analyst read, and the stamp it was produced under.
    // Null Parsed means the scan must parse inline — see PoolScanService.
    // A ParseVersion that differs from the current one is STALE, not wrong:
    // it is still used, and the ingest backfill replaces it in its own time.
    public ParsedJob? Parsed { get; init; }
    public string? ParseVersion { get; init; }
}
