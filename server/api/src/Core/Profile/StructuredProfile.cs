namespace ApplicationTracker.Core.Profile;

// The candidate profile as a first-class structured input.
//
// - Experience, skills & education are produced by the LLM normalization layer
//   (NormalizedProfile) from pasted free text, then editable by the user.
// - Strengths and CoreValues are explicit manual inputs (not reliably
//   extractable, so never auto-generated).
// - RawExperienceText preserves the original paste so the user can re-normalize.
//
// Persisted on the profile doc and rendered to a canonical string (`content`)
// that the scoring/interview prompts consume via {{USER_PROFILE}}.
public sealed record StructuredProfile
{
    // Contact fields — used only for the Generate Pack résumé header, not
    // rendered into the {{USER_PROFILE}} scoring/interview prompts.
    public string? FullName { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Location { get; init; }
    public string Summary { get; init; } = "";
    public string? Seniority { get; init; }
    public string[] Domains { get; init; } = [];
    public ExperienceItem[] Experience { get; init; } = [];
    public SkillGroups Skills { get; init; } = new();
    // One entry per degree/certification, e.g. "B.Sc. Computer Science, Open University, 2015".
    public string[] Education { get; init; } = [];
    // One entry per stated military/national service role, e.g. "Team Lead, 8200, 2010-2013".
    public string[] MilitaryService { get; init; } = [];
    // One entry per personal/side project, e.g. "NextRole — AI-assisted job search platform".
    public string[] SideProjects { get; init; } = [];
    // Spoken/human languages (not programming languages — see Skills.Languages), e.g. "Hebrew (native)".
    public string[] SpokenLanguages { get; init; } = [];
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
    // Extracted only when actually present in the source text/résumé — never
    // invented. Same contact fields as StructuredProfile, used for the
    // Generate Pack résumé header.
    public string? FullName { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Location { get; init; }
    public string Summary { get; init; } = "";
    public string? Seniority { get; init; }
    public string[] Domains { get; init; } = [];
    public ExperienceItem[] Experience { get; init; } = [];
    public SkillGroups Skills { get; init; } = new();
    public string[] Education { get; init; } = [];
    public string[] MilitaryService { get; init; } = [];
    public string[] SideProjects { get; init; } = [];
    public string[] SpokenLanguages { get; init; } = [];
}
