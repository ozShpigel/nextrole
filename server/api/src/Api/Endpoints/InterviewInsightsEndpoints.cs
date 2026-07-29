using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;

namespace ApplicationTracker.Api.Endpoints;

public static class InterviewInsightsEndpoints
{
    // Below this, a synthesis call would be guessing from too little signal —
    // short-circuit rather than spend an AI call on it.
    private const int MinRetrosForSynthesis = 2;

    public static WebApplication MapInterviewInsightsEndpoints(this WebApplication app)
    {
        // Cross-application retro log, most recent interview first. GET is
        // never demo-gated (the middleware only blocks mutating verbs).
        app.MapGet("/api/interview-insights/retros", async (
            IInterviewRepository interviewRepo,
            IApplicationRepository appRepo,
            CancellationToken ct) =>
        {
            var retros = await interviewRepo.GetRetrosAsync(ct);
            var appIds = retros.Select(i => i.ApplicationId).Distinct();
            var apps = (await appRepo.GetByIdsAsync(appIds, ct)).ToDictionary(a => a.Id);

            var result = retros.Select(i =>
            {
                apps.TryGetValue(i.ApplicationId, out var a);
                return new
                {
                    interview = i,
                    applicationId = i.ApplicationId,
                    company = a?.Company,
                    jobTitle = a?.JobTitle,
                };
            });

            return Results.Ok(result);
        })
        .WithName("GetInterviewRetros")
        .WithSummary("List all completed interviews with a retro, most recent first");

        // The persisted, standing insight (if any) plus how stale it is relative
        // to the current retro set. Pure read — never demo-gated.
        app.MapGet("/api/interview-insights", async (
            IInterviewRepository interviewRepo,
            IInterviewInsightRepository insightRepo,
            CancellationToken ct) =>
        {
            var retros = await interviewRepo.GetRetrosAsync(ct);
            var insight = await insightRepo.GetAsync(ct);
            return Results.Ok(BuildResponse(insight, retros));
        })
        .WithName("GetInterviewInsight")
        .WithSummary("Get the persisted interview-insight summary and its staleness");

        // Regenerates the observation summary from ALL current retro text (never
        // from the previous summary — see InterviewInsight's doc comment) and
        // persists it. This is now a write (unlike the old ephemeral synthesis),
        // so it's a normal demo-blocked mutation, not allowlisted.
        app.MapPost("/api/interview-insights/synthesize", async (
            IInterviewRepository interviewRepo,
            IInterviewInsightRepository insightRepo,
            IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var retros = await interviewRepo.GetRetrosAsync(ct);
            if (retros.Count < MinRetrosForSynthesis)
            {
                var existing = await insightRepo.GetAsync(ct);
                return Results.Ok(BuildResponse(existing, retros));
            }

            try
            {
                var synthesis = await claude.GenerateInterviewInsightAsync(retros, ct);
                var saved = await insightRepo.UpsertAsync(new InterviewInsight
                {
                    Summary = synthesis.Summary,
                    SourceRetroIds = retros.Select(r => r.Id.ToString()).ToList(),
                    GeneratedAt = DateTime.UtcNow,
                }, ct);
                return Results.Ok(BuildResponse(saved, retros));
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
                logger.LogError(ex, "Error generating interview insight");
                return Results.Problem("An error occurred while generating the interview insight.", statusCode: 500);
            }
        })
        .RequireRateLimiting("insights")
        .WithName("SynthesizeInterviewInsight")
        .WithSummary("Regenerate the interview-insight summary from the current retros");

        return app;
    }

    private static object BuildResponse(InterviewInsight? insight, List<Interview> currentRetros)
    {
        var currentIds = currentRetros.Select(r => r.Id.ToString()).ToHashSet();
        var newRetroCount = insight is null
            ? currentRetros.Count
            : currentIds.Except(insight.SourceRetroIds).Count();

        return new
        {
            insight = insight is null ? null : new
            {
                summary = insight.Summary,
                generatedAt = insight.GeneratedAt,
                retroCount = insight.SourceRetroIds.Count,
            },
            newRetroCount,
            totalRetroCount = currentRetros.Count,
            insufficientData = currentRetros.Count < MinRetrosForSynthesis,
        };
    }
}
