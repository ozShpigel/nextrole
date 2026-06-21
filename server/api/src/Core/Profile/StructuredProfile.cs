namespace ApplicationTracker.Core.Profile;

// The candidate profile as a first-class structured input.
//
// - Experience & skills are produced by the LLM normalization layer
//   (NormalizedProfile) from pasted free text, then editable by the user.
// - Strengths and CoreValues are explicit manual inputs (not reliably
//   extractable, so never auto-generated).
// - RawExperienceText preserves the original paste so the user can re-normalize.
//
// Persisted on the profile doc and rendered to a canonical string (`content`)
// that the scoring/interview prompts consume via {{USER_PROFILE}}.
public sealed record StructuredProfile
{
    public string Summary { get; init; } = "";
    public string? Seniority { get; init; }
    public string[] Domains { get; init; } = [];
    public ExperienceItem[] Experience { get; init; } = [];
    public SkillGroups Skills { get; init; } = new();
    public string[] Strengths { get; init; } = [];
    public string[] CoreValues { get; init; } = [];
    public string RawExperienceText { get; init; } = "";
}

public sealed record ExperienceItem
{
    public string Title { get; init; } = "";
    public string Company { get; init; } = "";
    public string Dates { get; init; } = "";
    public string[] Highlights { get; init; } = [];
}

// Mirrors ParsedJob.TechnicalRequirements (+ Other) so candidate skills and job
// requirements describe technology in the same vocabulary.
public sealed record SkillGroups
{
    public string[] Languages { get; init; } = [];
    public string[] Frameworks { get; init; } = [];
    public string[] Infrastructure { get; init; } = [];
    public string[] Databases { get; init; } = [];
    public string[] Other { get; init; } = [];
}

// Output of the normalization agent: the machine-extractable subset of a
// StructuredProfile (no manual Strengths / CoreValues / RawExperienceText).
public sealed record NormalizedProfile
{
    public string Summary { get; init; } = "";
    public string? Seniority { get; init; }
    public string[] Domains { get; init; } = [];
    public ExperienceItem[] Experience { get; init; } = [];
    public SkillGroups Skills { get; init; } = new();
}
