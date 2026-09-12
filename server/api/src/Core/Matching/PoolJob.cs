namespace ApplicationTracker.Core.Matching;

// A job from the shared pool, as the API reads it. A thin projection of the
// scraper's DiscoveredJob — only the fields scoring and display need.
public sealed record PoolJob
{
    public string Id { get; init; } = "";
    public string Title { get; init; } = "";
    public string Company { get; init; } = "";
    public string? Location { get; init; }
    public string? Description { get; init; }
    public string? JobUrl { get; init; }
    public string? DatePosted { get; init; }
    public string? CompanyLogo { get; init; }
    public Dictionary<string, object?>? CompanyProfile { get; init; }
    public DateTime? FirstSeenAt { get; init; }
}
