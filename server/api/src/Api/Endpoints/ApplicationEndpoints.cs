using System.Text.Json;
using System.Text.Json.Nodes;
using ApplicationTracker.Api.DTOs;
using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using Microsoft.AspNetCore.Mvc;

namespace ApplicationTracker.Api.Endpoints;

public static class ApplicationEndpoints
{
    // Statuses where an active interview process is underway — mirrors the
    // client's INTERVIEWING_STATUSES (lib/tracker.ts). Crossing into this set
    // for the first time is what triggers the deferred narrative enrichment
    // below, instead of firing it on every Add like NarrativeEnrichment used
    // to (most added jobs never reach an interview — see EnrichNarrativeOnInterviewingAsync).
    private static readonly HashSet<ApplicationStatus> InterviewingStatuses =
    [
        ApplicationStatus.PhoneScreen,
        ApplicationStatus.TechnicalInterview,
        ApplicationStatus.FinalRound,
        ApplicationStatus.OfferReceived,
        ApplicationStatus.Accepted,
    ];

    private static readonly JsonSerializerOptions CamelCase = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly JsonSerializerOptions CaseInsensitive = new() { PropertyNameCaseInsensitive = true };

    // Fired once, the first time an application crosses into an interviewing
    // status (see InterviewingStatuses) — replaces the old "enrich on Add"
    // behavior, which ran this same expensive full-narrative Claude call on
    // every added job regardless of whether it ever reached an interview.
    // Runs after the status-change response has already returned (fire-and-
    // forget from the endpoint below), so a slow/failed Claude call never
    // blocks the status update itself — best-effort, same as the old Add-time
    // version: a failure here just leaves the existing (terser) content in
    // place, which AnalysisCard renders fine either way. Resolves its own
    // services from a fresh DI scope since the request's scope (and anything
    // scoped resolved from it, like IApplicationRepository) is already
    // disposed by the time this runs.
    private static async Task EnrichNarrativeOnInterviewingAsync(Guid appId, IServiceScopeFactory scopeFactory)
    {
        using var scope = scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IApplicationRepository>();
        var claude = scope.ServiceProvider.GetRequiredService<IClaudeClient>();
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

        try
        {
            var app = await repo.GetByIdAsync(appId, CancellationToken.None);
            if (app is null || string.IsNullOrWhiteSpace(app.MatchAnalysis) || string.IsNullOrWhiteSpace(app.JobDescription))
                return;

            var existingNode = JsonNode.Parse(app.MatchAnalysis)?.AsObject();
            var overallScore = existingNode?["overallScore"]?.GetValue<int?>();
            var verdict = existingNode?["verdict"]?.GetValue<string>();
            if (existingNode is null || overallScore is null || verdict is null)
                return;

            var request = new NarrativeEnrichRequest
            {
                JobDescription = app.JobDescription,
                Title = app.JobTitle,
                Company = app.Company,
                CompanyNews = string.IsNullOrWhiteSpace(app.CompanyNews)
                    ? null
                    : JsonSerializer.Deserialize<List<CompanyNewsItem>>(app.CompanyNews, CaseInsensitive),
                GlassdoorData = string.IsNullOrWhiteSpace(app.GlassdoorData)
                    ? null
                    : JsonSerializer.Deserialize<GlassdoorData>(app.GlassdoorData, CaseInsensitive),
                OverallScore = overallScore.Value,
                Verdict = verdict,
                Breakdown = existingNode["breakdown"]?.Deserialize<Breakdown>(CaseInsensitive) ?? new Breakdown(),
                HardBlockers = existingNode["hardBlockers"]?.Deserialize<HardBlocker[]>(CaseInsensitive) ?? [],
                MustClarify = existingNode["mustClarify"]?.Deserialize<string[]>(CaseInsensitive) ?? [],
                StackedGaps = existingNode["stackedGaps"]?.Deserialize<string[]>(CaseInsensitive) ?? [],
            };

            var enriched = await claude.EnrichNarrativeAsync(request, CancellationToken.None);

            // Same merge shape as the old Python _enrich_saved_job: overwrite
            // only the narrative fields NarrativeEnrichment owns, leave every
            // other key in the stored blob (score, breakdown, hardBlockers, …)
            // untouched — hence JsonNode surgery rather than a typed
            // deserialize/re-serialize round-trip, which would silently drop
            // any field not modeled on MatchResponse.
            existingNode["honestAssessment"] = enriched.HonestAssessment;
            if (enriched.Recommendation is not null)
            {
                var shouldApply = existingNode["recommendation"]?["shouldApply"]?.GetValue<bool?>() ?? false;
                existingNode["recommendation"] = new JsonObject
                {
                    ["shouldApply"] = shouldApply,
                    ["keyReasons"] = JsonSerializer.SerializeToNode(enriched.Recommendation.KeyReasons, CamelCase),
                    ["questionsToAsk"] = JsonSerializer.SerializeToNode(enriched.Recommendation.QuestionsToAsk, CamelCase),
                    ["redFlags"] = JsonSerializer.SerializeToNode(enriched.Recommendation.RedFlags, CamelCase),
                    ["greenFlags"] = JsonSerializer.SerializeToNode(enriched.Recommendation.GreenFlags, CamelCase),
                };
            }
            if (enriched.CompanyNewsAnalysis is not null)
                existingNode["companyNewsAnalysis"] = JsonSerializer.SerializeToNode(enriched.CompanyNewsAnalysis, CamelCase);
            if (enriched.EmployeeReviewsAnalysis is not null)
                existingNode["employeeReviewsAnalysis"] = JsonSerializer.SerializeToNode(enriched.EmployeeReviewsAnalysis, CamelCase);

            var updated = app with { MatchAnalysis = existingNode.ToJsonString(), MatchAnalysisHebrew = null, UpdatedAt = DateTime.UtcNow };
            await repo.UpdateAsync(updated, CancellationToken.None);
            logger.LogInformation("Narrative enrichment completed for application {Id} on entering Interviewing", appId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Narrative enrichment failed for application {Id} on entering Interviewing", appId);
        }
    }

    public static WebApplication MapApplicationEndpoints(this WebApplication app)
    {
        app.MapPost("/api/applications", async (
            [FromBody] Application application,
            IApplicationRepository repo,
            IMatchSnapshotRepository snapshots,
            IStatusUpdateRepository statusRepo,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                // Content-address the raw Claude snapshot text into its own
                // collection before persisting — batch-scored jobs send the
                // same shared text on every one of their applications, and
                // this collapses N copies to one stored document (see
                // MatchSnapshot). The raw fields themselves are [BsonIgnore]
                // on Application, so clearing them here also keeps the
                // response body honest about what actually got stored.
                var snapshotId = await snapshots.UpsertAsync(
                    application.AnalystSnapshotInput, application.AnalystSnapshotOutput,
                    application.EvaluatorSnapshotInput, application.EvaluatorSnapshotOutput, ct);
                application = application with
                {
                    SnapshotId = snapshotId,
                    AnalystSnapshotInput = null,
                    AnalystSnapshotOutput = null,
                    EvaluatorSnapshotInput = null,
                    EvaluatorSnapshotOutput = null,
                };

                var (created, isNew) = await repo.CreateAsync(application, ct);

                if (!isNew)
                {
                    logger.LogInformation("Duplicate application suppressed: {Title} at {Company} (existing {Id})", created.JobTitle, created.Company, created.Id);
                    return Results.Ok(created);
                }

                await statusRepo.CreateAsync(new StatusUpdate
                {
                    ApplicationId = created.Id,
                    FromStatus = ApplicationStatus.Analyzing,
                    ToStatus = created.Status,
                    Note = "Job added to tracking"
                }, ct);

                logger.LogInformation("Application created: {Id} - {Title} at {Company}", created.Id, created.JobTitle, created.Company);
                return Results.Created($"/api/applications/{created.Id}", created);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error creating application");
                return Results.Problem("Error creating application");
            }
        })
        .WithName("CreateApplication")
        .WithSummary("Create a new application");

        app.MapGet("/api/applications", async (
            IApplicationRepository repo,
            CancellationToken ct) =>
        {
            var apps = await repo.GetAllListItemsAsync(ct);
            return Results.Ok(apps);
        })
        .WithName("GetAllApplications")
        .WithSummary("Get all applications");

        app.MapGet("/api/applications/{id:guid}", async (
            Guid id,
            IApplicationRepository appRepo,
            IInterviewRepository interviewRepo,
            INoteRepository noteRepo,
            IStatusUpdateRepository statusRepo,
            IResumePackRepository packRepo,
            CancellationToken ct) =>
        {
            var application = await appRepo.GetByIdAsync(id, ct);
            if (application is null) return Results.NotFound();

            var interviewsTask = interviewRepo.GetByApplicationIdAsync(id, ct);
            var notesTask = noteRepo.GetByApplicationIdAsync(id, ct);
            var statusUpdatesTask = statusRepo.GetByApplicationIdAsync(id, ct);
            var packTask = packRepo.GetByApplicationIdAsync(id, ct);
            await Task.WhenAll(interviewsTask, notesTask, statusUpdatesTask, packTask);

            return Results.Ok(new
            {
                application,
                interviews = interviewsTask.Result,
                notes = notesTask.Result,
                statusUpdates = statusUpdatesTask.Result,
                hasPack = packTask.Result is not null,
                packGeneratedAt = packTask.Result?.GeneratedAt
            });
        })
        .WithName("GetApplication")
        .WithSummary("Get application with details");

        app.MapPut("/api/applications/{id:guid}/status", async (
            Guid id,
            [FromBody] StatusUpdateRequest request,
            IApplicationRepository repo,
            IStatusUpdateRepository statusRepo,
            IServiceScopeFactory scopeFactory,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var existing = await repo.GetByIdAsync(id, ct);
                if (existing is null) return Results.NotFound();

                var oldStatus = existing.Status;

                // Idempotency: a no-op transition (same status) must not append a
                // timeline row. Lets the daily sync / re-sync re-process the same
                // email without spamming duplicate "X ← X" status updates.
                if (request.NewStatus == oldStatus)
                {
                    logger.LogInformation("Application {Id} status unchanged ({Status}) — skipping status update", id, oldStatus);
                    return Results.Ok(existing);
                }

                var updated = existing with
                {
                    Status = request.NewStatus,
                    UpdatedAt = DateTime.UtcNow,
                    AppliedAt = request.NewStatus == ApplicationStatus.Applied ? DateTime.UtcNow : existing.AppliedAt
                };

                // Independent writes — run concurrently to save a round-trip.
                var updateTask = repo.UpdateAsync(updated, ct);
                var statusTask = statusRepo.CreateAsync(new StatusUpdate
                {
                    ApplicationId = id,
                    FromStatus = oldStatus,
                    ToStatus = request.NewStatus,
                    Note = request.Note
                }, ct);
                await Task.WhenAll(updateTask, statusTask);

                logger.LogInformation("Application {Id} status changed: {From} -> {To}", id, oldStatus, request.NewStatus);

                // Fire the deferred full-narrative enrichment the first time this
                // application crosses into an interviewing status — fire-and-forget
                // (not awaited) so a slow Claude call never holds up this response,
                // same as the old Add-time version's background-task behavior.
                if (!InterviewingStatuses.Contains(oldStatus) && InterviewingStatuses.Contains(request.NewStatus))
                {
                    _ = EnrichNarrativeOnInterviewingAsync(id, scopeFactory);
                }

                return Results.Ok(updated);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error updating application status");
                return Results.Problem("Error updating application status");
            }
        })
        .WithName("UpdateApplicationStatus")
        .WithSummary("Update application status");

