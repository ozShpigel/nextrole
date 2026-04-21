using System.Text.Json.Serialization;
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
            analyst_prompt = doc.AnalystPrompt,
            evaluator_prompt = doc.EvaluatorPrompt,
            analyst_prompt_is_override = doc.AnalystIsOverride,
            evaluator_prompt_is_override = doc.EvaluatorIsOverride,
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
.WithSummary("Get the stored professional profile, scoring config, and prompts");

app.MapPut("/api/match/profile", async (
    [FromBody] UpdateProfileRequest request,
    IProfileProvider provider,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    if (request is null)
        return Results.BadRequest(new { error = "request body is required" });

    if (request.Content is null
        && request.ScoringConfig is null
        && request.AnalystPrompt is null
        && request.EvaluatorPrompt is null)
    {
        return Results.BadRequest(new { error = "at least one field must be provided" });
    }

    try
    {
        await provider.UpsertProfileAsync(
            request.Content,
            request.ScoringConfig,
            request.AnalystPrompt,
            request.EvaluatorPrompt,
            ct);
        var updated = await provider.GetProfileDocumentAsync(ct);
        return Results.Ok(new
        {
            content = updated.Content,
            scoring_config = updated.ScoringConfig,
            analyst_prompt = updated.AnalystPrompt,
            evaluator_prompt = updated.EvaluatorPrompt,
            analyst_prompt_is_override = updated.AnalystIsOverride,
            evaluator_prompt_is_override = updated.EvaluatorIsOverride,
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
.WithSummary("Update profile, scoring config, and/or prompts (all fields optional)");

app.Run();

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
}
