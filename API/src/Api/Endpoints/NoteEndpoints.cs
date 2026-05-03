using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using Microsoft.AspNetCore.Mvc;

namespace ApplicationTracker.Api.Endpoints;

public static class NoteEndpoints
{
    public static WebApplication MapNoteEndpoints(this WebApplication app)
    {
        app.MapPost("/api/applications/{id:guid}/notes", async (
            Guid id,
            [FromBody] Note note,
            IApplicationRepository appRepo,
            INoteRepository repo,
            CancellationToken ct) =>
        {
            var existing = await appRepo.GetByIdAsync(id, ct);
            if (existing is null) return Results.NotFound();

            var created = note with { ApplicationId = id };
            await repo.CreateAsync(created, ct);
            return Results.Created($"/api/notes/{created.Id}", created);
        })
        .WithName("CreateNote")
        .WithSummary("Add note to application");

        app.MapPut("/api/notes/{id:guid}", async (
            Guid id,
            [FromBody] Note note,
            INoteRepository repo,
            CancellationToken ct) =>
        {
            var existing = await repo.GetByIdAsync(id, ct);
            if (existing is null) return Results.NotFound();

            var updated = note with { Id = id, ApplicationId = existing.ApplicationId };
            await repo.UpdateAsync(updated, ct);
            return Results.Ok(updated);
        })
        .WithName("UpdateNote")
        .WithSummary("Update note");

        app.MapDelete("/api/notes/{id:guid}", async (
            Guid id,
            INoteRepository repo,
            CancellationToken ct) =>
        {
            await repo.DeleteAsync(id, ct);
            return Results.NoContent();
        })
        .WithName("DeleteNote")
        .WithSummary("Delete note");

        return app;
    }
}
