namespace ApplicationTracker.Core.Matching;

// One cheap Haiku call per discovery run: given the user's search intent and
// the scraped job titles, mark the clearly off-target ones so the scraper can
// skip enrichment + scoring for them. Titles only — no descriptions.

public sealed record TitleTriageRequest
{
    public string SearchIntent { get; init; } = "";
    public List<TitleTriageItem> Titles { get; init; } = [];
}

public sealed record TitleTriageItem
{
    public string JobId { get; init; } = "";
    public string Title { get; init; } = "";
    public string? Company { get; init; }
}

public sealed record TitleTriageResponse
{
    public List<TitleTriageResult> Results { get; init; } = [];
}

public sealed record TitleTriageResult
{
    public string JobId { get; init; } = "";
    public bool Relevant { get; init; }
    public string? Reason { get; init; }
}
