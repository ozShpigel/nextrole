using System.Text.Json.Serialization;

namespace ApplicationTracker.Api.DTOs;

public sealed record UpdateProfileRequest
{
    [JsonPropertyName("content")]
    public string? Content { get; init; }

    [JsonPropertyName("scoring_config")]
    public Dictionary<string, object?>? ScoringConfig { get; init; }

    [JsonPropertyName("analyst_prompt")]
    public string? AnalystPrompt { get; init; }

    [JsonPropertyName("evaluator_prompt")]
    public string? EvaluatorPrompt { get; init; }

    [JsonPropertyName("elevator_pitch")]
    public string? ElevatorPitch { get; init; }

    [JsonPropertyName("professional_intro")]
    public string? ProfessionalIntro { get; init; }

    [JsonPropertyName("extended_intro")]
    public string? ExtendedIntro { get; init; }
}
