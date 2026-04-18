using JobMatchService.Core.AI;
using JobMatchService.Core.Models;
using JobMatchService.Core.Profile;
using JobMatchService.Core.Services;
using JobMatchService.Infrastructure.AI;
using JobMatchService.Infrastructure.Profile;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration["ContentRoot"] = AppContext.BaseDirectory;

// MongoDB
var mongoConn = builder.Configuration["MongoDB:ConnectionString"];
if (string.IsNullOrWhiteSpace(mongoConn))
    throw new InvalidOperationException(
        "MongoDB:ConnectionString is not configured. Set the MONGODB_CONNECTION_STRING environment variable before starting the service.");
builder.Services.AddSingleton<IMongoClient>(_ => new MongoClient(mongoConn));

// Profile + Claude
builder.Services.AddSingleton<PromptBuilder>();
builder.Services.AddSingleton<IProfileProvider, MongoProfileProvider>();
builder.Services.AddSingleton<IClaudeClient, ClaudeClient>();
builder.Services.AddScoped<IJobMatchService, JobMatchService.Core.Services.JobMatchService>();

builder.Services.AddOpenApi();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.UseHttpsRedirection();

app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "job-match" }))
    .WithName("Health")
    .WithSummary("Liveness check for orchestration and smoke tests");

app.MapPost("/api/match", async (
    [FromBody] MatchRequest request,
    IJobMatchService jobMatchService,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request?.JobDescription))
    {
        logger.LogWarning("Invalid request: JobDescription is null or empty");
        return Results.BadRequest(new { error = "JobDescription is required" });
    }

    try
    {
        var response = await jobMatchService.AnalyzeMatchAsync(request, ct);
        return Results.Ok(response);
    }
    catch (InvalidOperationException ex) when (ex.Message.Contains("ApiKey"))
    {
        logger.LogError(ex, "Anthropic API key not configured");
        return Results.Problem(
            detail: "Anthropic API key is not configured. Please set Anthropic:ApiKey in configuration.",
            statusCode: 500);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error processing match request");
        return Results.Problem(detail: "An error occurred while processing the request", statusCode: 500);
    }
})
.WithName("AnalyzeJobMatch")
.WithSummary("Analyze job match");

app.MapGet("/api/match/profile", async (
    IProfileProvider provider,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    try
    {
        var doc = await provider.GetProfileDocumentAsync(ct);
        return Results.Ok(new
        {
            content = doc.Content,
            scoring_config = doc.ScoringConfig,
            updated_at = doc.UpdatedAt
        });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to load profile");
        return Results.Problem(detail: ex.Message, statusCode: 500);
    }
})
.WithName("GetProfile")
.WithSummary("Get the stored professional profile + scoring config");

app.MapPut("/api/match/profile", async (
    [FromBody] UpdateProfileRequest request,
    IProfileProvider provider,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    if (request is null || request.Content is null)
        return Results.BadRequest(new { error = "content is required" });

    try
    {
        await provider.UpsertProfileAsync(request.Content, request.ScoringConfig, ct);
        var updated = await provider.GetProfileDocumentAsync(ct);
        return Results.Ok(new
        {
            content = updated.Content,
            scoring_config = updated.ScoringConfig,
            updated_at = updated.UpdatedAt
        });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to update profile");
        return Results.Problem(detail: ex.Message, statusCode: 500);
    }
})
.WithName("UpdateProfile")
.WithSummary("Update the stored professional profile + scoring config");

app.Run();

public sealed record UpdateProfileRequest
{
    public string? Content { get; init; }
    public Dictionary<string, object?>? ScoringConfig { get; init; }
}
