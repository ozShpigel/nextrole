namespace ApplicationTracker.Core.Matching;

public interface IJobMatchService
{
    Task<MatchResponse> AnalyzeMatchAsync(MatchRequest request, CancellationToken cancellationToken = default);

    // Batched ingest-time scoring — see MatchBatch.cs. Each job is still scored
    // independently against the fixed rubric; this only shares the Evaluator
    // call's input cost across the batch, never compares jobs to each other.
    Task<MatchBatchResponse> AnalyzeMatchBatchAsync(MatchBatchRequest request, CancellationToken cancellationToken = default);
}
