namespace ApplicationTracker.Core.Matching;

// On-demand upgrade of a scored job's narrative fields from ingest-time
// terse to full detail — fired once, when the candidate clicks Add. Scores
// travel as immutable context (never recomputed); only 4 narrative fields
// come back. See PromptSeeds.NarrativeEnrichment / PromptBuilder's
// BatchModeAddendum.
public sealed record NarrativeEnrichRequest
{
    public required string JobDescription { get; init; }
    public string? Title { get; init; }
    public string? Company { get; init; }
    public List<CompanyNewsItem>? CompanyNews { get; init; }
    public GlassdoorData? GlassdoorData { get; init; }
    public CompanyProfile? CompanyProfile { get; init; }

    // Immutable context from the original ingest-time scoring — never
    // recomputed or contradicted by the enrichment call.
    public required int OverallScore { get; init; }
    public required string Verdict { get; init; }
    public required Breakdown Breakdown { get; init; }
    public HardBlocker[] HardBlockers { get; init; } = [];
    public string[] MustClarify { get; init; } = [];
    public string[] StackedGaps { get; init; } = [];
}

public sealed record NarrativeEnrichResponse
{
    public string HonestAssessment { get; init; } = "";
    public NarrativeRecommendation? Recommendation { get; init; }
    public CompanyNewsAnalysis? CompanyNewsAnalysis { get; init; }
    public EmployeeReviewsAnalysis? EmployeeReviewsAnalysis { get; init; }
}

// Deliberately narrower than the full Recommendation record (no
// ShouldApply) — that field is server-computed at ingest time and must
// never be touched or implied by this call.
public sealed record NarrativeRecommendation
{
    public string[] KeyReasons { get; init; } = [];
    public string[] QuestionsToAsk { get; init; } = [];
    public string[] RedFlags { get; init; } = [];
    public string[] GreenFlags { get; init; } = [];
}
