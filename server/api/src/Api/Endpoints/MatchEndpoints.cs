using ApplicationTracker.Api.DTOs;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using Microsoft.AspNetCore.Mvc;

namespace ApplicationTracker.Api.Endpoints;

public static class MatchEndpoints
{
    // Cap on the manual matching-signal lists (strengths / core values);
    // mirrored by the ChipInput max in the Settings UI.
    private const int MaxSignalItems = 3;

    // Cheap page count for the Resume tab's pager — no PDF library dependency
    // for what's a cosmetic count. Reads the raw object structure directly:
    // Latin1 is a byte-for-byte-safe decode for PDF syntax (ASCII operators
    // interleaved with binary streams), then look for the page-tree root's
    // /Count entry. Falls back to counting individual /Type /Page objects if
    // no /Pages node with a /Count is found. Null (never fails the upload) if
    // neither pattern matches.
    private static readonly System.Text.RegularExpressions.Regex PagesNodeRegex =
        new(@"/Type\s*/Pages\b", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex CountRegex =
        new(@"/Count\s+(\d+)", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex PageObjectRegex =
        new(@"/Type\s*/Page(?!s)\b", System.Text.RegularExpressions.RegexOptions.Compiled);

    private static int? CountPdfPages(byte[] bytes)
    {
        try
        {
            var text = System.Text.Encoding.Latin1.GetString(bytes);
            var max = 0;
            foreach (System.Text.RegularExpressions.Match node in PagesNodeRegex.Matches(text))
            {
                var start = Math.Max(0, node.Index - 300);
                var window = text.Substring(start, Math.Min(600, text.Length - start));
                var countMatch = CountRegex.Match(window);
                if (countMatch.Success && int.TryParse(countMatch.Groups[1].Value, out var n) && n > max)
                    max = n;
            }
            if (max > 0) return max;

            var pageCount = PageObjectRegex.Matches(text).Count;
            return pageCount > 0 ? pageCount : null;
        }
        catch
        {
            return null;
        }
    }

    public static WebApplication MapMatchEndpoints(this WebApplication app)
    {
        app.MapPost("/api/match", async (
            [FromBody] MatchRequest request,
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
                var response = await jobMatchService.AnalyzeMatchAsync(request, ct);
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
                var response = await jobMatchService.AnalyzeMatchBatchAsync(request, ct);
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
        // Scraper-internal — called once per run, so no
        // rate limiting. Flags clearly off-target titles (job-board padding);
        // the scraper fails open (keeps everything) when this call errors.
        app.MapPost("/api/match/title-triage", async (
            [FromBody] TitleTriageRequest request,
            ApplicationTracker.Core.AI.IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request?.SearchIntent))
                return Results.BadRequest(new { error = "SearchIntent is required" });
            if (request.Titles is null || request.Titles.Count == 0)
                return Results.BadRequest(new { error = "at least one title is required" });
            if (request.Titles.Count > 200)
                return Results.BadRequest(new { error = "too many titles (max 200)" });
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
        .WithName("TriageTitles")
        .WithSummary("Filter scraped job titles by search-intent relevance (one Haiku call per run)");

        // Seniority classification: one Haiku call per discovery run, batched
        // like title-triage above. Classifies each relevant scraped job's
        // ACTUAL seniority band from title+description — source-agnostic,
        // replacing reliance on jobspy's LinkedIn-only job_level tag as the
        // client-side filter. Scraper-internal — called once per run, no rate
        // limiting; fails open (every job gets actualSeniority=null, which
        // never excludes) when this call errors.
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
        .WithName("ClassifySeniority")
        .WithSummary("Classify scraped jobs' actual seniority band from title+description (one Haiku call per run)");

        static object ToProfileResponse(ProfileDocument doc) => new
        {
            content = doc.Content,
            structured = doc.Structured,
            updated_at = doc.UpdatedAt
        };

        app.MapGet("/api/match/profile", async (
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var doc = await provider.GetProfileDocumentAsync(ct);
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
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request is null)
                return Results.BadRequest(new { error = "a structured profile is required" });

            // Strengths/core values are the manual matching signal; capping them
            // keeps each one carrying real weight in the Evaluator's scoring
            // instead of diluting into a wish list.
            if (request.Strengths.Length > MaxSignalItems)
                return Results.BadRequest(new { error = $"at most {MaxSignalItems} strengths — keep the ones that should steer matching" });
            if (request.CoreValues.Length > MaxSignalItems)
                return Results.BadRequest(new { error = $"at most {MaxSignalItems} core values — keep the ones that should steer matching" });

            try
            {
                await provider.UpsertProfileAsync(request, ct);
                var updated = await provider.GetProfileDocumentAsync(ct);
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
            ApplicationTracker.Core.AI.IClaudeClient claude,
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
                    await resumeFileRepo.UpsertAsync(new ResumeFile
                    {
                        Bytes = bytes, FileName = name, ContentType = "application/pdf",
                        PageCount = CountPdfPages(bytes),
                    }, ct);

                    normalized = await claude.NormalizeProfileFromPdfAsync(bytes, ct);
                }
                else
                {
                    using var reader = new StreamReader(file.OpenReadStream());
                    var text = await reader.ReadToEndAsync(ct);
                    if (string.IsNullOrWhiteSpace(text))
                        return Results.BadRequest(new { error = "the file is empty" });
                    if (text.Length > 50_000)
                        text = text[..50_000];

                    await resumeFileRepo.UpsertAsync(new ResumeFile
                    {
                        Bytes = System.Text.Encoding.UTF8.GetBytes(text), FileName = name, ContentType = "text/plain",
                    }, ct);

                    normalized = await claude.NormalizeProfileAsync(text, ct);
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
            IResumeFileRepository resumeFileRepo,
            CancellationToken ct) =>
        {
            var file = await resumeFileRepo.GetAsync(ct);
            if (file is null) return Results.NotFound();

            return Results.Ok(new
            {
                fileName = file.FileName,
                contentType = file.ContentType,
                uploadedAt = file.UploadedAt,
                pageCount = file.PageCount,
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
            IResumeFileRepository resumeFileRepo,
            CancellationToken ct) =>
        {
            var file = await resumeFileRepo.GetAsync(ct);
            if (file is null) return Results.NotFound();
            return Results.File(file.Bytes, file.ContentType);
        })
        .WithName("DownloadResumeFile")
        .WithSummary("Stream the currently-stored résumé file for inline preview");

        app.MapGet("/api/match/profile/history/{field}", async (
            string field,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var entries = await provider.GetHistoryAsync(field, ct);
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

        app.MapPost("/api/match/profile/history/{field}/restore", async (
            string field,
            [FromBody] RestoreHistoryRequest request,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                await provider.RestoreHistoryAsync(field, request?.Index ?? -1, ct);
                var updated = await provider.GetProfileDocumentAsync(ct);
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
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var doc = await provider.GetInterviewPrepAsync(ct);
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
                await provider.UpsertInterviewPrepAsync(
                    request.SelfPresentationHr,
                    request.SelfPresentationTechnical,
                    request.PresentingWorkProject,
                    request.PresentingPersonalProject,
                    qa,
                    ct);
                var updated = await provider.GetInterviewPrepAsync(ct);
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

        app.MapGet("/api/match/interview-prep/history/{field}", async (
            string field,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                var entries = await provider.GetInterviewPrepHistoryAsync(field, ct);
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

        app.MapPost("/api/match/interview-prep/history/{field}/restore", async (
            string field,
            [FromBody] RestoreHistoryRequest request,
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            try
            {
                await provider.RestoreInterviewPrepHistoryAsync(field, request?.Index ?? -1, ct);
                var updated = await provider.GetInterviewPrepAsync(ct);
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
            IProfileProvider provider,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var field = request?.Field;
            if (field is not ("self_presentation_hr" or "self_presentation_technical"))
                return Results.BadRequest(new { error = "field must be 'self_presentation_hr' or 'self_presentation_technical'" });

            try
            {
                var prep = await provider.GetInterviewPrepAsync(ct);
                var text = field == "self_presentation_hr" ? prep.SelfPresentationHr : prep.SelfPresentationTechnical;
                var cached = field == "self_presentation_hr" ? prep.SelfPresentationHrCues : prep.SelfPresentationTechnicalCues;

                if (string.IsNullOrWhiteSpace(text))
                    return Results.BadRequest(new { error = "save some self-presentation text before generating cues" });

                if (!request!.Force && cached.Count > 0)
                    return Results.Ok(new { cues = cached, cached = true });

                var cues = await claude.GeneratePresentationCuesAsync(text, ct);
                await provider.SetPresentationCuesAsync(field, cues, ct);
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
}
