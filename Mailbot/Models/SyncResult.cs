namespace Mailbot.Models;

public sealed record SyncResult
{
    public DateTime SyncTime { get; init; } = DateTime.UtcNow;
    public int EmailsChecked { get; init; }
    public int EmailsParsed { get; init; }
    public int ApplicationsUpdated { get; init; }
    public List<string> UpdatedApplications { get; init; } = new();
    public List<string> Errors { get; init; } = new();
    public bool Success { get; init; }
}
