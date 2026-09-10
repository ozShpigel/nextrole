using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// AI-tailored résumé for one specific application — reorders/re-emphasizes
// the candidate's real profile content toward that job's description; never
// invents facts. Only the structured content is persisted; the PDF is
// rendered on demand from it (see IResumePdfRenderer), so the template can
// evolve without regenerating. Keyed 1:1 by ApplicationId, not a singleton.
public sealed record ResumePack
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid ApplicationId { get; init; }
    // How this posting's stated requirements fared against the profile, and the
    // focused questions worth answering to close the evidence gaps. Advisory
    // output for the candidate — deliberately NOT rendered into the PDF.
    public List<RequirementCoverage> RequirementCoverage { get; init; } = new();
    public List<string> ConfirmationItems { get; init; } = new();
    public string TailoredSummary { get; init; } = "";
    // The role title this pack positions the candidate for — decided by the same
    // family/level tests that govern the summary's opening title (PromptSeeds.
    // ResumePack). Rendered under the name so the header doesn't contradict the
    // summary. Null on packs generated before this field existed; the renderer
    // falls back to the most recent employer title for those.
    public string? TargetTitle { get; init; }
    public List<TailoredExperienceItem> Experience { get; init; } = new();
    public List<SkillCategory> HighlightedSkills { get; init; } = new();
    // AI-selected subset of the candidate's StructuredProfile.SideProjects, tailored
    // to this posting. Education/MilitaryService/SpokenLanguages are NOT persisted
    // here — the PDF renders those straight from StructuredProfile, unedited.
    public List<SideProjectItem> SideProjects { get; init; } = new();
    // Fabrication signals from ResumePackValidator, computed once at
    // generation time from the (already-discarded) Provenance/HighlightedSkills/
    // Experience the model actually returned — not enforced, just recorded so
    // real generations can be reviewed before deciding whether any check should
    // hard-fail. The raw Provenance array itself is never persisted.
    public List<ValidationViolation> Violations { get; init; } = new();
    public DateTime GeneratedAt { get; init; } = DateTime.UtcNow;
}

public sealed record TailoredExperienceItem
{
    public string Title { get; init; } = "";
    public string Company { get; init; } = "";
    public string Dates { get; init; } = "";
    public List<string> Highlights { get; init; } = new();
}

public sealed record SkillCategory
{
    public string Category { get; init; } = "";
    public List<string> Items { get; init; } = new();
}

public sealed record SideProjectItem
{
    public string Name { get; init; } = "";
    // What the project did, as separate points — rendered one bullet each, the same
    // shape as an experience entry. Empty on packs generated before this field
    // existed; the renderer falls back to Description for those.
    public List<string> Highlights { get; init; } = new();
    public string Description { get; init; } = "";
    // StructuredProfile.SideProjects is free text, not a structured {name,
    // description, links} record — so this is usually empty; it's only
    // populated when the model can pull a literal URL substring out of that
    // free text (see PromptSeeds.ResumePack's "pass through every link" rule).
    public List<string> Links { get; init; } = new();
}

// One row per rephrased output clause (summary sentence, highlight, project
// description): what the model wrote and the exact profile text it came
// from. Grounding evidence for the "never introduce a claim absent from the
// profile" hard rule — logged for debugging, not persisted with the pack.
public sealed record ProvenanceRow
{
    public string Output { get; init; } = "";
    public string Source { get; init; } = "";
}

// One flagged signal from ResumePackValidator. Kind is a short machine-readable
// code (see ResumePackValidator); Detail is human-readable.
//
// Blocking separates the two things the validator now does. A blocking violation
// cannot be repaired and must not ship — a figure the profile never stated is a
// fabricated fact, and no server-side edit can make it true, so the pack is
// refused rather than persisted. Everything else is advisory: recorded on the
// pack and logged, generation proceeds. Repairs (a skill item dropped for having
// no profile counterpart) are recorded here too, as non-blocking, so an edit the
// server made to the model's output is visible rather than silent.
public sealed record ValidationViolation
{
    public string Kind { get; init; } = "";
    public string Detail { get; init; } = "";
    public bool Blocking { get; init; }
}

// One requirement stated by the posting, and how the candidate's real profile
// answers it. Two independent axes, because they drive different responses:
//
//   coverage  how well it is met  - confirmed | partial | transferable |
//                                   requires confirmation | gap
//   gapType   what to DO about it - none | wording | evidence | capability
//
//     wording     the evidence is in the profile and the resume simply failed to
//                 surface it. Fix it in the resume; generate NO confirmation item.
//                 This is the dropped-Node.js case: the profile lists Node.js, the
//                 posting named it, and it vanished from the output anyway.
//     evidence    the candidate may have it but nothing in the profile proves it.
//                 Generate one focused confirmation item; keep it out of the resume.
//     capability  genuinely absent. Say so in the advisory output; never conceal
//                 it and never write around it.
public sealed record RequirementCoverage
{
    public string Requirement { get; init; } = "";
    public string Coverage { get; init; } = "";
    public string GapType { get; init; } = "";
    // Where in the résumé this requirement is actually met, quoted verbatim from
    // the pack's own output — checked exactly, the same way Provenance is.
    //
    // It exists because the coverage rule BLOCKS, and the two vocabularies do not
    // agree: TASK 6 has the model reframe the candidate's experience into the
    // target role's language, while a requirement is quoted in the POSTING's
    // language. Matching one against the other can only ever be fuzzy, and a
    // fuzzy rule that refuses packs will eventually refuse a correct one. Having
    // the model name its own evidence turns the check into string equality.
    public string Evidence { get; init; } = "";
}

// Raw Claude output, kept distinct from the persisted document (same split
// InterviewInsight/InterviewInsightsSynthesis uses).
public sealed record ResumePackSynthesis
{
    // Emitted BEFORE the résumé fields — see PromptSeeds.ResumePack TASK 0. The
    // model classifies every requirement before it writes any prose, so the
    // writing is conditioned on the analysis rather than rationalized after it.
    public List<RequirementCoverage> RequirementCoverage { get; init; } = new();
    public List<string> ConfirmationItems { get; init; } = new();
    public string TailoredSummary { get; init; } = "";
    public string? TargetTitle { get; init; }
    public List<TailoredExperienceItem> Experience { get; init; } = new();
    public List<SkillCategory> HighlightedSkills { get; init; } = new();
    public List<SideProjectItem> SideProjects { get; init; } = new();
    public List<ProvenanceRow> Provenance { get; init; } = new();
}
