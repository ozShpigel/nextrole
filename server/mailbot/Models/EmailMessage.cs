namespace Mailbot.Models;

public sealed record EmailMessage
{
    // Gmail's own message id — the dedupe key when persisting a TrackedEmail,
    // since the daily sync's lookback window overlaps previous runs on purpose
    // and re-sync re-walks a company's full history.
    public required string GmailMessageId { get; init; }
    public required string Subject { get; init; }
    public required string From { get; init; }
    public required string Body { get; init; }
    public DateTime ReceivedAt { get; init; }
}
