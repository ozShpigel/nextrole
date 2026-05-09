using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Api.DTOs;

public record StatusUpdateRequest
{
    public required ApplicationStatus NewStatus { get; init; }
    public string? Note { get; init; }
}
