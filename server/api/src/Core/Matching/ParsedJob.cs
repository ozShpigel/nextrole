namespace ApplicationTracker.Core.Matching;

public sealed record ParsedJob
{
    public string JobTitle { get; init; } = "";
    public string? Company { get; init; }
    public string[] RequiredSkills { get; init; } = [];
    public string[] NiceToHaveSkills { get; init; } = [];
    public string? ExperienceLevel { get; init; }
    public CulturalSignals CulturalSignals { get; init; } = new();
    public TechnicalRequirements TechnicalRequirements { get; init; } = new();
    // Concrete technologies/platforms/languages/tools the posting explicitly
    // names (e.g. "Kubernetes", "Terraform", "C#") — never generic/implied
    // phrasing ("cloud infrastructure", "modern tooling"). Empty when the
    // posting names none. Used by JobMatchService.EnforceEvidenceCaps to cap
    // Core Stack/System Design when there's nothing named to evaluate against,
    // rather than trusting the Evaluator to land there on its own.
    public string[] NamedTechnologies { get; init; } = [];
    public string? DomainContext { get; init; }
    public string[] Responsibilities { get; init; } = [];
    public string[] Warnings { get; init; } = [];
}

public sealed record CulturalSignals
{
    public string[] Positive { get; init; } = [];
    public string[] Negative { get; init; } = [];
    public string[] Neutral { get; init; } = [];
}

public sealed record TechnicalRequirements
{
    public string[] Languages { get; init; } = [];
    public string[] Frameworks { get; init; } = [];
    public string[] Infrastructure { get; init; } = [];
    public string[] Databases { get; init; } = [];
}
