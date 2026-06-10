using System.Text.Json.Serialization;

namespace ApplicationTracker.Core.Matching;

// Dry-run request: exercise CANDIDATE (unsaved) prompts/config against a sample
// job without persisting anything. Null candidate fields fall back to the saved
// effective values.
public sealed record TestPromptRequest
{
    // "analyst" => parse only; "evaluator" => parse (saved analyst) then evaluate
    [JsonPropertyName("target")]
    public string Target { get; init; } = "";

    [JsonPropertyName("job_description")]
    public string JobDescription { get; init; } = "";

    [JsonPropertyName("analyst_prompt")]
    public string? AnalystPrompt { get; init; }

    [JsonPropertyName("evaluator_prompt")]
    public string? EvaluatorPrompt { get; init; }

    [JsonPropertyName("profile")]
    public string? Profile { get; init; }

    [JsonPropertyName("scoring_config")]
    public Dictionary<string, object?>? ScoringConfig { get; init; }
}

public sealed record TestPromptStageResult
{
    public string Stage { get; init; } = "";          // "parse" | "evaluate"
    public bool DeserializedCleanly { get; init; }
    public string? RawOutput { get; init; }            // raw model text
    public string? Input { get; init; }                // serialized request input
    public string? Error { get; init; }                // failure message, if any
}

public sealed record TestPromptResult
{
    public bool Success { get; init; }
    public List<TestPromptStageResult> Stages { get; init; } = new();
    public ParsedJob? Parsed { get; init; }
    public MatchResponse? Evaluation { get; init; }    // null when target == "analyst"
    public int? OverallScore { get; init; }
    public string? Verdict { get; init; }
}
