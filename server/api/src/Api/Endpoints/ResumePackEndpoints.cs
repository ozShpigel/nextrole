using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using ApplicationTracker.Infrastructure.Pdf;

namespace ApplicationTracker.Api.Endpoints;

public static class ResumePackEndpoints
{
    public static WebApplication MapResumePackEndpoints(this WebApplication app)
    {
        // Pure read — never demo-gated. Also renders the PDF once just to
        // count its pages (cheap, no AI call — same renderer the /pdf route
        // uses) so the preview's pager knows how many pages exist upfront,
        // without persisting a PageCount field that could drift from the
        // template if it ever changes independently of the pack content.
        app.MapGet("/api/applications/{id:guid}/pack", async (
            Guid id,
            IResumePackRepository packRepo,
            IProfileProvider profileProvider,
            IResumePdfRenderer renderer,
            CancellationToken ct) =>
        {
            var pack = await packRepo.GetByApplicationIdAsync(id, ct);
            if (pack is null) return Results.NotFound();

            var profileDoc = await profileProvider.GetProfileDocumentAsync(ct);
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
        // This is a write — not in the demo analysisAllowlist, so it 403s under
        // DemoMode like every other mutation.
        app.MapPost("/api/applications/{id:guid}/pack", async (
            Guid id,
            IApplicationRepository appRepo,
            IResumePackRepository packRepo,
            IProfileProvider profileProvider,
            IClaudeClient claude,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var application = await appRepo.GetByIdAsync(id, ct);
            if (application is null) return Results.NotFound();

            try
            {
                var profileText = await profileProvider.GetProfileAsync(ct);
                var synthesis = await claude.GenerateResumePackAsync(application, profileText, ct);
                var saved = await packRepo.UpsertAsync(new ResumePack
                {
                    ApplicationId = id,
                    TailoredSummary = synthesis.TailoredSummary,
                    Experience = synthesis.Experience,
                    HighlightedSkills = synthesis.HighlightedSkills,
                    SideProjects = synthesis.SideProjects,
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
            IApplicationRepository appRepo,
            IResumePackRepository packRepo,
            IProfileProvider profileProvider,
            IResumePdfRenderer renderer,
            CancellationToken ct) =>
        {
            var application = await appRepo.GetByIdAsync(id, ct);
            if (application is null) return Results.NotFound();

            var pack = await packRepo.GetByApplicationIdAsync(id, ct);
            if (pack is null) return Results.NotFound();

            var profileDoc = await profileProvider.GetProfileDocumentAsync(ct);
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
