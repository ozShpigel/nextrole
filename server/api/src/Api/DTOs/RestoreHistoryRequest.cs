using System.Text.Json.Serialization;

namespace ApplicationTracker.Api.DTOs;

public sealed record RestoreHistoryRequest
{
    [JsonPropertyName("index")]
    public int Index { get; init; }
}
