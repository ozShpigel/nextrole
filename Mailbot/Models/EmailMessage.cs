namespace Mailbot.Models;

public sealed record EmailMessage
{
    public required string Subject { get; init; }
    public required string From { get; init; }
    public required string Body { get; init; }
    public DateTime ReceivedAt { get; init; }
}
