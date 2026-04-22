using Mailbot.Models;
using Microsoft.Extensions.Logging;

namespace Mailbot.Services;

/// <summary>
/// Orchestrates the full email sync flow:
/// 1. Get active applications from Tracker (company list)
/// 2. Fetch last 24h emails from Gmail
/// 3. Parse relevant emails with Claude
/// 4. Apply updates to Tracker
/// </summary>
public sealed class MailbotOrchestrator
{
    private readonly IGmailEmailService _gmail;
    private readonly IEmailParser _parser;
    private readonly ITrackerApiClient _tracker;
    private readonly ILogger<MailbotOrchestrator> _logger;

    public MailbotOrchestrator(
        IGmailEmailService gmail,
        IEmailParser parser,
        ITrackerApiClient tracker,
        ILogger<MailbotOrchestrator> logger)
    {
        _gmail = gmail;
        _parser = parser;
        _tracker = tracker;
        _logger = logger;
    }

    public async Task<SyncResult> RunSyncAsync(CancellationToken ct = default)
    {
        _logger.LogInformation("=== Starting Mailbot sync ===");

        var result = new SyncResult();

        try
        {
            // Step 1: Get active applications from Tracker (ONLY these companies!)
            var activeApps = await _tracker.GetActiveApplicationsAsync(ct);

            if (activeApps is null)
            {
                const string msg =
                    "Could not reach Application Tracker (timeout or error). Sync aborted — will not treat as empty.";
                _logger.LogError("{Message}", msg);
                result.Errors.Add(msg);
                return result with { Success = false };
            }

            if (!activeApps.Any())
            {
                _logger.LogInformation("No active applications to check");
                return result with { Success = true };
            }

            var companies = activeApps.Select(a => a.Company).Distinct().ToList();
            _logger.LogInformation("Tracking {Count} companies: {Companies}",
                companies.Count, string.Join(", ", companies));

            // Step 2: Get emails from LAST 24 HOURS ONLY
            var emails = await _gmail.GetEmailsFromLast24HoursAsync(ct);
            result = result with { EmailsChecked = emails.Count };

            if (!emails.Any())
            {
                _logger.LogInformation("No new emails in last 24 hours");
                return result with { Success = true };
            }

            // Step 3: Parse ONLY emails from tracked companies
            var parsed = 0;
            var updated = 0;

            foreach (var email in emails)
            {
                try
                {
                    // Parse with Claude (passes company list for filtering)
                    var update = await _parser.ParseEmailAsync(email, companies, ct);

                    if (update == null)
                        continue;

                    parsed++;

                    // Step 4: Find matching application
                    var app = activeApps.FirstOrDefault(a =>
                        a.Company.Equals(update.Company, StringComparison.OrdinalIgnoreCase));

                    if (app == null)
                    {
                        _logger.LogWarning("Parsed email from {Company} but no matching app found", update.Company);
                        continue;
                    }

                    // Step 5: Apply update
                    var wasUpdated = await ApplyUpdateAsync(app, update, ct);

                    if (wasUpdated)
                    {
                        updated++;
                        result.UpdatedApplications.Add($"{app.Company} - {update.UpdateType}");
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing email: {Subject}", email.Subject);
                    result.Errors.Add($"Email '{email.Subject}': {ex.Message}");
                }
            }

            result = result with
            {
                EmailsParsed = parsed,
                ApplicationsUpdated = updated,
                Success = true
            };

            _logger.LogInformation(
                "=== Sync Complete === Checked: {Checked}, Parsed: {Parsed}, Updated: {Updated}",
                result.EmailsChecked, result.EmailsParsed, result.ApplicationsUpdated);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Email sync failed");
            result.Errors.Add($"Sync failed: {ex.Message}");
            result = result with { Success = false };
        }

        return result;
    }

    private async Task<bool> ApplyUpdateAsync(TrackerApplication app, EmailUpdate update, CancellationToken ct)
    {
        switch (update.UpdateType)
        {
            case "ApplicationReceived":
                return await _tracker.UpdateApplicationStatusAsync(
                    app.Id, "Applied", "Email confirmation received", ct);

            case "InterviewScheduled":
                // Add interview to tracker
                var interviewAdded = await _tracker.AddInterviewAsync(app.Id, new AddInterviewRequest
                {
                    ScheduledAt = CombineDateAndTime(update.InterviewDate, update.InterviewTime),
                    Type = update.InterviewType ?? "Unknown",
                    Interviewer = update.Interviewer,
                    Topics = update.Notes,
                    Notes = "Auto-detected from email"
                }, ct);

                // Update application status based on interview type
                var newStatus = update.InterviewType?.ToLower() switch
                {
                    "phone" or "hr" => "PhoneScreen",
                    "technical" => "TechnicalInterview",
                    "final" => "FinalRound",
                    _ => "PhoneScreen"
                };

                await _tracker.UpdateApplicationStatusAsync(
                    app.Id, newStatus, $"Interview scheduled: {update.InterviewType}", ct);

                return interviewAdded;

            case "Rejected":
                return await _tracker.UpdateApplicationStatusAsync(
                    app.Id, "Rejected", "Rejection email received", ct);

            case "OfferReceived":
                return await _tracker.UpdateApplicationStatusAsync(
                    app.Id, "OfferReceived", "Offer email received", ct);

            case "FollowUp":
                _logger.LogInformation("Follow-up email for {Company}: {Notes}", app.Company, update.Notes);
                return false;

            default:
                _logger.LogInformation("Update type {Type} not handled", update.UpdateType);
                return false;
        }
    }

    private static DateTime CombineDateAndTime(DateTime? date, string? time)
    {
        var baseDate = date ?? DateTime.UtcNow.AddDays(3);

        if (string.IsNullOrWhiteSpace(time) || !TimeSpan.TryParse(time, out var timeSpan))
            return baseDate;

        return baseDate.Date.Add(timeSpan);
    }
}
