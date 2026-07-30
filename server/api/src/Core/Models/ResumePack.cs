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
    public List<string> HighlightedSkills { get; init; } = new();
    public DateTime GeneratedAt { get; init; } = DateTime.UtcNow;
}

public sealed record TailoredExperienceItem
{
    public string Title { get; init; } = "";
    public string Company { get; init; } = "";
    public string Dates { get; init; } = "";
    public List<string> Highlights { get; init; } = new();
}

// Raw Claude output, kept distinct from the persisted document (same split
// InterviewInsight/InterviewInsightsSynthesis uses).
public sealed record ResumePackSynthesis
{
    public string TailoredSummary { get; init; } = "";
    public List<TailoredExperienceItem> Experience { get; init; } = new();
    public List<string> HighlightedSkills { get; init; } = new();
}
