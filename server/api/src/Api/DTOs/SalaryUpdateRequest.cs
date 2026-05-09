namespace ApplicationTracker.Api.DTOs;

public record SalaryUpdateRequest
{
    public string? Salary { get; init; }
}
