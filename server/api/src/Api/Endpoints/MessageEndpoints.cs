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

        // Plain read — powers the client's Messages tab.
        app.MapGet("/api/messages", async (
            ITrackedEmailRepository repo,
            CancellationToken ct) =>
        {
            var messages = await repo.GetAllAsync(ct);
            return Results.Ok(messages);
        })
        .WithName("GetMessages")
        .WithSummary("List mailbot-parsed emails, most recent first");

        return app;
    }
}
