namespace Mailbot.Models;

public sealed class SyncResult
{
    public DateTime SyncTime { get; } = DateTime.UtcNow;
    public int EmailsChecked { get; set; }
    public int EmailsParsed { get; set; }
    public int ApplicationsUpdated { get; set; }
    public List<string> UpdatedApplications { get; } = new();
    public List<string> Errors { get; } = new();
    public bool Success { get; set; }
}
