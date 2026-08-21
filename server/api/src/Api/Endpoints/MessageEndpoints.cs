using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using Microsoft.AspNetCore.Mvc;

namespace ApplicationTracker.Api.Endpoints;

public static class MessageEndpoints
{
    public static WebApplication MapMessageEndpoints(this WebApplication app)
    {
        // Mailbot-only write — a real tracker mutation (like notes/interviews),
        // not non-persisting analysis, so it stays OUT of the demo allowlist.
        // The mailbot itself already refuses to run against a demo tracker
        // (see docs/demo-mode.md's mailbot guard), so this is defense in depth.
        app.MapPost("/api/messages", async (
            [FromBody] TrackedEmail email,
            ITrackedEmailRepository repo,
            CancellationToken ct) =>
        {
            var saved = await repo.UpsertAsync(email, ct);
            return Results.Ok(saved);
        })
        .WithName("UpsertMessage")
        .WithSummary("Persist a mailbot-parsed email (upserted by GmailMessageId)");

        // Plain read — powers the client's Messages tab. Enriches each message
        // with its linked application's company logo (TrackedEmail itself has
        // no logo field — it's mailbot's write model and shouldn't carry
        // display-only data) so the list can show a real logo instead of
        // always falling back to the initials avatar.
        app.MapGet("/api/messages", async (
            ITrackedEmailRepository repo,
            IApplicationRepository appRepo,
            CancellationToken ct) =>
        {
            var messages = await repo.GetAllAsync(ct);
            var apps = await appRepo.GetAllListItemsAsync(ct);
            var logoByAppId = apps
                .Where(a => !string.IsNullOrEmpty(a.CompanyLogo))
                .ToDictionary(a => a.Id, a => a.CompanyLogo);

            var result = messages.Select(m => new MessageListItem
            {
                Id = m.Id,
                ApplicationId = m.ApplicationId,
                Company = m.Company,
                JobTitle = m.JobTitle,
                Subject = m.Subject,
                From = m.From,
                UpdateType = m.UpdateType,
                Snippet = m.Snippet,
                ReceivedAt = m.ReceivedAt,
                CompanyLogo = m.ApplicationId.HasValue && logoByAppId.TryGetValue(m.ApplicationId.Value, out var logo)
                    ? logo
                    : null,
                IsRead = m.IsRead,
            });
            return Results.Ok(result);
        })
        .WithName("GetMessages")
        .WithSummary("List mailbot-parsed emails, most recent first");

        // Lets the mailbot skip already-processed mail before spending a Claude
        // call on it — a lightweight projection, not the full message list.
        app.MapGet("/api/messages/gmail-ids", async (
            ITrackedEmailRepository repo,
            CancellationToken ct) =>
        {
            var ids = await repo.GetGmailMessageIdsAsync(ct);
            return Results.Ok(ids);
        })
        .WithName("GetTrackedGmailMessageIds")
        .WithSummary("List GmailMessageIds already persisted (mailbot dedup check)");

        // Same demo-allowlist stance as the POST above — a real mutation, not
        // non-persisting analysis.
        app.MapDelete("/api/messages/{id:guid}", async (
            Guid id,
            ITrackedEmailRepository repo,
            CancellationToken ct) =>
        {
            await repo.DeleteAsync(id, ct);
            return Results.NoContent();
        })
        .WithName("DeleteMessage")
        .WithSummary("Delete a mailbot-parsed email");

        // Client-only UI state, not a tracker record change — stays OUT of the
        // demo allowlist anyway (same stance as delete above) since it still
        // persists to the seeded demo data.
        app.MapPatch("/api/messages/{id:guid}/read", async (
            Guid id,
            ITrackedEmailRepository repo,
            CancellationToken ct) =>
        {
            await repo.MarkReadAsync(id, ct);
            return Results.NoContent();
        })
        .WithName("MarkMessageRead")
        .WithSummary("Mark a message as read");

        return app;
    }
}
