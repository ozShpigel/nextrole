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
        string? elevatorPitch = null,
        string? professionalIntro = null,
        string? extendedIntro = null,
        CancellationToken cancellationToken = default);
    Task<ScoringConfig> GetScoringConfigAsync(CancellationToken cancellationToken = default);
    ScoringConfig ResolveScoringConfig(Dictionary<string, object?>? scoringConfig);
    Task<string> GetAnalystPromptAsync(CancellationToken cancellationToken = default);
    Task<string> GetEvaluatorPromptAsync(CancellationToken cancellationToken = default);

    // Version history: snapshots of prior values for a tracked field
    // (content | analyst_prompt | evaluator_prompt | scoring_config), newest-first.
    Task<IReadOnlyList<ProfileHistoryEntry>> GetHistoryAsync(string field, CancellationToken cancellationToken = default);
    Task RestoreHistoryAsync(string field, int index, CancellationToken cancellationToken = default);
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
    public string? ElevatorPitch { get; init; }
    public string? ProfessionalIntro { get; init; }
    public string? ExtendedIntro { get; init; }
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

    public RoleScoringConfig Evaluator { get; init; } = new();

    public int MinScoreToSave { get; init; } = 70;

    public VerdictBands VerdictBands { get; init; } = new();
}
