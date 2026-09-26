using ApplicationTracker.Api.DTOs;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using ApplicationTracker.Infrastructure.Pdf;
using Microsoft.AspNetCore.Mvc;

using ApplicationTracker.Core.Identity;

namespace ApplicationTracker.Api.Endpoints;

public static class MatchEndpoints
{
    // Cap on the manual matching-signal lists (strengths / core values);
    // mirrored by the ChipInput max in the Settings UI.

    // Resolves its own scope: the request that triggered this has already
    // returned, so anything scoped to it is disposed by the time this runs.
    private static async Task SyncPoolRoleAsync(
        Guid userId, StructuredProfile profile, IServiceScopeFactory scopeFactory)
    {
        using var scope = scopeFactory.CreateScope();
        var roles = scope.ServiceProvider.GetRequiredService<IPoolRoleService>();
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
        try
        {
            await roles.SyncForProfileAsync(userId, profile, CancellationToken.None);
        }
        catch (Exception ex)
        {
            // The role list is eventually-consistent with profiles by design:
            // the next save re-derives it from scratch, so a failure here costs
            // a delay, not correctness.
            logger.LogError(ex, "Pool role sync failed for {UserId}", userId);
        }

        // Separately, so a failed role classification (a Claude call) never
        // stops the functions from being recorded. No AI here: the functions
        // are already on the profile.
        try
        {
            var functions = scope.ServiceProvider.GetRequiredService<IPoolFunctionRepository>();
            await functions.SyncAsync(
                userId, JobFunctions.Normalize(profile.Functions, JobFunctions.MaxPerProfile), CancellationToken.None);
        }
        catch (Exception ex)
        {
            // Same eventual consistency as the roles. A missed sync can only
            // make the ingest skip postings for a function this user wants, and
            // only while the pre-read filter is on -- the next save repairs it.
            logger.LogError(ex, "Pool function sync failed for {UserId}", userId);
        }
    }

