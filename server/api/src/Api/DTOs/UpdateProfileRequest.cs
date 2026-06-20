using System.Text.Json.Serialization;

namespace ApplicationTracker.Api.DTOs;

public sealed record UpdateProfileRequest
{
    [JsonPropertyName("content")]
    public string? Content { get; init; }
}
