using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Api.DTOs;

public sealed record TimelineItem(string Type, DateTime Date)
{
    public ApplicationStatus? FromStatus { get; init; }
    public ApplicationStatus? ToStatus { get; init; }
    public string? Note { get; init; }
    public InterviewType? InterviewType { get; init; }
    public string? Interviewer { get; init; }
    public bool? Completed { get; init; }
    public string? Notes { get; init; }
    public string? Content { get; init; }
    public NoteCategory? Category { get; init; }
}