        app.MapDelete("/api/applications/{id:guid}", async (
            Guid id,
            IApplicationRepository repo,
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
                logger.LogError(ex, "Error deleting application {Id}", id);
                return Results.Problem("Error deleting application");
            }
        })
        .WithName("DeleteApplication")
        .WithSummary("Delete application");

        app.MapPut("/api/applications/{id:guid}/salary", async (
            Guid id,
            [FromBody] SalaryUpdateRequest request,
            IApplicationRepository repo,
            CancellationToken ct) =>
        {
            var existing = await repo.GetByIdAsync(id, ct);
            if (existing is null) return Results.NotFound();

            var updated = existing with { Salary = request.Salary, UpdatedAt = DateTime.UtcNow };
            await repo.UpdateAsync(updated, ct);
            return Results.Ok(updated);
        })
        .WithName("UpdateApplicationSalary")
        .WithSummary("Update application salary");

        app.MapPut("/api/applications/{id:guid}/title", async (
            Guid id,
            [FromBody] TitleUpdateRequest request,
            IApplicationRepository repo,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request?.JobTitle))
                return Results.BadRequest(new { error = "jobTitle is required" });

            var existing = await repo.GetByIdAsync(id, ct);
            if (existing is null) return Results.NotFound();

            var updated = existing with { JobTitle = request.JobTitle.Trim(), UpdatedAt = DateTime.UtcNow };
            await repo.UpdateAsync(updated, ct);
            return Results.Ok(updated);
        })
        .WithName("UpdateApplicationTitle")
        .WithSummary("Update application job title");

        app.MapPut("/api/applications/{id:guid}/match-analysis", async (
            Guid id,
            [FromBody] MatchAnalysisUpdateRequest request,
            IApplicationRepository repo,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request?.MatchAnalysis))
                return Results.BadRequest(new { error = "matchAnalysis is required" });

            var existing = await repo.GetByIdAsync(id, ct);
            if (existing is null) return Results.NotFound();

            // Called by the scraper's background enrichment task, once the
            // on-demand full-narrative Claude call finishes — Add itself
            // already returned with whatever content was available at save
            // time (terse, or a stale enrichment), so this patches it in
            // place without blocking the click that created the application.
            // MatchAnalysisHebrew is cleared here: it was translated from the
            // MatchAnalysis this call is about to replace, so keeping it
            // around would silently show a translation of stale content.
            var updated = existing with { MatchAnalysis = request.MatchAnalysis, MatchAnalysisHebrew = null, UpdatedAt = DateTime.UtcNow };
            await repo.UpdateAsync(updated, ct);
            return Results.Ok(updated);
        })
        .WithName("UpdateApplicationMatchAnalysis")
        .WithSummary("Patch an application's match analysis (background narrative enrichment)");

        app.MapPost("/api/applications/{id:guid}/company-summary", async (
            Guid id,
            IApplicationRepository repo,
            IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var existing = await repo.GetByIdAsync(id, ct);
            if (existing is null) return Results.NotFound();

            var summary = await claude.SummarizeCompanyAsync(existing.Company, ct);
            var updated = existing with { CompanySummary = summary, UpdatedAt = DateTime.UtcNow };
            await repo.UpdateAsync(updated, ct);

            return Results.Ok(new { company_summary = summary });
        })
        .WithName("GenerateCompanySummary")
        .WithSummary("Generate AI company summary");

        app.MapPost("/api/applications/{id:guid}/why-work-here", async (
            Guid id,
            IApplicationRepository repo,
            IClaudeClient claude,
            IProfileProvider profile,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var existing = await repo.GetByIdAsync(id, ct);
            if (existing is null) return Results.NotFound();

            var profileText = await profile.GetProfileAsync(ct);
            var prep = await profile.GetInterviewPrepAsync(ct);
            var answer = await claude.GenerateWhyWorkHereAsync(existing, profileText, prep, ct);
            var updated = existing with { WhyWorkHere = answer, UpdatedAt = DateTime.UtcNow };
            await repo.UpdateAsync(updated, ct);

            return Results.Ok(new { why_work_here = answer });
        })
        .WithName("GenerateWhyWorkHere")
        .WithSummary("Generate a personalized 'why work here' interview answer");

        app.MapPost("/api/applications/{id:guid}/translate-analysis", async (
            Guid id,
            IApplicationRepository repo,
            IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var existing = await repo.GetByIdAsync(id, ct);
            if (existing is null) return Results.NotFound();

            // Translate once per application, not per page view — a cached
            // Hebrew translation is served as-is until MatchAnalysis itself
            // changes (which clears it — see the match-analysis PUT above).
            if (!string.IsNullOrWhiteSpace(existing.MatchAnalysisHebrew))
                return Results.Ok(new { matchAnalysisHebrew = existing.MatchAnalysisHebrew });

            if (string.IsNullOrWhiteSpace(existing.MatchAnalysis))
                return Results.BadRequest(new { error = "This application has no match analysis to translate" });

            var translated = await claude.TranslateMatchAnalysisAsync(existing.MatchAnalysis, ct);

            // Never store or return a failed translation — repair passes are
            // out of scope; the caller falls back to the English original.
            if (!MatchAnalysisTranslation.Validate(existing.MatchAnalysis, translated, out var error))
            {
                logger.LogWarning("Match analysis translation failed validation for application {Id}: {Error}", id, error);
                return Results.Problem(
                    "Translation did not pass validation; showing the English analysis instead.",
                    statusCode: StatusCodes.Status502BadGateway);
            }

            var updated = existing with { MatchAnalysisHebrew = translated, UpdatedAt = DateTime.UtcNow };
            await repo.UpdateAsync(updated, ct);

            return Results.Ok(new { matchAnalysisHebrew = translated });
        })
        .WithName("TranslateMatchAnalysis")
        .WithSummary("Translate an application's AI match analysis to Hebrew (cached after the first call)")
        .RequireRateLimiting("translate");

        app.MapGet("/api/applications/exists", async (
            [FromQuery] string company,
            [FromQuery] string jobTitle,
            IApplicationRepository repo,
            CancellationToken ct) =>
        {
            var exists = await repo.ExistsAsync(company, jobTitle, ct);
            return Results.Ok(exists);
        })
        .WithName("ApplicationExists")
        .WithSummary("Check if application exists by company and job title");

        return app;
    }
}
