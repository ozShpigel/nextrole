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

            if (string.IsNullOrWhiteSpace(request.Subject) && string.IsNullOrWhiteSpace(request.Body))
                return Results.BadRequest(new { error = "Subject or Body is required" });

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
