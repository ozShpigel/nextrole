namespace JobMatchService.Core.Profile;

public interface IProfileProvider
{
    Task<string> GetProfileAsync(CancellationToken cancellationToken = default);
    Task<ProfileDocument> GetProfileDocumentAsync(CancellationToken cancellationToken = default);
    Task UpsertProfileAsync(string content, Dictionary<string, object?>? scoringConfig, CancellationToken cancellationToken = default);
    Task<ScoringConfig> GetScoringConfigAsync(CancellationToken cancellationToken = default);
}

public sealed record ProfileDocument
{
    public string Content { get; init; } = "";
    public Dictionary<string, object?> ScoringConfig { get; init; } = new();
    public DateTime? UpdatedAt { get; init; }
}

public sealed record ScoringConfig
{
    public string Model { get; init; } = "claude-opus-4-20250514";
    public decimal Temperature { get; init; } = 0.5m;
    public int MaxTokens { get; init; } = 4096;
    public bool ThinkingEnabled { get; init; }
    public int ThinkingBudget { get; init; } = 2048;
    public int MinScoreToSave { get; init; } = 70;
}
