using ApplicationTracker.Core.Identity;
using ApplicationTracker.Core.Repositories;

namespace ApplicationTracker.Api.Endpoints;

/// <summary>
/// Things that happened to the user's account while they were not looking.
/// </summary>
/// <remarks>
/// Read on every page load by the client's app chrome, not by one page. The
/// only notice today is raised during a sign-in redirect, so there is no page
/// alive to receive a toast — and the point of it is that someone who does not
/// know to look still finds out.
/// </remarks>
public static class NoticeEndpoints
{
    public static void MapNoticeEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/notices");

        group.MapGet("/", async (IUserContext user, IUserNoticeRepository notices, CancellationToken ct) =>
            Results.Ok(await notices.ListAsync(user.UserId, ct)));

        // Dismissal is per user and persistent: a notice the user has read
        // should not come back on their next device, which rules out
        // localStorage.
        group.MapDelete("/{noticeId}", async (
            string noticeId, IUserContext user, IUserNoticeRepository notices, CancellationToken ct) =>
        {
            await notices.DismissAsync(user.UserId, noticeId, ct);
            return Results.NoContent();
        });
    }
}
