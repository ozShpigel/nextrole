using Mailbot.Models;

namespace Mailbot.Services;

public interface IEmailParser
{
    /// <summary>
    /// referenceDateOverride: when set, used as "today" for resolving relative/
    /// year-less interview dates instead of the email's own ReceivedAt — lets a
    /// single sync run share one reference date across every email (so they all
    /// build a byte-identical system prompt and the prompt cache actually
    /// reuses). Leave null for re-sync, where a full-history walk needs each
    /// email's real received date for correct year resolution.
    /// </summary>
    Task<EmailUpdate?> ParseEmailAsync(
        EmailMessage email, List<string> knownCompanies,
        DateTime? referenceDateOverride = null,
        CancellationToken ct = default);
}
