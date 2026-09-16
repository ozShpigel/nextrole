using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using Microsoft.AspNetCore.Mvc;

using ApplicationTracker.Core.Identity;

namespace ApplicationTracker.Api.Endpoints;

public static class MessageEndpoints
{
    public static WebApplication MapMessageEndpoints(this WebApplication app)
    {
        // Mailbot-only write — a real tracker mutation, like notes/interviews.
        app.MapPost("/api/messages", async (
            [FromBody] TrackedEmail email,
            IUserContext user,
            ITrackedEmailRepository repo,
            CancellationToken ct) =>
        {
            var saved = await repo.UpsertAsync(user.UserId, email, ct);
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
            IUserContext user,

            ITrackedEmailRepository repo,
            IApplicationRepository appRepo,
            CancellationToken ct) =>
        {
            var messages = await repo.GetAllAsync(user.UserId, ct);
            var apps = await appRepo.GetAllListItemsAsync(user.UserId, ct);
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
            IUserContext user,

            ITrackedEmailRepository repo,
            CancellationToken ct) =>
        {
            var ids = await repo.GetGmailMessageIdsAsync(user.UserId, ct);
            return Results.Ok(ids);
        })
        .WithName("GetTrackedGmailMessageIds")
        .WithSummary("List GmailMessageIds already persisted (mailbot dedup check)");

        // Same demo-allowlist stance as the POST above — a real mutation, not
        // non-persisting analysis.
        app.MapDelete("/api/messages/{id:guid}", async (
            Guid id,
            IUserContext user,
            ITrackedEmailRepository repo,
            CancellationToken ct) =>
        {
            await repo.DeleteAsync(user.UserId, id, ct);
            return Results.NoContent();
        })
        .WithName("DeleteMessage")
        .WithSummary("Delete a mailbot-parsed email");

        // Client-only UI state, not a tracker record change — unlike delete
        // above, this IS in the demo allowlist (Program.cs's messageReadPath):
        // blocking it made the client's optimistic isRead update 403, revert,
        // and re-fire in a loop that read as the Messages page flickering.
        app.MapPatch("/api/messages/{id:guid}/read", async (
            Guid id,
            IUserContext user,
            ITrackedEmailRepository repo,
            CancellationToken ct) =>
        {
            await repo.MarkReadAsync(user.UserId, id, ct);
            return Results.NoContent();
        })
        .WithName("MarkMessageRead")
        .WithSummary("Mark a message as read");

        return app;
    }
}
