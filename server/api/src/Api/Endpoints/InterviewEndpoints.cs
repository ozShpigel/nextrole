using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using Microsoft.AspNetCore.Mvc;

namespace ApplicationTracker.Api.Endpoints;

public static class InterviewEndpoints
{
    // Marker the mailbot stamps on interviews it creates from parsed emails.
    // Must match Mailbot's MailbotOrchestrator interview Notes value.
    private const string AutoDetectedNote = "Auto-detected from email";

    public static WebApplication MapInterviewEndpoints(this WebApplication app)
    {
        app.MapPost("/api/applications/{id:guid}/interviews", async (
            Guid id,
            [FromBody] Interview interview,
            IApplicationRepository appRepo,
            IInterviewRepository repo,
            CancellationToken ct) =>
        {
            var existing = await appRepo.GetByIdAsync(id, ct);
            if (existing is null) return Results.NotFound();

            // Idempotency for mailbot-created interviews: multiple emails in one
            // scheduling thread can each be classified as "InterviewScheduled",
            // which would otherwise create a duplicate interview per email. When
            // the incoming interview is auto-detected, update the existing
            // auto-detected interview of the same type (refining its date/details)
            // instead of inserting a duplicate. Manual interviews are never merged.
            if (interview.Notes == AutoDetectedNote)
            {
                var current = await repo.GetByApplicationIdAsync(id, ct);
                var duplicate = current.FirstOrDefault(i =>
                    i.Type == interview.Type && i.Notes == AutoDetectedNote);
                if (duplicate is not null)
                {
                    var merged = duplicate with
                    {
                        ScheduledAt = interview.ScheduledAt,
                        Interviewer = interview.Interviewer ?? duplicate.Interviewer,
                        Topics = interview.Topics ?? duplicate.Topics,
                    };
                    await repo.UpdateAsync(merged, ct);
                    return Results.Ok(merged);
                }
            }

            var created = interview with { ApplicationId = id };
            await repo.CreateAsync(created, ct);
            return Results.Created($"/api/interviews/{created.Id}", created);
        })
        .WithName("CreateInterview")
        .WithSummary("Add interview to application");

        app.MapPut("/api/interviews/{id:guid}", async (
            Guid id,
            [FromBody] Interview interview,
            IInterviewRepository repo,
            CancellationToken ct) =>
        {
            var existing = await repo.GetByIdAsync(id, ct);
            if (existing is null) return Results.NotFound();

            var updated = interview with { Id = id, ApplicationId = existing.ApplicationId };
            await repo.UpdateAsync(updated, ct);
            return Results.Ok(updated);
        })
        .WithName("UpdateInterview")
        .WithSummary("Update interview");

        app.MapDelete("/api/interviews/{id:guid}", async (
            Guid id,
            IInterviewRepository repo,
            CancellationToken ct) =>
        {
            await repo.DeleteAsync(id, ct);
            return Results.NoContent();
        })
        .WithName("DeleteInterview")
        .WithSummary("Delete interview");

        app.MapGet("/api/interviews/upcoming", async (
            IInterviewRepository repo,
            IApplicationRepository appRepo,
            CancellationToken ct) =>
        {
            var interviews = await repo.GetUpcomingAsync(10, ct);
            var appIds = interviews.Select(i => i.ApplicationId).Distinct();
            var apps = (await appRepo.GetByIdsAsync(appIds, ct)).ToDictionary(a => a.Id);

            var result = interviews.Select(i =>
            {
                apps.TryGetValue(i.ApplicationId, out var a);
                return new
                {
                    interview = i,
                    jobTitle = a?.JobTitle,
                    company = a?.Company
                };
            });

            return Results.Ok(result);
        })
        .WithName("GetUpcomingInterviews")
        .WithSummary("Get upcoming interviews");

        return app;
    }
}
