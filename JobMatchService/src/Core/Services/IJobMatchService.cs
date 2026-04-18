using JobMatchService.Core.Models;

namespace JobMatchService.Core.Services;

public interface IJobMatchService
{
    Task<MatchResponse> AnalyzeMatchAsync(MatchRequest request, CancellationToken cancellationToken = default);
}
