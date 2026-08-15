namespace ApplicationTracker.Api.DTOs;

public record MatchAnalysisUpdateRequest
{
    public required string MatchAnalysis { get; init; }
}
