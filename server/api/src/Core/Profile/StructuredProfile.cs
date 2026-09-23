using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Profile;

// The candidate profile as a first-class structured input.
//
// - Experience, skills & education are produced by the LLM normalization layer
//   (NormalizedProfile) from pasted free text, then editable by the user.
// - RedFlags are explicit manual input (not extractable, so never
//   auto-generated) -- the one self-declared field left, because it is the one
//   the scoring acts on mechanically rather than narrates.
// - RawExperienceText preserves the original paste so the user can re-normalize.
//
// Strengths and CoreValues used to live here as manual inputs too. They were
// removed: never extracted from a CV, so usually empty, and a self-asserted
// strength is the weakest evidence in the profile -- which is the whole reason
// ClaimGrounding exists. Scoring rests on demonstrated experience instead.
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
    // The kinds of work the candidate is pursuing, from JobFunctions.All. Set
    // from the CV and editable; the Greenhouse candidate search matches
    // postings' functions against these widened by their neighbours
    // (JobFunctions.AcceptedFor). Not rendered into prompts -- scoring is
    // unchanged by it. Empty constrains nothing.
    public string[] Functions { get; init; } = [];
    public ExperienceItem[] Experience { get; init; } = [];
    public SkillGroup[] Skills { get; init; } = [];
    // One entry per degree/certification.
    public CredentialItem[] Education { get; init; } = [];
    // One entry per stated military/national service role.
    public CredentialItem[] MilitaryService { get; init; } = [];
    // One entry per personal/side project. Links are never auto-extracted from an
    // uploaded résumé (a PDF's clickable "Live demo"/"Code" labels carry a hyperlink
    // annotation, not visible URL text — nothing for text/vision-based extraction to
    // read), so they're always empty until the user adds them manually in Settings.
    public SideProjectItem[] SideProjects { get; init; } = [];
    // Spoken/human languages (not programming languages — those belong in Skills), e.g. "Hebrew (native)".
    public string[] SpokenLanguages { get; init; } = [];
    // Explicit manual dealbreakers (e.g. "Early-stage startup") — checked by the
    // Candidate-Stated Dealbreakers hard filter and mechanically enforced via
    // hardBlockers, where the reason must quote the dealbreaker in the user's
    // own words. One of the two filters that survive; never auto-generated.
    public string[] RedFlags { get; init; } = [];
    public string RawExperienceText { get; init; } = "";
}

// A degree or a service record: where it was earned and what it was. Kept as two
// fields rather than one sentence so the résumé PDF can set the institution as a
// label beside its detail instead of parsing it back out of free text — the
// institution sits mid-string in prose ("B.Sc. Computer Science, HIT Holon, 2012")
// and often contains its own comma, so it can't be recovered by splitting.
public sealed record CredentialItem
{
    public string Institution { get; init; } = "";
    public string Detail { get; init; } = "";
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
// StructuredProfile (no manual RedFlags / RawExperienceText).
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
    public string[] Functions { get; init; } = [];
    public ExperienceItem[] Experience { get; init; } = [];
    public SkillGroup[] Skills { get; init; } = [];
    public CredentialItem[] Education { get; init; } = [];
    public CredentialItem[] MilitaryService { get; init; } = [];
    public SideProjectItem[] SideProjects { get; init; } = [];
    public string[] SpokenLanguages { get; init; } = [];
}
