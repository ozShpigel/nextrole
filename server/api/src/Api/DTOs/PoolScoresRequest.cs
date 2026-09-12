namespace ApplicationTracker.Api.DTOs;

public sealed record PoolScoresRequest
{
    public List<string> JobIds { get; init; } = [];
}
