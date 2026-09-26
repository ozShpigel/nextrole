using System.Text.Json;
using System.Text.Json.Serialization;
using ApplicationTracker.Core.Identity;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using ApplicationTracker.Infrastructure.Listings;
using MongoDB.Bson;
using MongoDB.Driver;
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

    public sealed record ImportRequest(List<string>? Urls);

    /// <summary>Per-URL outcome. snake_case: the client has always read these.</summary>
    public sealed record ImportResult(
        [property: JsonPropertyName("url")] string Url,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("title")] string? Title,
        [property: JsonPropertyName("company")] string? Company,
        [property: JsonPropertyName("score")] int? Score,
        [property: JsonPropertyName("verdict")] string? Verdict,
        [property: JsonPropertyName("error")] string? Error);

    // Matches the Evaluator batch cap -- a batch is one call, and five is what
    // the output budget was measured against.
    private const int MaxImportUrls = 5;

    // Relaxed, so dates serialise as ISO strings rather than {$date: ...}.
    // The run document is written by PoolIngest as raw BSON and read by a
    // human, so its own field names are the contract -- no DTO in between.
    private static readonly MongoDB.Bson.IO.JsonWriterSettings RelaxedJson =
        new() { OutputMode = MongoDB.Bson.IO.JsonOutputMode.RelaxedExtendedJson };

    private static readonly JsonSerializerOptions CamelCase =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    /// <summary>Comma-separated query parameter to a trimmed, non-empty list.</summary>
    private static IReadOnlyList<string> Csv(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    public static void MapPoolEndpoints(this WebApplication app)
    {
        // ── The Matches list ────────────────────────────────────────────────
        app.MapGet("/api/pool/jobs", async (
            IUserContext user,
            IPoolBrowseService browse,
            int? min_score,
            string? verdict,
            int? days_back,
            string? location,
            string? q,
            bool? is_remote,
            string? actual_job_level,
            bool? include_dismissed,
            bool? include_saved,
            int? limit,
            int? offset,
            CancellationToken ct) =>
        {
            // Query-string names are snake_case because the client has always
            // sent them that way -- see PoolJobListItem on why this move keeps
            // the wire contract byte-identical.
            var query = new PoolBrowseQuery
            {
                MinScore = min_score,
                Verdicts = Csv(verdict),
                DaysBack = days_back ?? PoolBrowseQuery.DefaultDaysBack,
                Location = location,
                Text = q,
                IsRemote = is_remote,
                Levels = Csv(actual_job_level),
                IncludeDismissed = include_dismissed ?? false,
                IncludeSaved = include_saved ?? true,
                Limit = limit ?? 50,
                Offset = offset ?? 0,
            };

            return Results.Ok(await browse.BrowseAsync(user.UserId, query, ct));
        })
        .WithName("BrowsePoolJobs")
        .WithSummary("This user's scored pool jobs, filtered and ranked")
        .RequireRateLimiting("discovery");

        // ── Run history ─────────────────────────────────────────────────────
        //
        // Read-only, not user-scoped, and nothing in the client fetches it: a
        // pool run is shared, and this is for looking at last night's by hand.
        // Moved from the scraper in Phase 3d of docs/scraper-slimming.md,
        // because that service no longer has a database connection.
        app.MapGet("/api/pool/runs", async (
            IMongoCollection<BsonDocument> jobs, int? limit, CancellationToken ct) =>
        {
            var runs = jobs.Database.GetCollection<BsonDocument>("discovery_runs");
            var docs = await runs
                .Find(Builders<BsonDocument>.Filter.Empty)
                .Sort(Builders<BsonDocument>.Sort.Descending("started_at"))
                .Limit(Math.Clamp(limit ?? 20, 1, 100))
                .ToListAsync(ct);

            return Results.Text(
                docs.Select(d => { d.Remove("_id"); return d; }).ToJson(RelaxedJson),
                "application/json");
        })
        .WithName("ListPoolRuns")
        .WithSummary("Recent ingest runs, newest first");

        app.MapGet("/api/pool/runs/{runId}", async (
            string runId, IMongoCollection<BsonDocument> jobs, CancellationToken ct) =>
        {
            var runs = jobs.Database.GetCollection<BsonDocument>("discovery_runs");
            var doc = await runs.Find(Builders<BsonDocument>.Filter.Eq("id", runId)).FirstOrDefaultAsync(ct);
            if (doc is null) return Results.NotFound(new { error = "Run not found" });

            doc.Remove("_id");
            return Results.Text(doc.ToJson(RelaxedJson), "application/json");
        })
        .WithName("GetPoolRun")
        .WithSummary("One ingest run");

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
            IPoolScanService scan,
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
            // A missing row means this job was never scored for this user --
            // the ordinary case now that unscored cards carry the same Add
            // button. Score it first (ScoreBeforeSave explains why, and the
            // in-flight wait); with no score to be had, save it unscored rather
            // than refuse.
            var score = (await scores.GetByJobIdsAsync(user.UserId, [jobId], ct)).FirstOrDefault();
            if (score is null)
            {
                try
                {
                    score = await ScoreBeforeSave.EnsureAsync(
                        c => scan.ScoreByIdsAsync(user.UserId, [jobId], c),
                        async c => (await scores.GetByJobIdsAsync(user.UserId, [jobId], c)).FirstOrDefault(),
                        Task.Delay,
                        ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex, "Scoring {JobId} before saving it failed; saving it unscored", jobId);
                }
            }

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

        // ── Import by URL ───────────────────────────────────────────────────
        app.MapPost("/api/pool/jobs/import", async (
            [FromBody] ImportRequest request,
            IUserContext user,
            IListingsClient listings,
            IJobMatchService matcher,
            IPoolJobRepository pool,
            IApplicationRepository apps,
            IMatchSnapshotRepository snapshots,
            IStatusUpdateRepository statusRepo,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            // The "Import Job" button: one or more LinkedIn URLs found outside
            // discovery. Fetched directly (no search), scored in one batch, and
            // saved at DecidedToApply so they land in the Added column.
            var urls = (request.Urls ?? [])
                .Where(u => !string.IsNullOrWhiteSpace(u))
                .Select(u => u.Trim())
                .ToList();

            if (urls.Count == 0)
                return Results.BadRequest(new { error = "At least one URL is required" });
            if (urls.Count > MaxImportUrls)
                return Results.BadRequest(new { error = $"At most {MaxImportUrls} URLs per import" });

            var results = new List<ImportResult>();
            var fetched = new List<(string Url, FetchedListing Job)>();

            foreach (var url in urls)
            {
                var job = await listings.FetchByUrlAsync(url, ct);
                if (job is null)
                    results.Add(new ImportResult(url, "failed", null, null, null, null,
                        "Couldn't fetch this job — check the link, or paste the description instead."));
                else
                    fetched.Add((url, job));
            }

            if (fetched.Count > 0)
            {
                // Never raises on a per-job failure — a bad link in a batch of
                // five must not lose the other four. Same fail-open philosophy
                // the ingest uses.
                MatchBatchResponse? scored = null;
                try
                {
                    scored = await matcher.AnalyzeMatchBatchAsync(user.UserId, new MatchBatchRequest
                    {
                        Jobs = [.. fetched.Select((f, i) => new MatchBatchItem
                        {
                            Id = i.ToString(),
                            JobDescription = f.Job.Description ?? "",
                            Title = f.Job.Title,
                            Company = f.Job.Company,
                            Location = f.Job.Location,
                            CompanyProfile = PoolEnrichment.CompanyProfileFrom(f.Job.CompanyProfile),
                        })],
                    }, ct);
                }
                catch (Exception e)
                {
                    logger.LogError(e, "Import scoring failed for {Count} job(s); saving them unscored", fetched.Count);
                }

                var byId = scored?.Results?.ToDictionary(r => r.Id) ?? [];

                for (var i = 0; i < fetched.Count; i++)
                {
                    var (url, job) = fetched[i];
                    byId.TryGetValue(i.ToString(), out var match);

                    var application = new Application
                    {
                        UserId = user.UserId,
                        JobTitle = job.Title,
                        Company = job.Company,
                        Status = ApplicationStatus.DecidedToApply,
                        JobDescription = job.Description ?? "",
                        JobUrl = job.JobUrl,
                        MatchScore = match?.Response.OverallScore,
                        MatchVerdict = match?.Response.Verdict,
                        // The snapshots are [BsonIgnore] on Application and
                        // content-addressed separately, so they must not also be
                        // embedded in the stored analysis JSON.
                        MatchAnalysis = match is null
                            ? null
                            : JsonSerializer.Serialize(match.Response with
                              {
                                  AnalystSnapshotInput = null,
                                  AnalystSnapshotOutput = null,
                                  EvaluatorSnapshotInput = null,
                                  EvaluatorSnapshotOutput = null,
                              }, CamelCase),
                        // Unlike the pool save, these snapshots are real: this
                        // request scored the job inline, so the raw Claude text
                        // exists and ApplicationCreation content-addresses it.
                        AnalystSnapshotInput = match?.Response.AnalystSnapshotInput,
                        AnalystSnapshotOutput = match?.Response.AnalystSnapshotOutput,
                        EvaluatorSnapshotInput = match?.Response.EvaluatorSnapshotInput,
                        EvaluatorSnapshotOutput = match?.Response.EvaluatorSnapshotOutput,
                        CompanyLogo = job.CompanyLogo ?? await pool.FindCompanyLogoAsync(job.Company, ct),
                    };

                    try
                    {
                        await ApplicationCreation.CreateAsync(
                            user.UserId, application, apps, snapshots, statusRepo, logger, ct);

                        results.Add(new ImportResult(url, "saved", job.Title, job.Company,
                            application.MatchScore, application.MatchVerdict, null));
                    }
                    catch (Exception e)
                    {
                        logger.LogError(e, "Import could not save {Title} at {Company}", job.Title, job.Company);
                        results.Add(new ImportResult(url, "failed", job.Title, job.Company,
                            application.MatchScore, application.MatchVerdict,
                            "Scored, but couldn't save it to the tracker."));
                    }
                }
            }

            return Results.Ok(new { results });
        })
        .WithName("ImportJobsByUrl")
        .WithSummary("Fetch one or more postings by URL, score them, and add them to the tracker")
        .RequireRateLimiting("match");

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
