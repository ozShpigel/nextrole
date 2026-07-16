namespace ApplicationTracker.Core.Matching;

// One HyDE search-query facet: the profile rewritten as the ideal job posting
// for a single role family. The scraper embeds each facet's posting as its own
// $vectorSearch query and rank-fuses the results.
public sealed record SearchQueryFacet
{
    public string Name { get; init; } = "";
    public string Posting { get; init; } = "";
}
