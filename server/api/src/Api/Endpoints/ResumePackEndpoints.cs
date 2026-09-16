using ApplicationTracker.Api.DTOs;
using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using ApplicationTracker.Infrastructure.Pdf;
using Microsoft.AspNetCore.Mvc;

using ApplicationTracker.Core.Identity;

namespace ApplicationTracker.Api.Endpoints;

public static class ResumePackEndpoints
{
    // Per user, per UTC day. The pack is the priciest call in the product, so
    // this is a spend cap, not an abuse cap -- the "pack" rate-limit bucket
    // already handles bursts. Claimed atomically in UserQuotaRepository rather
    // than read-then-trusted.
    private const int PacksPerDay = 3;

    public static WebApplication MapResumePackEndpoints(this WebApplication app)
    {
        // Pure read — never demo-gated. Also renders the PDF once just to
        // count its pages (cheap, no AI call — same renderer the /pdf route
        // uses) so the preview's pager knows how many pages exist upfront,
        // without persisting a PageCount field that could drift from the
        // template if it ever changes independently of the pack content.
        app.MapGet("/api/applications/{id:guid}/pack", async (
            Guid id,
            IUserContext user,
            IResumePackRepository packRepo,
            IProfileProvider profileProvider,
            IResumePdfRenderer renderer,
            CancellationToken ct) =>
        {
            var pack = await packRepo.GetByApplicationIdAsync(user.UserId, id, ct);
            if (pack is null) return Results.NotFound();

            var profileDoc = await profileProvider.GetProfileDocumentAsync(user.UserId, ct);
            var pdfBytes = renderer.Render(pack, profileDoc.Structured);
            var pageCount = PdfPageCounter.CountPages(pdfBytes);
            // Real page size (not assumed A4/Letter) — lets the preview size its
            // container to the exact aspect ratio so a fit-to-width single page
            // exactly fills it, same fix as the Profile tab's résumé preview.
            var pageSize = PdfPageCounter.GetFirstPageSize(pdfBytes);

            return Results.Ok(new
            {
                pack.ApplicationId,
                pack.TailoredSummary,
                pack.Experience,
                pack.HighlightedSkills,
                pack.SideProjects,
                pack.GeneratedAt,
                pageCount,
                pageWidth = pageSize?.Width,
                pageHeight = pageSize?.Height,
            });
        })
        .WithName("GetResumePack")
        .WithSummary("Get the persisted résumé pack for an application, if generated");

        // Generates (or regenerates) the tailored résumé content and persists it.
        app.MapPost("/api/applications/{id:guid}/pack", async (
            Guid id,
            IUserContext user,
            IApplicationRepository appRepo,
            IResumePackRepository packRepo,
            IProfileProvider profileProvider,
            IUserQuotaRepository quotas,
            IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var application = await appRepo.GetByIdAsync(user.UserId, id, ct);
            if (application is null) return Results.NotFound();

            // Daily allowance, claimed BEFORE the Claude call: a pack is the
            // most expensive thing a user can trigger, and the rate limiter
            // caps bursts, not spend. Claimed rather than counted so two
            // concurrent clicks cannot both pass the same check.
            //
            // A generation that then fails (or is rejected by the validator)
            // still costs the allowance. That is deliberate: the call was made
            // and billed, so the cap has to count it. Refunding on failure
            // would make the cap a cap on successes, which is not what it is
            // protecting.
            if (!await quotas.TryConsumePackAsync(user.UserId, PacksPerDay, ct))
            {
                logger.LogInformation("Pack quota exhausted for {UserId}", user.UserId);
                return Results.Json(
                    new { error = $"Daily limit reached: {PacksPerDay} resume packs per day.", limit = PacksPerDay },
                    statusCode: StatusCodes.Status429TooManyRequests);
            }

            try
            {
                var profileDoc = await profileProvider.GetProfileDocumentAsync(user.UserId, ct);
                var synthesis = await claude.GenerateResumePackAsync(application, profileDoc.Content, profileDoc.Structured, ct);

                // Validate while the raw synthesis (Provenance included) is
                // still around — see ResumePackValidator. The result carries the
                // synthesis with repairs already applied (skill items with no
                // profile counterpart dropped), so persist THAT, not the raw one.
                var facts = ProfileFacts.From(profileDoc.Structured, DateOnly.FromDateTime(DateTime.UtcNow));
                var validation = ResumePackValidator.Validate(synthesis, profileDoc.Structured, profileDoc.Content, facts);
                foreach (var v in validation.Violations)
                    logger.LogWarning(
                        "Resume pack validation {Severity} for {Company} / {Title}: {Kind} — {Detail}",
                        v.Blocking ? "BLOCK" : "flag", application.Company, application.JobTitle, v.Kind, v.Detail);

                // A blocking violation is a fabricated fact no server-side edit can
                // repair (a figure the profile never stated). Refuse the pack rather
                // than persist it: shipping it flagged is how the earlier defects
                // reached a PDF. 422 carries the reasons back to the caller.
                if (validation.HasBlocking)
                {
                    var blocking = validation.Violations.Where(v => v.Blocking).ToList();
                    logger.LogError(
                        "Resume pack REFUSED for {Company} / {Title}: {Count} blocking violation(s)",
                        application.Company, application.JobTitle, blocking.Count);
                    return Results.Problem(
                        title: "Résumé pack rejected",
                        detail: "The generated pack contained "
                            + $"{blocking.Count} unverifiable figure(s) not present in your profile: "
                            + string.Join("; ", blocking.Select(v => v.Detail)),
                        statusCode: StatusCodes.Status422UnprocessableEntity);
                }

                var repaired = validation.Synthesis;
                var saved = await packRepo.UpsertAsync(user.UserId, new ResumePack
                {
                    ApplicationId = id,
                    RequirementCoverage = repaired.RequirementCoverage,
                    ConfirmationItems = repaired.ConfirmationItems,
                    TailoredSummary = repaired.TailoredSummary,
                    TargetTitle = repaired.TargetTitle,
                    Experience = repaired.Experience,
                    HighlightedSkills = repaired.HighlightedSkills,
                    SideProjects = repaired.SideProjects,
                    Violations = validation.Violations,
                    GeneratedAt = DateTime.UtcNow,
                }, ct);
                return Results.Ok(saved);
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
                logger.LogError(ex, "Error generating résumé pack for application {Id}", id);
                return Results.Problem("An error occurred while generating the résumé pack.", statusCode: 500);
            }
        })
        .RequireRateLimiting("pack")
        .WithName("GenerateResumePack")
        .WithSummary("Generate a tailored résumé pack for an application");

        // Manual edit of an already-generated pack — no AI call, so no rate
        // limit and nothing new to validate (Violations carries over from
        // whatever the last real generation flagged).
        app.MapPut("/api/applications/{id:guid}/pack", async (
            Guid id,
            [FromBody] ResumePackUpdateRequest request,
            IUserContext user,
            IResumePackRepository packRepo,
            CancellationToken ct) =>
        {
            var existing = await packRepo.GetByApplicationIdAsync(user.UserId, id, ct);
            if (existing is null) return Results.NotFound();

            var updated = existing with
            {
                TailoredSummary = request.TailoredSummary,
                Experience = request.Experience,
                HighlightedSkills = request.HighlightedSkills,
                SideProjects = request.SideProjects,
                GeneratedAt = DateTime.UtcNow,
            };
            var saved = await packRepo.UpsertAsync(user.UserId, updated, ct);
            return Results.Ok(saved);
        })
        .WithName("UpdateResumePack")
        .WithSummary("Manually edit the persisted résumé pack content (no AI call)");

        // Renders the PDF from the persisted pack — no AI call, so it's cheap
        // and can be requested freely (e.g. re-downloading). Pure read.
        //
        // `inline=true` is used by the <embed> preview (ResumePackModal) —
        // Results.File's fileDownloadName arg sets Content-Disposition:
        // attachment, which forces a save-file prompt even for an <embed>
        // src, so the preview path omits the filename entirely (no
        // Content-Disposition header at all, browser default is to render
        // application/pdf inline). The plain "Download PDF" link keeps the
        // named-attachment behavior so it still saves as FirstName_LastName_Role.pdf.
        app.MapGet("/api/applications/{id:guid}/pack/pdf", async (
            Guid id,
            bool? inline,
            IUserContext user,
            IApplicationRepository appRepo,
            IResumePackRepository packRepo,
            IProfileProvider profileProvider,
            IResumePdfRenderer renderer,
            CancellationToken ct) =>
        {
            var application = await appRepo.GetByIdAsync(user.UserId, id, ct);
            if (application is null) return Results.NotFound();

            var pack = await packRepo.GetByApplicationIdAsync(user.UserId, id, ct);
            if (pack is null) return Results.NotFound();

            var profileDoc = await profileProvider.GetProfileDocumentAsync(user.UserId, ct);
            var pdfBytes = renderer.Render(pack, profileDoc.Structured);

            if (inline == true) return Results.File(pdfBytes, "application/pdf");

            var fileName = BuildDownloadFileName(profileDoc.Structured.FullName, application.JobTitle);
            return Results.File(pdfBytes, "application/pdf", fileName);
        })
        .WithName("DownloadResumePackPdf")
        .WithSummary("Render and download the résumé pack as a PDF");

        return app;
    }

    // FirstName_LastName_Role.pdf — falls back to just whichever part is
    // present (or a bare "resume.pdf") when the profile has no name set yet.
    private static string BuildDownloadFileName(string? fullName, string jobTitle)
    {
        var namePart = SanitizeFileNamePart(fullName ?? "");
        var rolePart = SanitizeFileNamePart(jobTitle);
        var core = string.Join('_', new[] { namePart, rolePart }.Where(p => p.Length > 0));
        return (core.Length > 0 ? core : "resume") + ".pdf";
    }

    // Strips filesystem-invalid characters, then collapses whitespace runs
    // into single underscores — "Oz Shpigel" -> "Oz_Shpigel", "Backend
    // developer" -> "Backend_developer". Used for both the name and role.
    private static string SanitizeFileNamePart(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(value.Where(c => !invalid.Contains(c)).ToArray());
        return string.Join('_', cleaned.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }
}
