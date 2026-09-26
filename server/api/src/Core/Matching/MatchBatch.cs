namespace ApplicationTracker.Core.Matching;

// Batched ingest-time scoring: N jobs (cap 5, see MatchEndpoints) share ONE
// Analyst call AND one Evaluator call — each job is still parsed/scored
// independently, never ranked or compared against its batch-mates (see
// PromptSeeds.Evaluator's batch-mode addendum, and the Analyst's own batch
// addendum in PromptBuilder). This is the primary cost lever for scoring
// every discovered job: one shared system-prompt/profile input cost instead
// of N, for both calls.

public sealed record MatchBatchRequest
{
    public List<MatchBatchItem> Jobs { get; init; } = [];

    // The discovery run this batch belongs to, if any (the scraper's
    // DiscoveryRun id) — not sent by non-discovery callers like Import Job.
    // Request-level, not per-job: attached to the "Job scored" log line so a
    // job can be traced end-to-end in Loki alongside the scraper's own
    // per-stage logs, which already carry the same run id.
    public string? RunId { get; init; }
}

public sealed record MatchBatchItem
{
    // Caller-supplied identifier (the scraper's DiscoveredJob id) — echoed
    // back on the matching result so the caller can attribute without relying
    // on response order.
    public required string Id { get; init; }
    public required string JobDescription { get; init; }
    public string? Title { get; init; }
    public string? Company { get; init; }
    public string? Location { get; init; }
    public string? DatePosted { get; init; }
    public string? Site { get; init; }
    public List<CompanyNewsItem>? CompanyNews { get; init; }
    public GlassdoorData? GlassdoorData { get; init; }
    public CompanyProfile? CompanyProfile { get; init; }
    // The posting's stated requirements as the pool extracted them once at
    // ingest (PoolJob.MustHaveTech / NiceToHaveTech). Supplied by the per-user
    // scan; omitted by callers with no pool row behind the job (Import Job),
    // where JobMatchService falls back to the Analyst's own reading.
    public string[]? MustHaveTech { get; init; }
    public string[]? NiceToHaveTech { get; init; }
    // The must-haves as requirements (RequirementGroups). When present, the gap
    // count and the Core Stack cap count these, not the flat names.
    public string[][]? MustHaveGroups { get; init; }
    // The pool's stored Analyst read of this posting, when there is one. The
    // Analyst takes no profile, so its output cannot differ between users —
    // supplying it here skips a call that would recompute an identical result.
    // Null means "parse it": a job that predates the cache, or whose ingest
    // parse failed. Mixed batches are normal and handled per item.
    public ParsedJob? Parsed { get; init; }
}

public sealed record MatchBatchResponse
{
    public List<MatchBatchResult> Results { get; init; } = [];

    /// <summary>
    /// The parses this batch had to make, by job id -- the jobs that arrived
    /// with no stored <see cref="MatchBatchItem.Parsed"/>. After the verbatim
    /// guard and the title/company overrides, so exactly what scoring used.
    /// </summary>
    /// <remarks>
    /// The ingest no longer parses (Greenhouse:ParseAtIngest), so the first
    /// user to score a posting pays for its parse. Handing it back is what lets
    /// the caller store it, and every later user reuse it, instead of paying
    /// again per user.
    /// </remarks>
    public Dictionary<string, ParsedJob> NewParses { get; init; } = [];

    /// <summary>The prompt version <see cref="NewParses"/> were made under -- see ParseVersioning.</summary>
    public string? ParseVersion { get; init; }
}

public sealed record MatchBatchResult
{
    public required string Id { get; init; }
    public required MatchResponse Response { get; init; }
}

// Internal plumbing shape between JobMatchService and IClaudeClient — the
// Analyst has already run per job by the time this reaches the Evaluator call.
public sealed record EvaluationBatchItem
{
    public required string Id { get; init; }
    public required ParsedJob ParsedJob { get; init; }
    public List<CompanyNewsItem>? CompanyNews { get; init; }
    public GlassdoorData? GlassdoorData { get; init; }
    public CompanyProfile? CompanyProfile { get; init; }
}

public sealed record ParseBatchResult
{
    public required string Id { get; init; }
    public required ParsedJob Parsed { get; init; }
}
