using ApplicationTracker.Api.DTOs;
using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using Microsoft.AspNetCore.Mvc;

namespace ApplicationTracker.Api.Endpoints;

public static class ApplicationEndpoints
{
    public static WebApplication MapApplicationEndpoints(this WebApplication app)
    {
        app.MapPost("/api/applications", async (
            [FromBody] Application application,
            IApplicationRepository repo,
            IStatusUpdateRepository statusRepo,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
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
                    Note = "משרה נוספה למעקב"
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
            CancellationToken ct) =>
        {
            var application = await appRepo.GetByIdAsync(id, ct);
            if (application is null) return Results.NotFound();

            var interviewsTask = interviewRepo.GetByApplicationIdAsync(id, ct);
            var notesTask = noteRepo.GetByApplicationIdAsync(id, ct);
            var statusUpdatesTask = statusRepo.GetByApplicationIdAsync(id, ct);
            await Task.WhenAll(interviewsTask, notesTask, statusUpdatesTask);

            return Results.Ok(new
            {
                application,
                interviews = interviewsTask.Result,
                notes = notesTask.Result,
                statusUpdates = statusUpdatesTask.Result
            });
        })
        .WithName("GetApplication")
        .WithSummary("Get application with details");

        app.MapPut("/api/applications/{id:guid}/status", async (
            Guid id,
            [FromBody] StatusUpdateRequest request,
            IApplicationRepository repo,
            IStatusUpdateRepository statusRepo,
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
