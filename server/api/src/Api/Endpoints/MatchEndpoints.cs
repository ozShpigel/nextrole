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

        app.MapPost("/api/match/test-prompt", async (
            [FromBody] TestPromptRequest request,
            IJobMatchService jobMatchService,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null || string.IsNullOrWhiteSpace(request.JobDescription))
                return Results.BadRequest(new { error = "JobDescription is required" });

            if (request.Target is not ("analyst" or "evaluator"))
                return Results.BadRequest(new { error = "target must be 'analyst' or 'evaluator'" });

            if (request.JobDescription.Length > 50_000)
                return Results.BadRequest(new { error = "JobDescription exceeds maximum length of 50,000 characters" });

            try
            {
                var result = await jobMatchService.TestPromptAsync(request, ct);
                return Results.Ok(result);
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
                logger.LogError(ex, "Error processing test-prompt request");
                return Results.Problem(detail: "An error occurred while processing the request", statusCode: 500);
            }
        })
        .RequireRateLimiting("match")
        .WithName("TestPrompt")
        .WithSummary("Dry-run a candidate prompt/config against a sample job without persisting");

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
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("UpdateProfile")
        .WithSummary("Update profile, scoring config, and/or prompts (all fields optional)");

        app.MapGet("/api/match/profile/history/{field}", async (
            string field,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var entries = await provider.GetHistoryAsync(field, ct);
                return Results.Ok(new { entries });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load profile history for {Field}", field);
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("GetProfileHistory")
        .WithSummary("List prior versions of a profile field (content, analyst_prompt, evaluator_prompt, scoring_config)");

        app.MapPost("/api/match/profile/history/{field}/restore", async (
            string field,
            [FromBody] RestoreHistoryRequest request,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                await provider.RestoreHistoryAsync(field, request?.Index ?? -1, ct);
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
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to restore profile history for {Field}", field);
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("RestoreProfileHistory")
        .WithSummary("Restore a profile field to a prior version (current value is snapshotted, so restore is undoable)");

        // ── Interview prep ───────────────────────────────────────────────────
        static object ToInterviewPrepResponse(InterviewPrepDocument doc) => new
        {
            self_presentation_hr = doc.SelfPresentationHr,
            self_presentation_technical = doc.SelfPresentationTechnical,
            presenting_work_project = doc.PresentingWorkProject,
            presenting_personal_project = doc.PresentingPersonalProject,
            qa_rubric = doc.QaRubric.Select(e => new { question = e.Question, answer = e.Answer }),
            updated_at = doc.UpdatedAt
        };

        app.MapGet("/api/match/interview-prep", async (
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var doc = await provider.GetInterviewPrepAsync(ct);
                return Results.Ok(ToInterviewPrepResponse(doc));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load interview prep");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("GetInterviewPrep")
        .WithSummary("Get stored interview prep content (self-presentation, Q&A rubric, project pitches)");

        app.MapPut("/api/match/interview-prep", async (
            [FromBody] InterviewPrepRequest request,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null)
                return Results.BadRequest(new { error = "request body is required" });

            if (request.SelfPresentationHr is null
                && request.SelfPresentationTechnical is null
                && request.PresentingWorkProject is null
                && request.PresentingPersonalProject is null
                && request.QaRubric is null)
            {
                return Results.BadRequest(new { error = "at least one field must be provided" });
            }

            try
            {
                var qa = request.QaRubric?
                    .Select(e => new QaEntry { Question = e.Question, Answer = e.Answer })
                    .ToList();
                await provider.UpsertInterviewPrepAsync(
                    request.SelfPresentationHr,
                    request.SelfPresentationTechnical,
                    request.PresentingWorkProject,
                    request.PresentingPersonalProject,
                    qa,
                    ct);
                var updated = await provider.GetInterviewPrepAsync(ct);
                return Results.Ok(ToInterviewPrepResponse(updated));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to update interview prep");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("UpdateInterviewPrep")
        .WithSummary("Update interview prep content (all fields optional, carry-forward semantics)");

        app.MapGet("/api/match/interview-prep/history/{field}", async (
            string field,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var entries = await provider.GetInterviewPrepHistoryAsync(field, ct);
                return Results.Ok(new { entries });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load interview prep history for {Field}", field);
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("GetInterviewPrepHistory")
        .WithSummary("List prior versions of an interview prep field");

        app.MapPost("/api/match/interview-prep/history/{field}/restore", async (
            string field,
            [FromBody] RestoreHistoryRequest request,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                await provider.RestoreInterviewPrepHistoryAsync(field, request?.Index ?? -1, ct);
                var updated = await provider.GetInterviewPrepAsync(ct);
                return Results.Ok(ToInterviewPrepResponse(updated));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to restore interview prep history for {Field}", field);
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("RestoreInterviewPrepHistory")
        .WithSummary("Restore an interview prep field to a prior version (current value is snapshotted, so restore is undoable)");

        return app;
    }
}
