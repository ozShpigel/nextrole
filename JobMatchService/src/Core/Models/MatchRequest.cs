namespace JobMatchService.Core.Models;

public sealed record MatchRequest
{
    public required string JobDescription { get; init; }

    // Optional pre-parsed metadata. When present, the parse step is skipped.
    public string? Title { get; init; }
    public string? Company { get; init; }
    public string? Location { get; init; }
    public string? DatePosted { get; init; }
    public string? Site { get; init; }
}
