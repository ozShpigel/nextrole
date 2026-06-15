using ApplicationTracker.Api.DTOs;
using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using Microsoft.AspNetCore.Mvc;

namespace ApplicationTracker.Api.Endpoints;

public static class MockInterviewEndpoints
{
    private const int MaxTurns = 80;
    private const int MaxTurnLength = 20_000;

    public static WebApplication MapMockInterviewEndpoints(this WebApplication app)
    {
        // Stateless turn engine: client sends the full transcript, gets back the
        // interviewer's next reply (nudge on the prior answer + next question).
        app.MapPost("/api/mock-interview/turn", async (
            [FromBody] MockInterviewTurnRequest request,
            IClaudeClient claude,
            IApplicationRepository appRepo,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null)
                return Results.BadRequest(new { error = "request body is required" });

            var transcript = NormalizeTranscript(request.Transcript, out var capError);
            if (capError is not null)
                return Results.BadRequest(new { error = capError });

            try
            {
                var ctx = await BuildContextAsync(request.Persona, request.Language, request.QuestionTarget, request.ApplicationId, appRepo, ct);
                var result = await claude.GenerateMockInterviewTurnAsync(ctx, transcript, ct);
                return Results.Ok(new
                {
                    nudge = result.Nudge,
                    nextQuestion = result.NextQuestion,
                    isFollowUp = result.IsFollowUp,
                    done = result.Done,
                });
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
                logger.LogError(ex, "Error generating mock interview turn");
                return Results.Problem("An error occurred while generating the interview turn.", statusCode: 500);
            }
        })
        .RequireRateLimiting("mock")
        .WithName("MockInterviewTurn")
        .WithSummary("Generate the interviewer's next turn (stateless; client holds the transcript)");

