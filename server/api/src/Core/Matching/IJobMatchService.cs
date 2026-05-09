namespace ApplicationTracker.Core.Matching;

public interface IJobMatchService
{
    Task<MatchResponse> AnalyzeMatchAsync(MatchRequest request, CancellationToken cancellationToken = default);
}
