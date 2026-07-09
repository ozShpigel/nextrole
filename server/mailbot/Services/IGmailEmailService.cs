using Mailbot.Models;

namespace Mailbot.Services;

public interface IGmailEmailService
{
    /// <summary>
    /// Daily sync fetch: recent mail (Gmail:LookbackDays window, default 3d) matching
    /// any of the given core company names. No label/filter dependency — search is
    /// retroactive, so newly tracked companies are covered immediately.
    /// </summary>
    Task<List<EmailMessage>> GetEmailsForCompaniesAsync(IReadOnlyCollection<string> coreCompanies, CancellationToken ct = default);

    /// <summary>Fetch all messages matching an arbitrary Gmail query (no time limit). Used by re-sync.</summary>
    Task<List<EmailMessage>> GetEmailsByQueryAsync(string query, CancellationToken ct = default);
}
