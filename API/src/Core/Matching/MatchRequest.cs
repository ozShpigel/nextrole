namespace ApplicationTracker.Core.Matching;

public sealed record MatchRequest
{
    public required string JobDescription { get; init; }

    // Optional pre-parsed metadata. When present, the parse step is skipped.
    public string? Title { get; init; }
    public string? Company { get; init; }
    public string? Location { get; init; }
    public string? DatePosted { get; init; }
    public string? Site { get; init; }

    // Recent news headlines about the company (from news RSS)
    public List<CompanyNewsItem>? CompanyNews { get; init; }
}

public sealed record CompanyNewsItem
{
    public string Title { get; init; } = "";
    public string? Source { get; init; }
    public string? Published { get; init; }
}
