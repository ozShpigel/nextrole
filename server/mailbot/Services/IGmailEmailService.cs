using Mailbot.Models;

namespace Mailbot.Services;

public interface IGmailEmailService
{
    Task<List<EmailMessage>> GetEmailsFromLast24HoursAsync(CancellationToken ct = default);
    /// <summary>Fetch all messages matching an arbitrary Gmail query (no 24h limit). Used by re-sync.</summary>
    Task<List<EmailMessage>> GetEmailsByQueryAsync(string query, CancellationToken ct = default);

    /// <summary>
    /// Ensure a single Gmail filter labels mail from the given (core) companies with the
    /// JobApplications label, so the mailbot's label-based search picks them up. Idempotent:
    /// writes to Gmail only when the filter is out of date. Returns true if it was (re)created.
    /// </summary>
    Task<bool> EnsureJobApplicationsFilterAsync(IReadOnlyCollection<string> coreCompanies, CancellationToken ct = default);
}
