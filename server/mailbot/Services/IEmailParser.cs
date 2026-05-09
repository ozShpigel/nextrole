using Mailbot.Models;

namespace Mailbot.Services;

public interface IEmailParser
{
    Task<EmailUpdate?> ParseEmailAsync(EmailMessage email, List<string> knownCompanies, CancellationToken ct = default);
}
