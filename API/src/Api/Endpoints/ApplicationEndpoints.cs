using ApplicationTracker.Api.DTOs;
using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Models;
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
                var created = await repo.CreateAsync(application, ct);

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
            var apps = await repo.GetAllAsync(ct);
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
                var updated = existing with
                {
                    Status = request.NewStatus,
                    UpdatedAt = DateTime.UtcNow,
                    AppliedAt = request.NewStatus == ApplicationStatus.Applied ? DateTime.UtcNow : existing.AppliedAt
                };

                await repo.UpdateAsync(updated, ct);

                await statusRepo.CreateAsync(new StatusUpdate
                {
                    ApplicationId = id,
                    FromStatus = oldStatus,
                    ToStatus = request.NewStatus,
                    Note = request.Note
                }, ct);

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
