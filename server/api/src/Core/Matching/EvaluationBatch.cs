namespace ApplicationTracker.Core.Matching;

using ApplicationTracker.Core.Models;

// One job queued for batch evaluation. The caller (batch endpoint) supplies the
// already-parsed job + enrichment; the ClaudeClient resolves profile / evaluator
// prompt / config internally, exactly like the live EvaluateMatchAsync overload.
public sealed record EvaluationBatchItem
{
    public required string CustomId { get; init; }
    public required ParsedJob ParsedJob { get; init; }
    public List<CompanyNewsItem>? CompanyNews { get; init; }
    public GlassdoorData? GlassdoorData { get; init; }
}

// Result of polling a submitted evaluation batch. Status mirrors Anthropic's
// processing_status ("in_progress" | "ended" | "canceling" | "canceled").
// Lines are populated only once Status == "ended".
public sealed record EvaluationBatchResult
{
    public required string Status { get; init; }
    public bool Ended => string.Equals(Status, "ended", System.StringComparison.OrdinalIgnoreCase);
    public List<EvaluationBatchLine> Lines { get; init; } = new();
}

// One per-job result line from a finished batch. Exactly one of Response/Error
// is populated. RawOutput is the model text (for debugging / snapshot).
public sealed record EvaluationBatchLine
{
    public required string CustomId { get; init; }
    public MatchResponse? Response { get; init; }
    public string? RawOutput { get; init; }
    public string? Error { get; init; }
}
