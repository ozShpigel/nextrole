namespace ApplicationTracker.Api.DTOs;

public record TitleUpdateRequest
{
    public string? JobTitle { get; init; }
}
