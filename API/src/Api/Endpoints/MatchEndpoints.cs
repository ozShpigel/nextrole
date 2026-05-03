using ApplicationTracker.Api.DTOs;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Profile;
using Microsoft.AspNetCore.Mvc;

namespace ApplicationTracker.Api.Endpoints;

public static class MatchEndpoints
{
    public static WebApplication MapMatchEndpoints(this WebApplication app)
    {
        app.MapPost("/api/match", async (
            [FromBody] MatchRequest request,
            IJobMatchService jobMatchService,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request?.JobDescription))
            {
                logger.LogWarning("Invalid match request: JobDescription is null or empty");
                return Results.BadRequest(new { error = "JobDescription is required" });
            }

            if (request.JobDescription.Length > 50_000)
            {
                return Results.BadRequest(new { error = "JobDescription exceeds maximum length of 50,000 characters" });
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
        .RequireRateLimiting("match")
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
                    elevator_pitch = doc.ElevatorPitch,
                    professional_intro = doc.ProfessionalIntro,
                    extended_intro = doc.ExtendedIntro,
                    updated_at = doc.UpdatedAt
                });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load profile");
                return Results.Problem("An internal error occurred.", statusCode: 500);
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
                && request.EvaluatorPrompt is null
                && request.ElevatorPitch is null
                && request.ProfessionalIntro is null
                && request.ExtendedIntro is null)
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
                    request.ElevatorPitch,
                    request.ProfessionalIntro,
                    request.ExtendedIntro,
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
                    elevator_pitch = updated.ElevatorPitch,
                    professional_intro = updated.ProfessionalIntro,
                    extended_intro = updated.ExtendedIntro,
                    updated_at = updated.UpdatedAt
                });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to update profile");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("UpdateProfile")
        .WithSummary("Update profile, scoring config, and/or prompts (all fields optional)");

        return app;
    }
}
