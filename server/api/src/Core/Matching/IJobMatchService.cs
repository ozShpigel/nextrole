namespace ApplicationTracker.Core.Matching;

public interface IJobMatchService
{
    Task<MatchResponse> AnalyzeMatchAsync(MatchRequest request, CancellationToken cancellationToken = default);
    Task<TestPromptResult> TestPromptAsync(TestPromptRequest request, CancellationToken cancellationToken = default);

    // Batch (cron) path: analyst runs live per job (ParseAsync), then all parsed
    // jobs are evaluated in one Anthropic batch (submit), collected later (get).
    // GetEvaluationBatchAsync applies the same verdict-band / shouldApply
    // correction the live AnalyzeMatchAsync does, so results are identical.
    Task<(ParsedJob Parsed, ApplicationTracker.Core.AI.ClaudeCallSnapshot Snapshot)> ParseAsync(MatchRequest request, CancellationToken cancellationToken = default);
    Task<string> SubmitEvaluationBatchAsync(IReadOnlyList<EvaluationBatchItem> items, CancellationToken cancellationToken = default);
    Task<EvaluationBatchResult> GetEvaluationBatchAsync(string batchId, CancellationToken cancellationToken = default);
}
