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
        // Pure read — never demo-gated.
        app.MapGet("/api/applications/{id:guid}/pack", async (
            Guid id,
            IResumePackRepository packRepo,
            CancellationToken ct) =>
        {
            var pack = await packRepo.GetByApplicationIdAsync(id, ct);
            return pack is null ? Results.NotFound() : Results.Ok(pack);
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
        app.MapGet("/api/applications/{id:guid}/pack/pdf", async (
            Guid id,
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

            var fileName = $"resume-{SanitizeFileName(application.Company)}.pdf";
            return Results.File(pdfBytes, "application/pdf", fileName);
        })
        .WithName("DownloadResumePackPdf")
        .WithSummary("Render and download the résumé pack as a PDF");

        return app;
    }

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(value.Where(c => !invalid.Contains(c)).ToArray()).Trim();
        return string.IsNullOrEmpty(cleaned) ? "role" : cleaned.Replace(' ', '-').ToLowerInvariant();
    }
}
