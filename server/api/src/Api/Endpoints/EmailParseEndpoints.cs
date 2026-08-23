using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Email;
using Microsoft.AspNetCore.Mvc;

namespace ApplicationTracker.Api.Endpoints;

public static class EmailParseEndpoints
{
    public static WebApplication MapEmailParseEndpoints(this WebApplication app)
    {
        app.MapPost("/api/emails/parse", async (
            [FromBody] EmailParseRequest request,
            IClaudeClient claudeClient,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            if (request.KnownCompanies is null || request.KnownCompanies.Count == 0)
                return Results.BadRequest(new { error = "KnownCompanies is required" });
            if (request.KnownCompanies.Count > 1000)
                return Results.BadRequest(new { error = "too many known companies (max 1000)" });

            if (string.IsNullOrWhiteSpace(request.Subject) && string.IsNullOrWhiteSpace(request.Body))
                return Results.BadRequest(new { error = "Subject or Body is required" });
            if ((request.Subject?.Length ?? 0) > 500)
                return Results.BadRequest(new { error = "Subject exceeds maximum length of 500 characters" });
            if ((request.Body?.Length ?? 0) > 50_000)
                return Results.BadRequest(new { error = "Body exceeds maximum length of 50,000 characters" });

            try
            {
                var result = await claudeClient.ParseEmailAsync(
                    request.Subject ?? "",
                    request.From ?? "",
                    request.Body ?? "",
                    request.KnownCompanies,
                    request.ReceivedAt,
                    ct);

                if (result is null)
                    return Results.NoContent();

                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error parsing email: {Subject}", request.Subject);
                return Results.Problem("An error occurred while parsing the email", statusCode: 500);
            }
        })
        // Mailbot-triggered, batch-style (one call per synced email, not
        // interactive) — shares the "discovery" bucket like the scraper's
        // other batched AI calls. Also reachable/allowlisted in demo, so this
        // isn't optional the way an internal-only call would be.
        .RequireRateLimiting("discovery")
        .WithName("ParseEmail")
        .WithSummary("Parse a job-related email using AI");

        return app;
    }
}

public sealed record EmailParseRequest
{
    public string? Subject { get; init; }
    public string? From { get; init; }
    public string? Body { get; init; }
    public required List<string> KnownCompanies { get; init; }
    // When the email was received; used as the reference date for resolving
    // day-first / year-less / relative interview dates. Falls back to "now".
    public DateTime? ReceivedAt { get; init; }
}
