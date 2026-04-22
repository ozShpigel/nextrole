namespace Mailbot.Models;

public sealed record TrackerApplication
{
    public Guid Id { get; init; }
    public required string Company { get; init; }
    public required string JobTitle { get; init; }
    public required string Status { get; init; }
}
