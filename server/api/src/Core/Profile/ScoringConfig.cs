namespace ApplicationTracker.Core.Profile;

// Read-only scoring configuration. Bound from the "Scoring" config section via
// the Options pattern (IOptions<ScoringConfig>); the values live in
// appsettings.json and can be overridden per-deploy with environment variables
// (e.g. Scoring__Evaluator__Temperature, Scoring__MinScoreToSave,
// Scoring__VerdictBands__Yes). Admin-only — no runtime UI/endpoint edits.
// The defaults below act as a backstop if a key is absent from config.

public sealed record RoleScoringConfig
{
    public string Model { get; init; } = "claude-sonnet-4-6";
    public decimal Temperature { get; init; } = 0.5m;
    public int MaxTokens { get; init; } = 4096;
    public bool ThinkingEnabled { get; init; }
    public int ThinkingBudget { get; init; } = 2048;
}

// Score thresholds (inclusive lower bounds) that map an overallScore to a
// verdict. Below `No` => STRONG_NO; a null score => INSUFFICIENT_DATA.
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
