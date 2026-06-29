using Mailbot.Models;

namespace Mailbot.Services;

public interface IGmailEmailService
{
    Task<List<EmailMessage>> GetEmailsFromLast24HoursAsync(CancellationToken ct = default);
    /// <summary>Fetch all messages matching an arbitrary Gmail query (no 24h limit). Used by re-sync.</summary>
    Task<List<EmailMessage>> GetEmailsByQueryAsync(string query, CancellationToken ct = default);
}
