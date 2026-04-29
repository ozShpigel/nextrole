namespace ApplicationTracker.Core.Models;

public sealed record ApplicationSummary
{
    public Guid Id { get; init; }
    public required ApplicationStatus Status { get; init; }
    public int? MatchScore { get; init; }
}
