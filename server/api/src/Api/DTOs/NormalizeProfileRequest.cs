using System.Text.Json.Serialization;

namespace ApplicationTracker.Api.DTOs;

public sealed record NormalizeProfileRequest
{
    [JsonPropertyName("text")]
    public string? Text { get; init; }
}
