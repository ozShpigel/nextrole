namespace ApplicationTracker.Core.Models;

// TrackedEmail plus the linked application's company logo — display-only
// enrichment computed at read time in GetMessages, never persisted.
public sealed record MessageListItem
{
    public Guid Id { get; init; }
    public Guid? ApplicationId { get; init; }
    public required string Company { get; init; }
    public string? JobTitle { get; init; }
    public required string Subject { get; init; }
    public required string From { get; init; }
    public required string UpdateType { get; init; }
    public required string Snippet { get; init; }
    public DateTime ReceivedAt { get; init; }
    public string? CompanyLogo { get; init; }
    public bool IsRead { get; init; }
}
