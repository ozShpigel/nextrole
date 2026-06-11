namespace ApplicationTracker.Core.Email;

public sealed record EmailParseResult
{
    public string? Company { get; init; }
    public string? JobTitle { get; init; }
    public string? UpdateType { get; init; }
    public DateTime? InterviewDate { get; init; }
    public string? InterviewTime { get; init; }
    public string? Interviewer { get; init; }
    public string? InterviewType { get; init; }
    public string? Notes { get; init; }
}
