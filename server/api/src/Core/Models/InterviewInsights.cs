using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// Singleton, persisted observation feed — a standing, free-form summary Claude
// wrote after reading every interview retro together. Pure observation: no
// rubric shape, no adopt-into-Q&A action (decoupled from interview-prep by
// design — the rubric adoption UX wasn't intuitive enough yet to justify the
// coupling; revisit if that changes).
// Regenerated on demand from the raw retro text each time (never a summary of
// the previous summary) so it can't drift through repeated re-summarization.
public sealed record InterviewInsight
{
    public const string SingletonId = "current";

    [BsonId]
    public string Id { get; init; } = SingletonId;
    public string Summary { get; init; } = "";
    // Interview.Id values (as strings) that contributed to this Summary —
    // diffed against the current retro set to report how many are new since.
    public List<string> SourceRetroIds { get; init; } = new();
    public DateTime GeneratedAt { get; init; } = DateTime.UtcNow;
}

// Raw Claude output for one synthesis call.
public sealed record InterviewInsightsSynthesis
{
    public string Summary { get; init; } = "";
}
