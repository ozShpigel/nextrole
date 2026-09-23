namespace ApplicationTracker.Core.Matching;

// The ingest's two user-independent reads (job-facts, job-parse) submitted
// through Anthropic's Message Batches API instead of called and awaited.
//
// Same prompts, same model, same chunking as the synchronous endpoints -- only
// the delivery changes, at half the price. Nothing is waiting on these reads:
// the ingest runs on a timer, so an answer that lands an hour later costs
// nothing but that hour. Measured before this existed, the two reads were about
// three quarters of the production Anthropic bill (docs/greenhouse.md).
//
// The API holds no state for a batch. Anthropic keeps it; the caller keeps the
// id, and comes back with it.

/// <summary>A submitted batch: its id, and the parse stamp it was produced under.</summary>
/// <remarks>
/// <c>ParseVersion</c> is captured at SUBMISSION. A deploy that changes the
/// Analyst prompt between submit and collect must not stamp an old-prompt parse
/// with the new version.
/// </remarks>
public sealed record IngestBatchSubmitted
{
    public string BatchId { get; init; } = "";
    public int Requests { get; init; }
    public string? ParseVersion { get; init; }
}

public static class IngestBatchStatus
{
    /// <summary>Anthropic is still working on it. Come back later.</summary>
    public const string InProgress = "in_progress";

    /// <summary>Every request has a result: succeeded, errored, expired or canceled.</summary>
    public const string Ended = "ended";
}

public sealed record JobFactsBatchResponse
{
    public string Status { get; init; } = IngestBatchStatus.InProgress;
    public List<JobFacts> Results { get; init; } = [];
    /// <summary>Requests that ended without a usable answer (errored, expired, truncated, unparseable).</summary>
    public int FailedRequests { get; init; }
}

public sealed record JobParseBatchResponse
{
    public string Status { get; init; } = IngestBatchStatus.InProgress;
    public List<JobParseResult> Results { get; init; } = [];
    public int FailedRequests { get; init; }
}