        // End-of-session debrief: score the transcript + return feedback/rewrites.
        app.MapPost("/api/mock-interview/debrief", async (
            [FromBody] MockInterviewTurnRequest request,
            IClaudeClient claude,
            IApplicationRepository appRepo,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null)
                return Results.BadRequest(new { error = "request body is required" });

            var transcript = NormalizeTranscript(request.Transcript, out var capError);
            if (capError is not null)
                return Results.BadRequest(new { error = capError });
            if (transcript.Count == 0)
                return Results.BadRequest(new { error = "transcript is empty — nothing to debrief" });

            try
            {
                var ctx = await BuildContextAsync(request.Persona, request.Language, request.QuestionTarget, request.ApplicationId, appRepo, ct);
                var debrief = await claude.GenerateMockInterviewDebriefAsync(ctx, transcript, ct);
                return Results.Ok(debrief);
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
                logger.LogError(ex, "Error generating mock interview debrief");
                return Results.Problem("An error occurred while generating the debrief.", statusCode: 500);
            }
        })
        .RequireRateLimiting("mock")
        .WithName("MockInterviewDebrief")
        .WithSummary("Score a finished mock interview and return feedback + rewrites");

        // Persist a completed session for later review.
        app.MapPost("/api/mock-interview/sessions", async (
            [FromBody] SaveMockSessionRequest request,
            IMockInterviewRepository repo,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null)
                return Results.BadRequest(new { error = "request body is required" });

            var turns = NormalizeTranscript(request.Transcript, out var capError);
            if (capError is not null)
                return Results.BadRequest(new { error = capError });

            try
            {
                var session = new MockInterviewSession
                {
                    Persona = NormalizePersona(request.Persona),
                    Mode = request.Mode == "bound" ? "bound" : "generic",
                    Language = NormalizeLanguage(request.Language),
                    ApplicationId = request.ApplicationId,
                    Company = request.Company,
                    JobTitle = request.JobTitle,
                    Turns = turns,
                    Debrief = request.Debrief,
                    CompletedAt = request.Debrief != null ? DateTime.UtcNow : null,
                };
                var created = await repo.CreateAsync(session, ct);
                return Results.Created($"/api/mock-interview/sessions/{created.Id}", created);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error saving mock interview session");
                return Results.Problem("An error occurred while saving the session.", statusCode: 500);
            }
        })
        .WithName("SaveMockInterviewSession")
        .WithSummary("Persist a completed mock interview session");

        // List saved sessions (lightweight — no transcripts).
        app.MapGet("/api/mock-interview/sessions", async (
            IMockInterviewRepository repo,
            CancellationToken ct) =>
        {
            var sessions = await repo.GetAllAsync(ct);
            var items = sessions.Select(s => new
            {
                id = s.Id,
                persona = s.Persona,
                mode = s.Mode,
                company = s.Company,
                jobTitle = s.JobTitle,
                language = s.Language,
                scores = s.Debrief?.Scores,
                answerCount = s.Turns.Count(t => t.Role == "candidate"),
                createdAt = s.CreatedAt,
                completedAt = s.CompletedAt,
            });
            return Results.Ok(items);
        })
        .WithName("ListMockInterviewSessions")
        .WithSummary("List saved mock interview sessions (lightweight projection)");

        // Full session (transcript + debrief) for review.
        app.MapGet("/api/mock-interview/sessions/{id:guid}", async (
            Guid id,
            IMockInterviewRepository repo,
            CancellationToken ct) =>
        {
            var session = await repo.GetByIdAsync(id, ct);
            return session is null ? Results.NotFound() : Results.Ok(session);
        })
        .WithName("GetMockInterviewSession")
        .WithSummary("Get a saved mock interview session with full transcript and debrief");

        app.MapDelete("/api/mock-interview/sessions/{id:guid}", async (
            Guid id,
            IMockInterviewRepository repo,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                await repo.DeleteAsync(id, ct);
                return Results.NoContent();
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error deleting mock interview session {Id}", id);
                return Results.Problem("An error occurred while deleting the session.", statusCode: 500);
            }
        })
        .WithName("DeleteMockInterviewSession")
        .WithSummary("Delete a saved mock interview session");

        // Closed loop: adopt a debrief rewrite into the interview-prep Q&A rubric.
        // Appends through the existing upsert path so it snapshots into history
        // (undoable) and never touches the scoring fields.
        app.MapPost("/api/mock-interview/adopt-rubric", async (
            [FromBody] AdoptRubricRequest request,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null || string.IsNullOrWhiteSpace(request.Question) || string.IsNullOrWhiteSpace(request.Answer))
                return Results.BadRequest(new { error = "question and answer are required" });

            try
            {
                var prep = await provider.GetInterviewPrepAsync(ct);
                var rubric = prep.QaRubric.ToList();
                rubric.Add(new QaEntry { Question = request.Question.Trim(), Answer = request.Answer.Trim() });
                await provider.UpsertInterviewPrepAsync(null, null, null, null, rubric, ct);
                return Results.Ok(new { adopted = true, count = rubric.Count });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error adopting rewrite into Q&A rubric");
                return Results.Problem("An error occurred while updating the rubric.", statusCode: 500);
            }
        })
        .WithName("AdoptMockRewriteIntoRubric")
        .WithSummary("Append a debrief rewrite into the interview-prep Q&A rubric");

        return app;
    }

    private static async Task<MockInterviewContext> BuildContextAsync(
        string? persona, string? language, int? questionTarget, Guid? applicationId,
        IApplicationRepository appRepo, CancellationToken ct)
    {
        Application? app = null;
        if (applicationId is { } id)
            app = await appRepo.GetByIdAsync(id, ct);

        var target = questionTarget ?? 6;
        target = Math.Clamp(target, 3, 12);

        return new MockInterviewContext
        {
            Persona = NormalizePersona(persona),
            Language = NormalizeLanguage(language),
            QuestionTarget = target,
            Application = app,
        };
    }

    private static string NormalizePersona(string? persona) =>
        persona == "technical" ? "technical" : "hr";

    private static string NormalizeLanguage(string? language) =>
        language == "en" ? "en" : "he";

    // Maps the wire DTOs to domain turns, enforcing count/length caps. Returns a
    // non-null error string (out param) when a cap is exceeded.
    private static List<MockInterviewTurn> NormalizeTranscript(List<MockTurnDto>? transcript, out string? error)
    {
        error = null;
        var turns = transcript ?? new List<MockTurnDto>();
        if (turns.Count > MaxTurns)
        {
            error = $"transcript exceeds maximum of {MaxTurns} turns";
            return new List<MockInterviewTurn>();
        }
        foreach (var t in turns)
        {
            if ((t.Text?.Length ?? 0) > MaxTurnLength)
            {
                error = $"a transcript turn exceeds maximum length of {MaxTurnLength} characters";
                return new List<MockInterviewTurn>();
            }
        }
        return turns.Select(t => new MockInterviewTurn
        {
            Role = t.Role == "candidate" ? "candidate" : "interviewer",
            Text = t.Text ?? "",
            Nudge = t.Nudge,
            IsFollowUp = t.IsFollowUp,
        }).ToList();
    }
}
