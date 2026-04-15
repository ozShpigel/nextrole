using JobMatchService.Core.AI;
using JobMatchService.Core.Models;
using JobMatchService.Core.Profile;
using JobMatchService.Core.Services;
using JobMatchService.Infrastructure.AI;
using JobMatchService.Infrastructure.ApplicationTracker;
using JobMatchService.Infrastructure.Profile;
using Microsoft.AspNetCore.Mvc;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration["ContentRoot"] = AppContext.BaseDirectory;

// Add services to the container
builder.Services.AddSingleton<PromptBuilder>();
builder.Services.AddSingleton<IClaudeClient, ClaudeClient>();
builder.Services.AddHttpClient("ProfileApi", client =>
{
    client.Timeout = TimeSpan.FromSeconds(10);
});
builder.Services.AddSingleton<IProfileProvider>(sp =>
    new FileProfileProvider(
        sp.GetRequiredService<IConfiguration>(),
        sp.GetRequiredService<ILoggerFactory>().CreateLogger<FileProfileProvider>(),
        sp.GetRequiredService<IHttpClientFactory>()));
builder.Services.AddScoped<IJobMatchService, JobMatchService.Core.Services.JobMatchService>();

// ApplicationTracker integration
builder.Services.AddHttpClient<IApplicationTrackerClient, ApplicationTrackerClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["ApplicationTracker:BaseUrl"]
        ?? "http://localhost:5002");
    client.Timeout = TimeSpan.FromSeconds(25);
});

// Add OpenAPI
builder.Services.AddOpenApi();

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.UseHttpsRedirection();

app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "job-match" }))
    .WithName("Health")
    .WithSummary("Liveness check for orchestration and smoke tests");

// Job Match endpoint
app.MapPost("/api/match", async (
    [FromBody] MatchRequest request,
    IJobMatchService jobMatchService,
    ILogger<Program> logger,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request?.JobDescription))
    {
        logger.LogWarning("Invalid request: JobDescription is null or empty");
        return Results.BadRequest(new { error = "JobDescription is required" });
    }

    try
    {
        var response = await jobMatchService.AnalyzeMatchAsync(
            request.JobDescription, 
            cancellationToken);
        
        return Results.Ok(response);
    }
    catch (FileNotFoundException ex)
    {
        logger.LogError(ex, "Profile file not found");
        return Results.NotFound(new { error = "Profile file not found. Please ensure Data/professional-profile.md exists." });
    }
    catch (InvalidOperationException ex) when (ex.Message.Contains("ApiKey"))
    {
        logger.LogError(ex, "Anthropic API key not configured");
        return Results.Problem(
            detail: "Anthropic API key is not configured. Please set Anthropic:ApiKey in appsettings.json",
            statusCode: 500);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error processing match request");
        return Results.Problem(
            detail: "An error occurred while processing the request",
            statusCode: 500);
    }
})
.WithName("AnalyzeJobMatch")
.WithSummary("Analyze job match")
.WithDescription("Analyzes a job description and returns a detailed match assessment");

app.MapGet("/api/match/tracker-ready", async (
    IApplicationTrackerClient trackerClient,
    CancellationToken ct) =>
{
    var ok = await trackerClient.IsTrackerHealthyAsync(ct);
    return ok
        ? Results.Ok(new { ready = true })
        : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
})
.WithName("TrackerReady")
.WithSummary("Returns 200 when Application Tracker responds (for cold-start polling from the UI)");

// Save to Application Tracker endpoint
app.MapPost("/api/match/save-to-tracker", async (
    [FromBody] SaveToTrackerRequest request,
    IApplicationTrackerClient trackerClient,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    try
    {
        var exists = await trackerClient.IsApplicationExistsAsync(
            request.Company,
            request.JobTitle,
            ct);

        if (exists)
        {
            return Results.Conflict(new
            {
                error = "Application already exists in tracker",
                message = $"משרה ב-{request.Company} כבר קיימת במעקב"
            });
        }

        var success = await trackerClient.CreateApplicationAsync(
            new CreateApplicationRequest
            {
                JobTitle = request.JobTitle,
                Company = request.Company,
                Status = request.CvSent ? "Applied" : "Analyzing",
                MatchScore = request.MatchScore,
                MatchVerdict = request.MatchVerdict,
                JobDescription = request.JobDescription,
                MatchAnalysis = request.MatchAnalysis
            },
            ct);

        if (success)
        {
            logger.LogInformation("Application saved to tracker: {Company} - {JobTitle}", request.Company, request.JobTitle);
            return Results.Ok(new
            {
                message = "נשמר במעקב בהצלחה",
                status = request.CvSent ? "Applied" : "Analyzing"
            });
        }

        return Results.Problem(
            detail: "ApplicationTracker service is not available or returned an error",
            statusCode: 503);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error saving to tracker");
        return Results.Problem(detail: ex.Message, statusCode: 500);
    }
})
.WithName("SaveToTracker")
.WithSummary("Save analyzed job to Application Tracker");

app.Run();

// ============================================================
// REQUEST DTOs
// ============================================================

public sealed record SaveToTrackerRequest
{
    public required string JobTitle { get; init; }
    public required string Company { get; init; }
    public int? MatchScore { get; init; }
    public string? MatchVerdict { get; init; }
    public string? JobDescription { get; init; }
    public string? MatchAnalysis { get; init; }
    public bool CvSent { get; init; }
}
