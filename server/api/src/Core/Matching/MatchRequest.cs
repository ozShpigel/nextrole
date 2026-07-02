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

    // Glassdoor rating scraped from Google search snippets
    public GlassdoorData? GlassdoorData { get; init; }
}

public sealed record GlassdoorData
{
    // Optional: deep review aggregates can exist without an overall rating
    public double? Rating { get; init; }
    public int? ReviewCount { get; init; }
    public string? Url { get; init; }

    // Employee-review aggregates parsed from search snippets (all optional)
    public GlassdoorSubRatings? SubRatings { get; init; }
    public int? RecommendPercent { get; init; }
    public List<string>? Snippets { get; init; }
}

public sealed record GlassdoorSubRatings
{
    public double? WorkLifeBalance { get; init; }
    public double? CultureAndValues { get; init; }
    public double? CareerOpportunities { get; init; }
    public double? SeniorManagement { get; init; }
    public double? CompensationAndBenefits { get; init; }
}

public sealed record CompanyNewsItem
{
    public string Title { get; init; } = "";
    public string? Source { get; init; }
    public string? Published { get; init; }
}
