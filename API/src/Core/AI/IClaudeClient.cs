using ApplicationTracker.Core.Matching;

namespace ApplicationTracker.Core.AI;

public interface IClaudeClient
{
    Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, CancellationToken cancellationToken = default);
    Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, CancellationToken cancellationToken = default);
}
