namespace ApplicationTracker.Core.Models;

// Lightweight projection for the tracker/dashboard list views. Excludes the
// large per-application fields (job description, AI snapshots, news, etc.) that
// the list never renders, so GET /api/applications stays small and fast.
public sealed record ApplicationListItem
{
    public Guid Id { get; init; }
    public required string JobTitle { get; init; }
    public required string Company { get; init; }
    public required ApplicationStatus Status { get; init; }
    public int? MatchScore { get; init; }
    public string? MatchVerdict { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    // Soonest upcoming (future, not-completed) interview, if any — surfaced on the
    // list card. Null when there's no upcoming interview.
    public DateTime? NextInterviewAt { get; init; }
    public DateTime? NextInterviewEndsAt { get; init; }
    public string? NextInterviewer { get; init; }
}
