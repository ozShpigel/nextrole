namespace ApplicationTracker.Core.Profile;

public interface IProfileProvider
{
    Task<string> GetProfileAsync(CancellationToken cancellationToken = default);
    Task<ProfileDocument> GetProfileDocumentAsync(CancellationToken cancellationToken = default);
    Task UpsertProfileAsync(string? content, CancellationToken cancellationToken = default);

    // Version history: snapshots of prior values of the profile `content`,
    // newest-first. (Prompts and scoring config are read-only configuration and
    // are no longer stored or versioned here.)
    Task<IReadOnlyList<ProfileHistoryEntry>> GetHistoryAsync(string field, CancellationToken cancellationToken = default);
    Task RestoreHistoryAsync(string field, int index, CancellationToken cancellationToken = default);

    // Interview prep — standalone authored content (self-presentation, Q&A rubric,
    // project pitches). Stored under an `interview_prep` sub-object on the same
    // singleton doc, with its own version history. Per-field carry-forward semantics.
    Task<InterviewPrepDocument> GetInterviewPrepAsync(CancellationToken cancellationToken = default);
    Task UpsertInterviewPrepAsync(
        string? selfPresentationHr,
        string? selfPresentationTechnical,
        string? presentingWorkProject,
        string? presentingPersonalProject,
        IReadOnlyList<QaEntry>? qaRubric,
        CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProfileHistoryEntry>> GetInterviewPrepHistoryAsync(string field, CancellationToken cancellationToken = default);
    Task RestoreInterviewPrepHistoryAsync(string field, int index, CancellationToken cancellationToken = default);

    // Persist generated keyword cues for a self-presentation field
    // (self_presentation_hr | self_presentation_technical). Stored alongside the
    // text so they survive reloads; invalidated when the text changes on save.
    Task SetPresentationCuesAsync(string field, IReadOnlyList<string> cues, CancellationToken cancellationToken = default);
}

public sealed record QaEntry
{
    public string Question { get; init; } = "";
    public string Answer { get; init; } = "";
}

public sealed record InterviewPrepDocument
{
    public string SelfPresentationHr { get; init; } = "";
    public string SelfPresentationTechnical { get; init; } = "";
    public string PresentingWorkProject { get; init; } = "";
    public string PresentingPersonalProject { get; init; } = "";
    public IReadOnlyList<QaEntry> QaRubric { get; init; } = Array.Empty<QaEntry>();
    // Cached keyword cues for each self-presentation, tied to the saved text.
    // Dropped automatically when the underlying presentation text changes.
    public IReadOnlyList<string> SelfPresentationHrCues { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> SelfPresentationTechnicalCues { get; init; } = Array.Empty<string>();
    public DateTime? UpdatedAt { get; init; }
}

public sealed record ProfileHistoryEntry
{
    public int Index { get; init; }
    public DateTime? SavedAt { get; init; }
    public string Preview { get; init; } = "";
    public int Length { get; init; }
}

public sealed record ProfileDocument
{
    public string Content { get; init; } = "";
    public DateTime? UpdatedAt { get; init; }
}
