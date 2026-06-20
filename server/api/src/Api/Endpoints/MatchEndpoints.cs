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

        // ── Batch scoring path (cron-driven discovery) ──────────────────────────
        // Internal, scraper-to-API endpoints — not rate-limited like /api/match,
        // since the parse stage is called once per scraped job (well over 10/min).

        // Stage 1: analyst-only parse. Scraper calls this live per job, then sends
        // the parsed jobs to /api/match/batch.
        app.MapPost("/api/match/parse", async (
            [FromBody] MatchRequest request,
            IJobMatchService jobMatchService,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request?.JobDescription))
                return Results.BadRequest(new { error = "JobDescription is required" });
            if (request.JobDescription.Length > 50_000)
                return Results.BadRequest(new { error = "JobDescription exceeds maximum length of 50,000 characters" });
            try
            {
                var (parsed, snap) = await jobMatchService.ParseAsync(request, ct);
                return Results.Ok(new
                {
                    parsed,
                    analystSnapshotInput = snap.Input,
                    analystSnapshotOutput = snap.Output,
                });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error parsing job (batch path)");
                return Results.Problem(detail: "An error occurred while parsing the job", statusCode: 500);
            }
        })
        .WithName("ParseJob")
        .WithSummary("Analyst-only parse (batch path, stage 1)");

        // Stage 2: submit all parsed jobs as one evaluator batch. Returns the
        // Anthropic batch id to store on the discovery run.
        app.MapPost("/api/match/batch", async (
            [FromBody] List<EvaluationBatchItem> items,
            IJobMatchService jobMatchService,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (items is null || items.Count == 0)
                return Results.BadRequest(new { error = "at least one item is required" });
            try
            {
                var batchId = await jobMatchService.SubmitEvaluationBatchAsync(items, ct);
                return Results.Ok(new { batchId });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error submitting evaluation batch");
                return Results.Problem(detail: "An error occurred while submitting the batch", statusCode: 500);
            }
        })
        .WithName("SubmitEvaluationBatch")
        .WithSummary("Submit evaluator batch (batch path, stage 2)");

        // Stage 3: poll + collect. Returns status; once ended, one corrected
        // result line per CustomId (verdict-band/shouldApply already applied).
        app.MapGet("/api/match/batch/{batchId}", async (
            string batchId,
            IJobMatchService jobMatchService,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var result = await jobMatchService.GetEvaluationBatchAsync(batchId, ct);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error retrieving evaluation batch {BatchId}", batchId);
                return Results.Problem(detail: "An error occurred while retrieving the batch", statusCode: 500);
            }
        })
        .WithName("GetEvaluationBatch")
        .WithSummary("Poll/collect evaluator batch (batch path, stage 3)");

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
        .WithSummary("Get the stored professional profile content");

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
                await provider.UpsertProfileAsync(request.Content, ct);
                var updated = await provider.GetProfileDocumentAsync(ct);
                return Results.Ok(new
                {
                    content = updated.Content,
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
        .WithSummary("Update the professional profile content");

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
        .WithSummary("List prior versions of the profile content");

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
            self_presentation_hr_cues = doc.SelfPresentationHrCues,
            self_presentation_technical_cues = doc.SelfPresentationTechnicalCues,
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

        // Turn a self-presentation into short keyword cues (rehearsal aid). Cues
        // are cached per saved version: the text is read from the stored doc, and
        // a cached set is returned without a Claude call unless `force` is set.
        app.MapPost("/api/match/interview-prep/cues", async (
            [FromBody] PresentationCuesRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var field = request?.Field;
            if (field is not ("self_presentation_hr" or "self_presentation_technical"))
                return Results.BadRequest(new { error = "field must be 'self_presentation_hr' or 'self_presentation_technical'" });

            try
            {
                var prep = await provider.GetInterviewPrepAsync(ct);
                var text = field == "self_presentation_hr" ? prep.SelfPresentationHr : prep.SelfPresentationTechnical;
                var cached = field == "self_presentation_hr" ? prep.SelfPresentationHrCues : prep.SelfPresentationTechnicalCues;

                if (string.IsNullOrWhiteSpace(text))
                    return Results.BadRequest(new { error = "save some self-presentation text before generating cues" });

                if (!request!.Force && cached.Count > 0)
                    return Results.Ok(new { cues = cached, cached = true });

                var cues = await claude.GeneratePresentationCuesAsync(text, ct);
                await provider.SetPresentationCuesAsync(field, cues, ct);
                return Results.Ok(new { cues, cached = false });
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
                logger.LogError(ex, "Failed to generate presentation cues");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .RequireRateLimiting("match")
        .WithName("GeneratePresentationCues")
        .WithSummary("Turn a self-presentation into short keyword cues, cached per saved version (rehearsal reminders)");

        return app;
    }
}
