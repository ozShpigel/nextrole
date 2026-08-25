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
}

public sealed record MatchBatchResponse
{
    public List<MatchBatchResult> Results { get; init; } = [];
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