    public static WebApplication MapMatchEndpoints(this WebApplication app)
    {
        app.MapPost("/api/match", async (
            [FromBody] MatchRequest request,
            IUserContext user,
            IJobMatchService jobMatchService,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request?.JobDescription))
            {
                logger.LogWarning("Invalid match request: JobDescription is null or empty");
                return Results.BadRequest(new { error = "JobDescription is required" });
            }

            if (request.JobDescription.Length > 50_000)
            {
                return Results.BadRequest(new { error = "JobDescription exceeds maximum length of 50,000 characters" });
            }

            try
            {
                var response = await jobMatchService.AnalyzeMatchAsync(user.UserId, request, ct);
                return Results.Ok(response);
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("ApiKey"))
            {
                logger.LogError(ex, "Anthropic API key not configured");
                return Results.Problem(
                    detail: "Anthropic API key is not configured. Please set Anthropic:ApiKey in configuration.",
                    statusCode: 500);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error processing match request");
                return Results.Problem(detail: "An error occurred while processing the request", statusCode: 500);
            }
        })
        .RequireRateLimiting("match")
        .WithName("AnalyzeJobMatch")
        .WithSummary("Analyze job match");

        // Batched ingest-time scoring: the scraper's primary matching path
        // (replaces the retired RAG search). N jobs (cap 5) share ONE Evaluator
        // call — each still scored independently, never ranked against its
        // batch-mates (see PromptSeeds.Evaluator's batch-mode addendum). Own
        // rate-limit bucket ("discovery") so a big discovery run never starves
        // the interactive "match" bucket the manual Score-a-Job page uses.
        app.MapPost("/api/match/discovery-score-batch", async (
            [FromBody] MatchBatchRequest request,
            IUserContext user,
            IJobMatchService jobMatchService,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request?.Jobs is not { Count: > 0 })
                return Results.BadRequest(new { error = "at least one job is required" });
            if (request.Jobs.Count > 5)
                return Results.BadRequest(new { error = "too many jobs (max 5)" });
            if (request.Jobs.Any(j => string.IsNullOrWhiteSpace(j.Id)))
                return Results.BadRequest(new { error = "every job needs an id" });
            if (request.Jobs.Any(j => string.IsNullOrWhiteSpace(j.JobDescription)))
                return Results.BadRequest(new { error = "every job needs a jobDescription" });
            if (request.Jobs.Any(j => j.JobDescription.Length > 50_000))
                return Results.BadRequest(new { error = "a job description exceeds maximum length of 50,000 characters" });
            var duplicateIds = request.Jobs.GroupBy(j => j.Id).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
            if (duplicateIds.Count > 0)
                return Results.BadRequest(new { error = $"duplicate job id(s): {string.Join(", ", duplicateIds)}" });

            try
            {
                var response = await jobMatchService.AnalyzeMatchBatchAsync(user.UserId, request, ct);
                return Results.Ok(response);
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("ApiKey"))
            {
                logger.LogError(ex, "Anthropic API key not configured");
                return Results.Problem(
                    detail: "Anthropic API key is not configured. Please set Anthropic:ApiKey in configuration.",
                    statusCode: 500);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error processing batch match request");
                return Results.Problem(detail: "An error occurred while processing the batch request", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("AnalyzeJobMatchBatch")
        .WithSummary("Score a batch of jobs (up to 5) independently against the rubric in one Evaluator call");


        // Title triage: one Haiku call per discovery run, before any embedding.
        // Intended to be called once per run by the scraper, but it's reachable
        // (and allowlisted in demo) without auth, so it shares the "discovery"
        // rate-limit bucket like every other batched ingest-time AI call — a
        // real once-per-run call never gets close to that bucket's headroom.
        // Flags clearly off-target titles (job-board padding); the scraper
        // fails open (keeps everything) when this call errors.
        app.MapPost("/api/match/title-triage", async (
            [FromBody] TitleTriageRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request?.SearchIntent))
                return Results.BadRequest(new { error = "SearchIntent is required" });
            if (request.SearchIntent.Length > 500)
                return Results.BadRequest(new { error = "SearchIntent exceeds maximum length of 500 characters" });
            if (request.Titles is null || request.Titles.Count == 0)
                return Results.BadRequest(new { error = "at least one title is required" });
            if (request.Titles.Count > 200)
                return Results.BadRequest(new { error = "too many titles (max 200)" });
            if (request.Titles.Any(t => t.Title.Length > 500))
                return Results.BadRequest(new { error = "a title exceeds maximum length of 500 characters" });
            if (request.Titles.Any(t => string.IsNullOrWhiteSpace(t.JobId)))
                return Results.BadRequest(new { error = "jobId is required for every title (scraper/API version mismatch)" });
            try
            {
                var result = await claude.TriageTitlesAsync(request, ct);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error triaging titles");
                return Results.Problem(detail: "An error occurred while triaging titles", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("TriageTitles")
        .WithSummary("Filter scraped job titles by search-intent relevance (one Haiku call per run)");

        // Seniority classification: one Haiku call per discovery run, batched
        // like title-triage above. Classifies each relevant scraped job's
        // ACTUAL seniority band from title+description — source-agnostic,
        // replacing reliance on jobspy's LinkedIn-only job_level tag as the
        // client-side filter. Same reachability caveat as title-triage above —
        // shares the "discovery" bucket and caps per-description length so an
        // unauthenticated caller can't drive unbounded Anthropic spend; fails
        // open (every job gets actualSeniority=null, which never excludes)
        // when this call errors.
        app.MapPost("/api/match/seniority-classify", async (
            [FromBody] SeniorityClassifyRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request?.Jobs is not { Count: > 0 })
                return Results.BadRequest(new { error = "at least one job is required" });
            if (request.Jobs.Count > 200)
                return Results.BadRequest(new { error = "too many jobs (max 200)" });
            if (request.Jobs.Any(j => (j.Description?.Length ?? 0) > 50_000))
                return Results.BadRequest(new { error = "a job description exceeds maximum length of 50,000 characters" });
            if (request.Jobs.Any(j => string.IsNullOrWhiteSpace(j.JobId)))
                return Results.BadRequest(new { error = "jobId is required for every job (scraper/API version mismatch)" });
            try
            {
                var result = await claude.ClassifySeniorityAsync(request, ct);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error classifying job seniority");
                return Results.Problem(detail: "An error occurred while classifying job seniority", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("ClassifySeniority")
        .WithSummary("Classify scraped jobs' actual seniority band from title+description (one Haiku call per run)");

        // Match tab open: narrow the shared pool with the cheap filter, score
        // only what this user has never had scored, keep the results. This is
        // the ONLY thing that spends an Evaluator call on a pool job — ingest
        // does not score (docs/job-pool.md, docs/scoring-and-search.md).
        // Shares the "discovery" bucket: a scan is a burst of batch calls, not
        // an interactive one, so it must not starve the manual Score-a-Job page.
        app.MapPost("/api/match/pool-scan", async (
            IUserContext user,
            IPoolScanService scan,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var result = await scan.ScanAsync(user.UserId, ct);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Pool scan failed");
                return Results.Problem("An error occurred while scanning the job pool.", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("PoolScan")
        .WithSummary("Score the shared pool's new candidates against this user's profile");

        // The cheap half of matching, and the first thing the board asks for.
        // One profile embedding plus a vector search -- no Claude call -- so
        // the reader sees the real set of relevant postings in ~95ms instead of
        // waiting on a scan, and scoring fills in behind it.
        //
        // In the "match" bucket, not "discovery": this is interactive, it is
        // the page's first paint, and it must not queue behind a scan's burst.
        app.MapGet("/api/match/pool-band", async (
            IUserContext user,
            IPoolBrowseService browse,
            ILogger<Program> logger,
            int? limit,
            CancellationToken ct) =>
        {
            try
            {
                var result = await browse.BandAsync(user.UserId, limit ?? 40, ct);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Pool band retrieval failed");
                return Results.Problem("An error occurred while retrieving matching jobs.", statusCode: 500);
            }
        })
        .RequireRateLimiting("match")
        .WithName("PoolBand")
        .WithSummary("The retrieved band for this user -- relevant postings, scored or not, no Claude call");

        // Score specific postings, which is what the board asks for as the
        // reader scrolls into unscored cards. The ids come from the client and
        // are treated as untrusted: capped per request, looked up in the pool,
        // deduped against what is already scored and what is in flight, and
        // charged against today's budget before any Claude call.
        //
        // "discovery" bucket, like the scan: it is a burst of batch calls.
        app.MapPost("/api/match/score-jobs", async (
            [FromBody] ScoreJobsRequest request,
            IUserContext user,
            IPoolScanService scan,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request?.JobIds is null || request.JobIds.Count == 0)
                return Results.BadRequest(new { error = "jobIds is required" });

            try
            {
                var result = await scan.ScoreByIdsAsync(user.UserId, request.JobIds, ct);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Scoring requested jobs failed");
                return Results.Problem("An error occurred while scoring these jobs.", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("ScoreJobs")
        .WithSummary("Score these specific pool postings for this user");

        // What the match tab renders: this user's scores for the pool jobs it
        // is about to show. Scores are per user and live in jobScores, never on
        // the shared pool document.
        app.MapPost("/api/match/pool-scores", async (
            [FromBody] PoolScoresRequest request,
            IUserContext user,
            IJobScoreRepository scores,
            CancellationToken ct) =>
        {
            if (request?.JobIds is null || request.JobIds.Count == 0)
                return Results.Ok(new { scores = Array.Empty<object>() });
            if (request.JobIds.Count > 500)
                return Results.BadRequest(new { error = "too many job ids (max 500)" });

            var rows = await scores.GetByJobIdsAsync(user.UserId, request.JobIds, ct);
            return Results.Ok(new
            {
                scores = rows.Select(r => new
                {
                    jobId = r.JobId,
                    score = r.Score,
                    verdict = r.Verdict,
                    shouldApply = r.ShouldApply,
                    matchAnalysis = r.MatchAnalysis,
                    error = r.Error,
                    scoredAt = r.ScoredAt,
                }),
            });
        })
        .WithName("PoolScores")
        .WithSummary("This user's stored scores for a set of pool jobs");

        // Per-job extraction for the shared job pool — one batched Haiku call
        // per ingest run, same shape and "discovery" bucket as title-triage and
        // seniority-classify above. Deliberately takes no user identity: it
        // reads no profile and scores nothing, so one stored result is valid
        // for every user and is never recomputed per user (docs/job-pool.md).
        app.MapPost("/api/match/job-facts", async (
            [FromBody] JobFactsRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request?.Jobs is null || request.Jobs.Count == 0)
                return Results.BadRequest(new { error = "at least one job is required" });
            if (request.Jobs.Count > 200)
                return Results.BadRequest(new { error = "too many jobs (max 200)" });
            if (request.Jobs.Any(j => string.IsNullOrWhiteSpace(j.JobId)))
                return Results.BadRequest(new { error = "jobId is required for every job (scraper/API version mismatch)" });
            if (request.Jobs.Any(j => j.Title.Length > 500))
                return Results.BadRequest(new { error = "a title exceeds maximum length of 500 characters" });
            // Same 50K cap every other description-carrying endpoint uses, so an
            // unauthenticated caller cannot drive unbounded Anthropic spend.
            if (request.Jobs.Any(j => (j.Description?.Length ?? 0) > 50_000))
                return Results.BadRequest(new { error = "a description exceeds maximum length of 50,000 characters" });

            try
            {
                var result = await claude.ExtractJobFactsAsync(request, ct);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error extracting job facts");
                return Results.Problem(detail: "An error occurred while extracting job facts", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("ExtractJobFacts")
        .WithSummary("Extract stated requirements from scraped postings (user-independent, once per job)");

        // Ingest-time Analyst pass for the shared pool — sibling of job-facts
        // above, and deliberately the same shape: no user identity, "discovery"
        // bucket, batched, and the result is stored on the pool document by the
        // scraper rather than per user.
        //
        // This is the whole point of the move. The Analyst reads only the
        // posting (BuildAnalysisBatchPrompt takes no profile), so parsing it
        // per user meant paying 2.1x the entire global ingest pipeline to
        // recompute, for each user, something that cannot differ between them.
        app.MapPost("/api/match/job-parse", async (
            [FromBody] JobParseRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request?.Jobs is null || request.Jobs.Count == 0)
                return Results.BadRequest(new { error = "at least one job is required" });
            // Lower than job-facts' 200: a parse emits a full ParsedJob per job
            // (~712 output tokens measured), so the response, not the request,
            // is what bounds a batch here.
            if (request.Jobs.Count > 25)
                return Results.BadRequest(new { error = "too many jobs (max 25)" });
            if (request.Jobs.Any(j => string.IsNullOrWhiteSpace(j.JobId)))
                return Results.BadRequest(new { error = "jobId is required for every job (scraper/API version mismatch)" });
            if (request.Jobs.Any(j => (j.Description?.Length ?? 0) > 50_000))
                return Results.BadRequest(new { error = "a description exceeds maximum length of 50,000 characters" });

            try
            {
                return Results.Ok(await claude.ParseJobsForPoolAsync(request, ct));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error parsing pool jobs");
                return Results.Problem(detail: "An error occurred while parsing jobs", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("ParsePoolJobs")
        .WithSummary("Parse postings for the shared pool (user-independent, once per job)");

        // The same two reads through the Message Batches API, at half the
        // price, for a caller that is not waiting: the Greenhouse ingest
        // submits, records the id, and collects on a later poll
        // (Core/Matching/IngestBatch.cs). Same limits as the live endpoints, so
        // the batch path cannot drive more spend than they can; 200 postings
        // per submission for both, since a batch answer is not bounded by one
        // response the way a live parse is.
        app.MapPost("/api/match/job-facts/batches", async (
            [FromBody] JobFactsRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (IngestBatchInvalid(request?.Jobs?.Select(j => (j.JobId, j.Title, j.Description)).ToList()) is { } invalid)
                return invalid;
            try
            {
                return Results.Ok(await claude.SubmitJobFactsBatchAsync(request!, ct));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error submitting a job-facts batch");
                return Results.Problem(detail: "An error occurred while submitting the batch", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("SubmitJobFactsBatch")
        .WithSummary("Submit job-facts reads as a Message Batch (half price, collected later)");

        app.MapGet("/api/match/job-facts/batches/{batchId}", async (
            string batchId,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (!IsBatchId(batchId)) return Results.BadRequest(new { error = "not a batch id" });
            try
            {
                return Results.Ok(await claude.CollectJobFactsBatchAsync(batchId, ct));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error collecting job-facts batch {BatchId}", batchId);
                return Results.Problem(detail: "An error occurred while collecting the batch", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("CollectJobFactsBatch")
        .WithSummary("Collect a job-facts batch: in_progress, or the facts");

        app.MapPost("/api/match/job-parse/batches", async (
            [FromBody] JobParseRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (IngestBatchInvalid(request?.Jobs?.Select(j => (j.JobId, j.Title ?? "", j.Description)).ToList()) is { } invalid)
                return invalid;
            try
            {
                return Results.Ok(await claude.SubmitJobParseBatchAsync(request!, ct));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error submitting a job-parse batch");
                return Results.Problem(detail: "An error occurred while submitting the batch", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("SubmitJobParseBatch")
        .WithSummary("Submit ingest-time Analyst parses as a Message Batch (half price, collected later)");

        // POST, not GET: collecting a parse needs the postings it was made
        // from. The fabricated-cultural-signal check and the title/company
        // overrides run against them before anything is returned for storage --
        // the same guards the live endpoint applies.
        app.MapPost("/api/match/job-parse/batches/{batchId}/collect", async (
            string batchId,
            [FromBody] JobParseRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (!IsBatchId(batchId)) return Results.BadRequest(new { error = "not a batch id" });
            if (IngestBatchInvalid(request?.Jobs?.Select(j => (j.JobId, j.Title ?? "", j.Description)).ToList()) is { } invalid)
                return invalid;
            try
            {
                return Results.Ok(await claude.CollectJobParseBatchAsync(batchId, request!, ct));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error collecting job-parse batch {BatchId}", batchId);
                return Results.Problem(detail: "An error occurred while collecting the batch", statusCode: 500);
            }
        })
        .RequireRateLimiting("discovery")
        .WithName("CollectJobParseBatch")
        .WithSummary("Collect a job-parse batch: in_progress, or the verified parses");

        // Narrative enrichment: on-demand upgrade of a scored job's narrative
        // fields (honestAssessment/recommendation/companyNewsAnalysis/
        // employeeReviewsAnalysis) from ingest-time terse to full detail —
        // called once by the scraper's /save handler when the user clicks
        // Add. Same "match" bucket as the single-job scoring endpoint: this
        // fires interactively, per user click, not per bulk-ingest batch.
        app.MapPost("/api/match/enrich-narrative", async (
            [FromBody] NarrativeEnrichRequest request,
            IUserContext user,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null || string.IsNullOrWhiteSpace(request.JobDescription))
                return Results.BadRequest(new { error = "jobDescription is required" });
            if (request.JobDescription.Length > 50_000)
                return Results.BadRequest(new { error = "jobDescription exceeds maximum length of 50,000 characters" });

            try
            {
                var result = await claude.EnrichNarrativeAsync(user.UserId, request, ct);
                return Results.Ok(result);
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("ApiKey"))
            {
                logger.LogError(ex, "Anthropic API key not configured");
                return Results.Problem(
                    detail: "Anthropic API key is not configured. Please set Anthropic:ApiKey in configuration.",
                    statusCode: 500);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error enriching narrative");
                return Results.Problem(detail: "An error occurred while enriching the narrative", statusCode: 500);
            }
        })
        .RequireRateLimiting("match")
        .WithName("EnrichNarrative")
        .WithSummary("Upgrade a scored job's narrative fields from ingest-time terse to full detail, on Add");

        static object ToProfileResponse(ProfileDocument doc) => new
        {
            content = doc.Content,
            structured = doc.Structured,
            updated_at = doc.UpdatedAt
        };

        app.MapGet("/api/match/profile", async (
            IUserContext user,

            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var doc = await provider.GetProfileDocumentAsync(user.UserId, ct);
                return Results.Ok(ToProfileResponse(doc));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load profile");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("GetProfile")
        .WithSummary("Get the stored professional profile (rendered content + structured fields)");

        app.MapPut("/api/match/profile", async (
            [FromBody] StructuredProfile request,
            IUserContext user,
            IProfileProvider provider,
            IServiceScopeFactory scopeFactory,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null)
                return Results.BadRequest(new { error = "a structured profile is required" });

            try
            {
                await provider.UpsertProfileAsync(user.UserId, request, ct);
                var updated = await provider.GetProfileDocumentAsync(user.UserId, ct);

                // The shared pool searches the roles its users are actually
                // under, so a saved profile can add one (or release the last
                // claim on another). Fire-and-forget: it costs a Haiku call,
                // and a role list that lags a save by a second is a far better
                // outcome than a save that fails because of one.
                _ = SyncPoolRoleAsync(user.UserId, request, scopeFactory);

                return Results.Ok(ToProfileResponse(updated));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to update profile");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("UpdateProfile")
        .WithSummary("Update the professional profile (structured); content is re-rendered server-side");

        // Normalization layer: pasted free-text experience/skills → structured
        // profile fields, for the user to review/edit before saving. Not persisted.
        app.MapPost("/api/match/profile/normalize", async (
            [FromBody] NormalizeProfileRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null || string.IsNullOrWhiteSpace(request.Text))
                return Results.BadRequest(new { error = "text is required" });
            if (request.Text.Length > 50_000)
                return Results.BadRequest(new { error = "text exceeds maximum length of 50,000 characters" });

            try
            {
                var normalized = await claude.NormalizeProfileAsync(request.Text, ct);
                return Results.Ok(normalized);
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("ApiKey"))
            {
                logger.LogError(ex, "Anthropic API key not configured");
                return Results.Problem(
                    detail: "Anthropic API key is not configured. Please set Anthropic:ApiKey in configuration.",
                    statusCode: 500);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to normalize profile text");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .RequireRateLimiting("match")
        .WithName("NormalizeProfile")
        .WithSummary("Normalize pasted free-text experience/skills into structured profile fields");

        // Same normalization, but from an uploaded résumé file. PDF is handed to
        // Claude as a native document block; TXT reuses the free-text path. The
        // raw file is also persisted (ResumeFile) so the Profile page can show
        // what was actually uploaded — this is why this endpoint is a write and
        // no longer belongs in the demo analysisAllowlist (see Program.cs).
        app.MapPost("/api/match/profile/normalize-file", async (
            IFormFile file,
            [FromQuery] string? scope,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            IUserContext user,
            IResumeFileRepository resumeFileRepo,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (file is null || file.Length == 0)
                return Results.BadRequest(new { error = "a résumé file is required" });
            if (file.Length > 10 * 1024 * 1024)
                return Results.BadRequest(new { error = "file exceeds maximum size of 10 MB" });

            var name = file.FileName ?? "";
            var isPdf = file.ContentType == "application/pdf" || name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);
            var isTxt = file.ContentType == "text/plain" || name.EndsWith(".txt", StringComparison.OrdinalIgnoreCase);
            if (!isPdf && !isTxt)
                return Results.BadRequest(new { error = "unsupported file type (PDF or TXT only)" });

            // scope=essentials: the short first read an upload runs alongside
            // the full one (NormalizedProfileEssentials). It persists nothing:
            // the full read, running in parallel, stores the file -- two
            // concurrent upserts of the same bytes would only race each other.
            var essentialsOnly = string.Equals(scope, "essentials", StringComparison.OrdinalIgnoreCase);

            try
            {
                ApplicationTracker.Core.Profile.NormalizedProfile normalized;
                if (isPdf)
                {
                    using var ms = new MemoryStream();
                    await file.CopyToAsync(ms, ct);
                    var bytes = ms.ToArray();

                    // Persist before parsing — the upload survives even if Claude
                    // parsing fails, so the user can retry without re-uploading.
                    if (!essentialsOnly)
                        await resumeFileRepo.UpsertAsync(user.UserId, new ResumeFile
                        {
                            Bytes = bytes, FileName = name, ContentType = "application/pdf",
                            PageCount = PdfPageCounter.CountPages(bytes),
                        }, ct);

                    normalized = await claude.NormalizeProfileFromPdfAsync(bytes, ct, essentialsOnly);
                }
                else
                {
                    using var reader = new StreamReader(file.OpenReadStream());
                    var text = await reader.ReadToEndAsync(ct);
                    if (string.IsNullOrWhiteSpace(text))
                        return Results.BadRequest(new { error = "the file is empty" });
                    if (text.Length > 50_000)
                        text = text[..50_000];

                    if (!essentialsOnly)
                        await resumeFileRepo.UpsertAsync(user.UserId, new ResumeFile
                        {
                            Bytes = System.Text.Encoding.UTF8.GetBytes(text), FileName = name, ContentType = "text/plain",
                        }, ct);

                    normalized = await claude.NormalizeProfileAsync(text, ct, essentialsOnly);
                }
                return Results.Ok(normalized);
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("ApiKey"))
            {
                logger.LogError(ex, "Anthropic API key not configured");
                return Results.Problem(
                    detail: "Anthropic API key is not configured. Please set Anthropic:ApiKey in configuration.",
                    statusCode: 500);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to normalize profile from uploaded file");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .DisableAntiforgery()
        .RequireRateLimiting("match")
        .WithName("NormalizeProfileFile")
        .WithSummary("Normalize an uploaded résumé (PDF or TXT) into structured profile fields");

        // Metadata for the currently-stored résumé file — plain read, never demo-gated.
        app.MapGet("/api/match/profile/resume-file", async (
            HttpContext http,
            IUserContext user,
            IResumeFileRepository resumeFileRepo,
            CancellationToken ct) =>
        {
            // Neither this nor /download below set an explicit cache policy
            // otherwise, so a plain GET is eligible for the browser's own
            // heuristic caching — a replaced résumé can then keep showing
            // the old file/pageCount until a full reload, since an SPA's own
            // fetch() calls aren't covered by a hard-refresh's cache bypass
            // (that only applies to the navigation's own document/scripts).
            http.Response.Headers.CacheControl = "no-store";

            var file = await resumeFileRepo.GetAsync(user.UserId, ct);
            if (file is null) return Results.NotFound();

            // Computed on the fly rather than persisted — the preview needs
            // the real page aspect ratio so its container's height exactly
            // matches a fit-to-width single page, or Chrome's native PDF
            // viewer bleeds the top of the next page into the leftover
            // vertical space underneath.
            var pageSize = file.ContentType == "application/pdf" ? PdfPageCounter.GetFirstPageSize(file.Bytes) : null;

            return Results.Ok(new
            {
                fileName = file.FileName,
                contentType = file.ContentType,
                uploadedAt = file.UploadedAt,
                pageCount = file.PageCount,
                pageWidth = pageSize?.Width,
                pageHeight = pageSize?.Height,
                // Small enough to inline for TXT; PDF is fetched separately via
                // /resume-file/download and rendered inline in an <embed>.
                textContent = file.ContentType == "text/plain"
                    ? System.Text.Encoding.UTF8.GetString(file.Bytes)
                    : null,
            });
        })
        .WithName("GetResumeFileMeta")
        .WithSummary("Get metadata (and text content, if a .txt) for the currently-stored résumé file");

        // Raw bytes — no Content-Disposition filename, so browsers render PDFs
        // inline (via <embed>) instead of forcing a download. Plain read.
        app.MapGet("/api/match/profile/resume-file/download", async (
            HttpContext http,
            IUserContext user,
            IResumeFileRepository resumeFileRepo,
            CancellationToken ct) =>
        {
            // See the no-store comment on the metadata endpoint above — same
            // reasoning, and this is the one the client also cache-busts with
            // a query param, belt-and-suspenders since the client can't
            // control what an <embed>'s underlying PDF plugin caches either.
            http.Response.Headers.CacheControl = "no-store";

            var file = await resumeFileRepo.GetAsync(user.UserId, ct);
            if (file is null) return Results.NotFound();
            return Results.File(file.Bytes, file.ContentType);
        })
        .WithName("DownloadResumeFile")
        .WithSummary("Stream the currently-stored résumé file for inline preview");

        // Unused: the Settings History UI was deliberately removed
        // (SettingsPage.test.tsx asserts no "History" button renders) but this
        // pair and MongoProfileProvider's underlying write path were left in
        // place — no client caller as of 2026-08-23.
        app.MapGet("/api/match/profile/history/{field}", async (
            string field,
            IUserContext user,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var entries = await provider.GetHistoryAsync(user.UserId, field, ct);
                return Results.Ok(new { entries });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load profile history for {Field}", field);
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("GetProfileHistory")
        .WithSummary("List prior versions of the profile content");

        // Unused, same as the GET above.
        app.MapPost("/api/match/profile/history/{field}/restore", async (
            string field,
            [FromBody] RestoreHistoryRequest request,
            IUserContext user,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                await provider.RestoreHistoryAsync(user.UserId, field, request?.Index ?? -1, ct);
                var updated = await provider.GetProfileDocumentAsync(user.UserId, ct);
                return Results.Ok(ToProfileResponse(updated));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to restore profile history for {Field}", field);
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("RestoreProfileHistory")
        .WithSummary("Restore a profile field to a prior version (current value is snapshotted, so restore is undoable)");

        // ── Interview prep ───────────────────────────────────────────────────
        static object ToInterviewPrepResponse(InterviewPrepDocument doc) => new
        {
            self_presentation_hr = doc.SelfPresentationHr,
            self_presentation_technical = doc.SelfPresentationTechnical,
            presenting_work_project = doc.PresentingWorkProject,
            presenting_personal_project = doc.PresentingPersonalProject,
            qa_rubric = doc.QaRubric.Select(e => new { question = e.Question, answer = e.Answer, categories = e.Categories, topic = e.Topic }),
            self_presentation_hr_cues = doc.SelfPresentationHrCues,
            self_presentation_technical_cues = doc.SelfPresentationTechnicalCues,
            updated_at = doc.UpdatedAt
        };

        app.MapGet("/api/match/interview-prep", async (
            IUserContext user,

            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var doc = await provider.GetInterviewPrepAsync(user.UserId, ct);
                return Results.Ok(ToInterviewPrepResponse(doc));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load interview prep");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("GetInterviewPrep")
        .WithSummary("Get stored interview prep content (self-presentation, Q&A rubric, project pitches)");

        app.MapPut("/api/match/interview-prep", async (
            [FromBody] InterviewPrepRequest request,
            IUserContext user,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null)
                return Results.BadRequest(new { error = "request body is required" });

            if (request.SelfPresentationHr is null
                && request.SelfPresentationTechnical is null
                && request.PresentingWorkProject is null
                && request.PresentingPersonalProject is null
                && request.QaRubric is null)
            {
                return Results.BadRequest(new { error = "at least one field must be provided" });
            }

            try
            {
                var qa = request.QaRubric?
                    .Select(e => new QaEntry
                    {
                        Question = e.Question,
                        Answer = e.Answer,
                        Categories = e.Categories ?? new List<string>(),
                        Topic = e.Topic ?? "",
                    })
                    .ToList();
                await provider.UpsertInterviewPrepAsync(user.UserId, 
                    request.SelfPresentationHr,
                    request.SelfPresentationTechnical,
                    request.PresentingWorkProject,
                    request.PresentingPersonalProject,
                    qa,
                    ct);
                var updated = await provider.GetInterviewPrepAsync(user.UserId, ct);
                return Results.Ok(ToInterviewPrepResponse(updated));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to update interview prep");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("UpdateInterviewPrep")
        .WithSummary("Update interview prep content (all fields optional, carry-forward semantics)");

        // Unused: same dead History UI as /api/match/profile/history above.
        app.MapGet("/api/match/interview-prep/history/{field}", async (
            string field,
            IUserContext user,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var entries = await provider.GetInterviewPrepHistoryAsync(user.UserId, field, ct);
                return Results.Ok(new { entries });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load interview prep history for {Field}", field);
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("GetInterviewPrepHistory")
        .WithSummary("List prior versions of an interview prep field");

        // Unused, same as the GET above.
        app.MapPost("/api/match/interview-prep/history/{field}/restore", async (
            string field,
            [FromBody] RestoreHistoryRequest request,
            IUserContext user,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                await provider.RestoreInterviewPrepHistoryAsync(user.UserId, field, request?.Index ?? -1, ct);
                var updated = await provider.GetInterviewPrepAsync(user.UserId, ct);
                return Results.Ok(ToInterviewPrepResponse(updated));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to restore interview prep history for {Field}", field);
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .WithName("RestoreInterviewPrepHistory")
        .WithSummary("Restore an interview prep field to a prior version (current value is snapshotted, so restore is undoable)");

        // Turn a self-presentation into short keyword cues (rehearsal aid). Cues
        // are cached per saved version: the text is read from the stored doc, and
        // a cached set is returned without a Claude call unless `force` is set.
        app.MapPost("/api/match/interview-prep/cues", async (
            [FromBody] PresentationCuesRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            IUserContext user,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var field = request?.Field;
            if (field is not ("self_presentation_hr" or "self_presentation_technical"))
                return Results.BadRequest(new { error = "field must be 'self_presentation_hr' or 'self_presentation_technical'" });

            try
            {
                var prep = await provider.GetInterviewPrepAsync(user.UserId, ct);
                var text = field == "self_presentation_hr" ? prep.SelfPresentationHr : prep.SelfPresentationTechnical;
                var cached = field == "self_presentation_hr" ? prep.SelfPresentationHrCues : prep.SelfPresentationTechnicalCues;

                if (string.IsNullOrWhiteSpace(text))
                    return Results.BadRequest(new { error = "save some self-presentation text before generating cues" });

                if (!request!.Force && cached.Count > 0)
                    return Results.Ok(new { cues = cached, cached = true });

                var cues = await claude.GeneratePresentationCuesAsync(text, ct);
                await provider.SetPresentationCuesAsync(user.UserId, field, cues, ct);
                return Results.Ok(new { cues, cached = false });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("ApiKey"))
            {
                logger.LogError(ex, "Anthropic API key not configured");
                return Results.Problem(
                    detail: "Anthropic API key is not configured. Please set Anthropic:ApiKey in configuration.",
                    statusCode: 500);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to generate presentation cues");
                return Results.Problem("An internal error occurred.", statusCode: 500);
            }
        })
        .RequireRateLimiting("match")
        .WithName("GeneratePresentationCues")
        .WithSummary("Turn a self-presentation into short keyword cues, cached per saved version (rehearsal reminders)");

        return app;
    }

    /// <summary>Max postings per batch submission, for both reads.</summary>
    public const int MaxIngestBatchJobs = 200;

    private static IResult? IngestBatchInvalid(List<(string JobId, string Title, string? Description)>? jobs)
    {
        if (jobs is null || jobs.Count == 0)
            return Results.BadRequest(new { error = "at least one job is required" });
        if (jobs.Count > MaxIngestBatchJobs)
            return Results.BadRequest(new { error = $"too many jobs (max {MaxIngestBatchJobs})" });
        if (jobs.Any(j => string.IsNullOrWhiteSpace(j.JobId)))
            return Results.BadRequest(new { error = "jobId is required for every job" });
        if (jobs.Any(j => j.Title.Length > 500))
            return Results.BadRequest(new { error = "a title exceeds maximum length of 500 characters" });
        if (jobs.Any(j => (j.Description?.Length ?? 0) > 50_000))
            return Results.BadRequest(new { error = "a description exceeds maximum length of 50,000 characters" });
        return null;
    }

    // Goes into the SDK's request path, so it is checked, not trusted.
    private static bool IsBatchId(string id) =>
        System.Text.RegularExpressions.Regex.IsMatch(id, "^msgbatch_[A-Za-z0-9]{1,100}$");
}

/// <summary>Body of POST /api/match/score-jobs.</summary>
/// <remarks>
/// Ids only. The server decides what they mean -- which are real postings,
/// which are already scored, and how many of them today's budget allows -- so
/// a client cannot widen the work by sending more of them.
/// </remarks>
public sealed record ScoreJobsRequest
{
    public List<string> JobIds { get; init; } = [];
}
