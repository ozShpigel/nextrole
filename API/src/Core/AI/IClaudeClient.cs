using ApplicationTracker.Core.Matching;

namespace ApplicationTracker.Core.AI;

public interface IClaudeClient
{
    Task<ParsedJob> ParseJobDescriptionAsync(string jobDescription, CancellationToken cancellationToken = default);
    Task<MatchResponse> EvaluateMatchAsync(string profile, ParsedJob parsedJob, CancellationToken cancellationToken = default);
}
