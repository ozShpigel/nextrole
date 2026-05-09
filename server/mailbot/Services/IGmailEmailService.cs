using Mailbot.Models;

namespace Mailbot.Services;

public interface IGmailEmailService
{
    Task<List<EmailMessage>> GetEmailsFromLast24HoursAsync(CancellationToken ct = default);
}
