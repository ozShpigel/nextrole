namespace JobMatchService.Core.Models;

public sealed record ParsedJob
{
    public string JobTitle { get; init; } = "";
    public string? Company { get; init; }
    public string[] RequiredSkills { get; init; } = [];
    public string[] NiceToHaveSkills { get; init; } = [];
    public string? ExperienceLevel { get; init; }
    public CulturalSignals CulturalSignals { get; init; } = new();
    public TechnicalRequirements TechnicalRequirements { get; init; } = new();
    public string? DomainContext { get; init; }
    public string[] Responsibilities { get; init; } = [];
    public string[] Warnings { get; init; } = [];
    public string? RawDescription { get; init; }
}

public sealed record CulturalSignals
{
    public string[] Positive { get; init; } = [];
    public string[] Negative { get; init; } = [];
    public string[] Neutral { get; init; } = [];
}

public sealed record TechnicalRequirements
{
    public string[] Languages { get; init; } = [];
    public string[] Frameworks { get; init; } = [];
    public string[] Infrastructure { get; init; } = [];
    public string[] Databases { get; init; } = [];
}
