namespace ApplicationTracker.Core.Profile;

public interface IProfileProvider
{
    Task<string> GetProfileAsync(CancellationToken cancellationToken = default);
    Task<ProfileDocument> GetProfileDocumentAsync(CancellationToken cancellationToken = default);
    Task UpsertProfileAsync(
        string? content,
        Dictionary<string, object?>? scoringConfig,
        string? analystPrompt,
        string? evaluatorPrompt,
        CancellationToken cancellationToken = default);
    Task<ScoringConfig> GetScoringConfigAsync(CancellationToken cancellationToken = default);
    ScoringConfig ResolveScoringConfig(Dictionary<string, object?>? scoringConfig);
    Task<string> GetAnalystPromptAsync(CancellationToken cancellationToken = default);
    Task<string> GetEvaluatorPromptAsync(CancellationToken cancellationToken = default);

    // Version history: snapshots of prior values for a tracked field
    // (content | analyst_prompt | evaluator_prompt | scoring_config), newest-first.
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
    public Dictionary<string, object?> ScoringConfig { get; init; } = new();
    public string AnalystPrompt { get; init; } = "";
    public string EvaluatorPrompt { get; init; } = "";
    public bool AnalystIsOverride { get; init; }
    public bool EvaluatorIsOverride { get; init; }
    public DateTime? UpdatedAt { get; init; }
}

public sealed record RoleScoringConfig
{
    public string Model { get; init; } = "claude-sonnet-4-6";
    public decimal Temperature { get; init; } = 0.5m;
    public int MaxTokens { get; init; } = 4096;
    public bool ThinkingEnabled { get; init; }
    public int ThinkingBudget { get; init; } = 2048;
}

// Score thresholds (inclusive lower bounds) that map an overallScore to a
// verdict. Configurable from Settings so the user can retune bands without a
// code change. Below `No` => STRONG_NO; a null score => INSUFFICIENT_DATA.
public sealed record VerdictBands
{
    public int StrongYes { get; init; } = 80;
    public int Yes { get; init; } = 60;
    public int Maybe { get; init; } = 40;
    public int No { get; init; } = 20;
}

public sealed record ScoringConfig
{
    public RoleScoringConfig Analyst { get; init; } = new()
    {
        Model = "claude-haiku-4-5-20251001",
        Temperature = 0.3m,
        MaxTokens = 2048,
    };

    // 8192 (vs the 4096 base default): the evaluator emits a large verdict JSON
    // plus up to ~1K thinking tokens; 4096 truncated long verdicts mid-JSON
    // (stop_reason=max_tokens) → unparseable → MATCH_FAILED. Headroom is free —
    // only generated tokens are billed.
    public RoleScoringConfig Evaluator { get; init; } = new() { MaxTokens = 8192 };

    public int MinScoreToSave { get; init; } = 70;

    public VerdictBands VerdictBands { get; init; } = new();
}
