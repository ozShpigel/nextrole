namespace Mailbot.Models;

public sealed record EmailUpdate
{
    public required string Company { get; init; }
    public string? JobTitle { get; init; }
    public required string UpdateType { get; init; }
    public DateTime? InterviewDate { get; init; }
    public string? InterviewTime { get; init; }
    public string? InterviewEndTime { get; init; }
    public string? Interviewer { get; init; }
    public string? InterviewType { get; init; }
    public string? Notes { get; init; }
}
