namespace ApplicationTracker.Core.Matching;

// The on-demand RAG search path: Atlas $vectorSearch (in the scraper) selects
// the top-N jobs, then ONE Sonnet call ranks them as a career-advisor brief.
// The profile is loaded server-side (IProfileProvider) — never sent by callers.

// One vector-search hit, as sent by the scraper. All job text is untrusted
// external data (XML-wrapped in the user message by PromptBuilder).
public sealed record AdvisorJobInput
{
    public required string Id { get; init; }
    public string? Title { get; init; }
    public string? Company { get; init; }
    public string? Location { get; init; }
    public string? JobLevel { get; init; }
    public string? JobUrl { get; init; }
    public string? DatePosted { get; init; }
    // Cosine similarity from $vectorSearch — a weak prior, not a score.
    public double? Similarity { get; init; }
    public string? Description { get; init; }
    public List<CompanyNewsItem>? CompanyNews { get; init; }
    public GlassdoorData? GlassdoorData { get; init; }
}

public sealed record AdviseRequest
{
    public required List<AdvisorJobInput> Jobs { get; init; }
}

// One ranked entry of the advisor brief.
public sealed record AdvisorJobBrief
{
    public string JobId { get; init; } = "";
    public int Rank { get; init; }
    public string Verdict { get; init; } = "";   // "apply" | "maybe" | "skip"
    public string Rationale { get; init; } = ""; // Hebrew, second person
    public string[] GreenFlags { get; init; } = [];
    public string[] RedFlags { get; init; } = [];
}

public sealed record AdvisorResponse
{
    public string OverallRecommendation { get; init; } = ""; // Hebrew comparative summary
    public List<AdvisorJobBrief> Rankings { get; init; } = [];
}
