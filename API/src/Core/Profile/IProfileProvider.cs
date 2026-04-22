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
    Task<string> GetAnalystPromptAsync(CancellationToken cancellationToken = default);
    Task<string> GetEvaluatorPromptAsync(CancellationToken cancellationToken = default);
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
}
