using ApplicationTracker.Core.Identity;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using Microsoft.AspNetCore.Mvc;

namespace ApplicationTracker.Api.Endpoints;

/// <summary>
/// What one user does with a job from the shared pool: add it to their tracker,
/// dismiss it, mark it seen, or undo the add.
/// </summary>
/// <remarks>
/// These lived on the scraper until Phase 1 of `docs/scraper-slimming.md`. They
/// are user-scoped request/response endpoints — the same shape as applications
/// and messages — and they belong here for two reasons.
///
/// The first is structural. On the scraper, "filter by userId" was a convention
/// every query had to remember, and one already did not. Here every write goes
/// through <c>UserScopedCollection</c>, which has no overload that omits the
/// userId.
///
/// The second is that "Add to tracker" was a server-to-server POST back to this
/// very service, carrying the caller's session token so the API could resolve
/// the owner. That hop is what the identity-forwarding rule in `AGENTS.md`
/// exists to police, and it has failed twice. In-process there is no credential
/// to forward and nothing to get wrong.
///
/// Paths are <c>/api/pool/*</c>, not the scraper's old <c>/api/discovery/*</c>.
/// nginx routes <c>/api/discovery</c> to the scraper as one prefix block;
/// keeping the old paths would have meant splitting a single prefix across two
/// services by sub-path, which is the allowlist fragility that let
/// <c>/api/auth</c> ship unproxied.
/// </remarks>
public static class PoolEndpoints
{
    public sealed record UnsaveRequest(string JobUrl);

    public static void MapPoolEndpoints(this WebApplication app)
    {
        // ── Add to tracker ──────────────────────────────────────────────────
        app.MapPost("/api/pool/jobs/{jobId}/save", async (
            string jobId,
            IUserContext user,
            IPoolJobRepository pool,
            IPoolJobStateRepository state,
            IJobScoreRepository scores,
            IApplicationRepository apps,
            IMatchSnapshotRepository snapshots,
            IStatusUpdateRepository statusRepo,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var job = (await pool.GetByIdsAsync([jobId], ct)).FirstOrDefault();
            if (job is null) return Results.NotFound(new { error = "Job not found" });

            if (await state.IsSavedAsync(user.UserId, jobId, ct))
                return Results.Ok(new { status = "already_saved" });

            // The score is this user's and does not live on the pool document.
            // Ingest stopped scoring when the pool became shared, so
            // discovered_jobs.score/.verdict/.match_analysis are permanently
            // null on every job either ingest path writes. Reading them there
            // silently dropped the verdict the user was looking at when they
            // clicked Add, and the Active board promises that breakdown.
            //
            // A missing row means this job was never scored for this user. Add
            // is reachable only from a listing of scored jobs, so that is the
            // unusual path — save it unscored rather than refuse.
            var score = (await scores.GetByJobIdsAsync(user.UserId, [jobId], ct)).FirstOrDefault();

            // The mapping is a pure function so the join above can be pinned by
            // tests -- it has gone wrong once already. See PoolJobApplication.
            var application = PoolJobApplication.ToApplication(
                user.UserId, job, score,
                job.CompanyLogo is null ? await pool.FindCompanyLogoAsync(job.Company, ct) : null);

            var (created, _) = await ApplicationCreation.CreateAsync(
                user.UserId, application, apps, snapshots, statusRepo, logger, ct);

            // Only after the application exists. Marking first and failing the
            // create would hide the job from Matches with nothing in the
            // tracker to show for it.
            await state.MarkSavedAsync(user.UserId, jobId, ct);

            // Full-narrative enrichment deliberately does not fire here — the
            // API defers it until this application's status first crosses into
            // an interviewing stage, since most added jobs never reach one.
            return Results.Ok(new { status = "saved", id = created.Id });
        })
        .WithName("SavePoolJob")
        .WithSummary("Add a pool job to this user's tracker")
        .RequireRateLimiting("discovery");

        // ── Dismiss ─────────────────────────────────────────────────────────
        app.MapPost("/api/pool/jobs/{jobId}/dismiss", async (
            string jobId,
            IUserContext user,
            IPoolJobRepository pool,
            IPoolJobStateRepository state,
            CancellationToken ct) =>
        {
            // Hides the posting from THIS user's Matches. It stays in the
            // shared pool and stays visible to everyone else.
            if ((await pool.GetByIdsAsync([jobId], ct)).Count == 0)
                return Results.NotFound(new { error = "Job not found" });

            await state.MarkDismissedAsync(user.UserId, jobId, ct);
            return Results.Ok(new { status = "dismissed" });
        })
        .WithName("DismissPoolJob")
        .WithSummary("Hide a pool job from this user's Matches")
        .RequireRateLimiting("discovery");

        // ── Viewed ──────────────────────────────────────────────────────────
        app.MapPost("/api/pool/jobs/{jobId}/view", async (
            string jobId,
            IUserContext user,
            IPoolJobStateRepository state,
            CancellationToken ct) =>
        {
            // Answers a question nothing else can: of the jobs we pay to score,
            // how many does anyone actually open. Scored-versus-acted-on was the
            // only available proxy and it is a poor one.
            //
            // Deliberately cheap and deliberately dumb. No existence check: a
            // stale id from an open tab writes one orphan row rather than
            // costing a round trip on every selection, and an orphan row is
            // harmless — nothing joins outward from poolJobState. 204 because
            // the client has nothing to do with the answer.
            await state.MarkViewedAsync(user.UserId, jobId, ct);
            return Results.NoContent();
        })
        .WithName("MarkPoolJobViewed")
        .WithSummary("Record that this user opened a pool job")
        .RequireRateLimiting("discovery");

        // ── Undo an add ─────────────────────────────────────────────────────
        app.MapPost("/api/pool/jobs/unsave", async (
            [FromBody] UnsaveRequest request,
            IUserContext user,
            IPoolJobRepository pool,
            IPoolJobStateRepository state,
            CancellationToken ct) =>
        {
            // Reverse of save. A tracker Application holds no reference back to
            // the pool document — only the posting's URL — so when an
            // Application is deleted nothing can clear this flag from the
            // inside; the client calls this straight after the DELETE, or the
            // job stays permanently hidden from Matches and cannot be re-added.
            if (string.IsNullOrWhiteSpace(request.JobUrl))
                return Results.BadRequest(new { error = "jobUrl is required" });

            var jobIds = await pool.FindIdsByJobUrlAsync(request.JobUrl, ct);
            var modified = await state.ClearSavedAsync(user.UserId, jobIds, ct);

            return Results.Ok(new { status = "unsaved", modified });
        })
        .WithName("UnsavePoolJob")
        .WithSummary("Clear the saved flag for a posting this user removed from their tracker")
        .RequireRateLimiting("discovery");
    }
}
