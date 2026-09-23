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
    // extracted.seniority: one of CandidateFilter's five bands, or null when the
    // posting did not make it clear. Read by the in-memory seniority filter of
    // a source that cannot filter in its query (GreenhouseJobRepository).
    public string? Seniority { get; init; }
    public string[] NiceToHaveTech { get; init; } = [];
    // The same must-haves as requirements, alternatives kept together
    // (RequirementGroups). What scoring counts; the flat list above is what the
    // candidate filter matches. A row extracted before groups existed reads
    // each flat entry as a group of one.
    public string[][] MustHaveGroups { get; init; } = [];

    // Company enrichment the ingest already scraped and stored on the pool
    // document. It is user-independent — a company's news and its employee
    // reviews are the same for everyone — so it belongs here beside the
    // extracted facts rather than being re-fetched per user.
    //
    // These were collected, stored and then never read: the scan built its
    // MatchBatchItem without them, so the Evaluator's <company_news> and
    // <employee_reviews> blocks never appeared on a single pool-scored job.
    public List<CompanyNewsItem>? CompanyNews { get; init; }
    // Null unless it carries actual evidence — see PoolJobRepository.
    //
    // What reads it is PaceEvidence.In, which asks whether the payload speaks
    // to hours or load at all, not whether it exists — so an evidence-free
    // object is merely useless here rather than harmful, which was not true of
    // the earlier `glassdoorData is null` test. Kept null anyway: the field
    // should say what is known, and nothing is.
    //
    // The consequence it decides is no longer a cap. When no pace evidence
    // exists anywhere, Sustainability & Pace is dropped from the total and the
    // score renormalised over what could be assessed (ScoreTotal).
    public GlassdoorData? GlassdoorData { get; init; }
    // The ingest's stored Analyst read, and the stamp it was produced under.
    // Null Parsed means the scan must parse inline — see PoolScanService.
    // A ParseVersion that differs from the current one is STALE, not wrong:
    // it is still used, and the ingest backfill replaces it in its own time.
    public ParsedJob? Parsed { get; init; }
    public string? ParseVersion { get; init; }
}
