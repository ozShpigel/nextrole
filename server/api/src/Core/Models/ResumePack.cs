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
    public string TailoredSummary { get; init; } = "";
    public List<TailoredExperienceItem> Experience { get; init; } = new();
    public List<SkillCategory> HighlightedSkills { get; init; } = new();
    // AI-selected subset of the candidate's StructuredProfile.SideProjects, tailored
    // to this posting. Education/MilitaryService/SpokenLanguages are NOT persisted
    // here — the PDF renders those straight from StructuredProfile, unedited.
    public List<SideProjectItem> SideProjects { get; init; } = new();
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

// Raw Claude output, kept distinct from the persisted document (same split
// InterviewInsight/InterviewInsightsSynthesis uses).
public sealed record ResumePackSynthesis
{
    public string TailoredSummary { get; init; } = "";
    public List<TailoredExperienceItem> Experience { get; init; } = new();
    public List<SkillCategory> HighlightedSkills { get; init; } = new();
    public List<SideProjectItem> SideProjects { get; init; } = new();
    public List<ProvenanceRow> Provenance { get; init; } = new();
}
