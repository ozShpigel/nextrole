using ApplicationTracker.Core.Models;

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
    public string? LinkedIn { get; init; }
    public string Summary { get; init; } = "";
    public string? Seniority { get; init; }
    public string[] Domains { get; init; } = [];
    public ExperienceItem[] Experience { get; init; } = [];
    public SkillGroup[] Skills { get; init; } = [];
    // One entry per degree/certification, e.g. "B.Sc. Computer Science, Open University, 2015".
    public string[] Education { get; init; } = [];
    // One entry per stated military/national service role, e.g. "Team Lead, 8200, 2010-2013".
    public string[] MilitaryService { get; init; } = [];
    // One entry per personal/side project. Links are never auto-extracted from an
    // uploaded résumé (a PDF's clickable "Live demo"/"Code" labels carry a hyperlink
    // annotation, not visible URL text — nothing for text/vision-based extraction to
    // read), so they're always empty until the user adds them manually in Settings.
    public SideProjectItem[] SideProjects { get; init; } = [];
    // Spoken/human languages (not programming languages — those belong in Skills), e.g. "Hebrew (native)".
    public string[] SpokenLanguages { get; init; } = [];
    public string[] Strengths { get; init; } = [];
    public string[] CoreValues { get; init; } = [];
    // Explicit manual dealbreakers (e.g. "Early-stage startup") — checked by the
    // Evaluator's 4th Hard Filter (Candidate-Stated Dealbreakers) and mechanically
    // enforced via hardBlockers, same as the other hard filters. Never auto-generated.
    public string[] RedFlags { get; init; } = [];
    public string RawExperienceText { get; init; } = "";
}

public sealed record ExperienceItem
{
    public string Title { get; init; } = "";
    public string Company { get; init; } = "";
    public string Dates { get; init; } = "";
    public string[] Highlights { get; init; } = [];
}

// One named group of skills, e.g. {"Infrastructure", ["Kubernetes", "Docker"]}.
// Category names are real, not a fixed enum — the normalization prompt takes
// them from the résumé's own Skills section (or invents sensible ones for
// unstructured input), same shape ResumePack.SkillCategory already uses for
// generated output. No hardcoded catch-all "Other" bucket: an item that
// doesn't fit a real category is either its own category or dropped.
public sealed record SkillGroup
{
    public string Category { get; init; } = "";
    public string[] Items { get; init; } = [];
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
    public string? LinkedIn { get; init; }
    public string Summary { get; init; } = "";
    public string? Seniority { get; init; }
    public string[] Domains { get; init; } = [];
    public ExperienceItem[] Experience { get; init; } = [];
    public SkillGroup[] Skills { get; init; } = [];
    public string[] Education { get; init; } = [];
    public string[] MilitaryService { get; init; } = [];
    public SideProjectItem[] SideProjects { get; init; } = [];
    public string[] SpokenLanguages { get; init; } = [];
}
