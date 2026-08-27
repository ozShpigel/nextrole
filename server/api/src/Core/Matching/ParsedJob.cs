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
    // Concrete statements about how the team works — code review, design docs,
    // testing requirements, ownership boundaries, planning cadence, incident
    // process, documented runbooks — never implied/generic phrasing
    // ("collaborative environment"). Empty when the posting states none. Used
    // by JobMatchService.EnforceEvidenceCaps to cap Role Clarity & Ownership /
    // Engineering Maturity & Stability when the JD says nothing about process.
    public string[] ProcessSignals { get; init; } = [];
    // Concrete statements about workload or pace — on-call arrangements,
    // working hours, deadline culture, time-off policy, team size vs scope,
    // stability or churn — never a mood word alone ("fast-paced" by itself
    // doesn't count; a stated arrangement like "on-call one week in six"
    // does). Empty when the posting states none. Used by
    // JobMatchService.EnforceEvidenceCaps to cap Pace & Workload / Long-term
    // Risk when the JD says nothing about pace (and no Glassdoor data fills
    // the gap — the Analyst only reads the job description).
    public string[] PaceSignals { get; init; } = [];
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
