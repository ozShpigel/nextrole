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
                result.Success = false;
                return result;
            }

            if (!activeApps.Any())
            {
                _logger.LogInformation("No active applications to check");
                result.Success = true;
                return result;
            }

            var companies = activeApps.Select(a => a.Company).Distinct().ToList();
            _logger.LogInformation("Tracking {Count} companies: {Companies}",
                companies.Count, string.Join(", ", companies));

            // Step 2: Get emails from LAST 24 HOURS ONLY
            var emails = await _gmail.GetEmailsFromLast24HoursAsync(ct);
            result.EmailsChecked = emails.Count;

            if (!emails.Any())
            {
                _logger.LogInformation("No new emails in last 24 hours");
                result.Success = true;
                return result;
            }

            // Steps 3-5: parse, match, apply (shared with re-sync)
            var (parsed, updated) = await ProcessEmailsAsync(emails, companies, activeApps, result, ct);
            result.EmailsParsed = parsed;
            result.ApplicationsUpdated = updated;
            result.Success = true;

            _logger.LogInformation(
                "=== Sync Complete === Checked: {Checked}, Parsed: {Parsed}, Updated: {Updated}",
                result.EmailsChecked, result.EmailsParsed, result.ApplicationsUpdated);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Email sync failed");
            result.Errors.Add($"Sync failed: {ex.Message}");
            result.Success = false;
        }

        return result;
    }

    /// <summary>
    /// Re-sync a single application from its FULL email history (not just the last
    /// 24h), to recover from a missed/mis-parsed email. Reconcile-only: it fixes the
    /// current state (interview date, status) and writes only on actual change — it
    /// does not delete existing timeline rows.
    /// </summary>
    public async Task<SyncResult> RunResyncAsync(string company, string? title, CancellationToken ct = default)
    {
        _logger.LogInformation("=== Starting re-sync for company '{Company}'{Title} ===",
            company, string.IsNullOrWhiteSpace(title) ? "" : $", title '{title}'");

        var result = new SyncResult();
        try
        {
            // All applications (incl. terminal) so re-sync can target any app.
            var allApps = await _tracker.GetAllApplicationsAsync(ct);
            if (allApps is null)
            {
                const string msg = "Could not reach Application Tracker. Re-sync aborted.";
                _logger.LogError("{Message}", msg);
                result.Errors.Add(msg);
                result.Success = false;
                return result;
            }

            var candidates = allApps
                .Where(a => a.Company.Equals(company, StringComparison.OrdinalIgnoreCase))
                .Where(a => string.IsNullOrWhiteSpace(title)
                    || NormalizeTitle(a.JobTitle) == NormalizeTitle(title)
                    || NormalizeTitle(a.JobTitle).Contains(NormalizeTitle(title))
                    || NormalizeTitle(title).Contains(NormalizeTitle(a.JobTitle)))
                .ToList();

            if (candidates.Count == 0)
            {
                _logger.LogWarning("No application found for company '{Company}'{Title}", company,
                    string.IsNullOrWhiteSpace(title) ? "" : $" / title '{title}'");
                result.Success = true;
                return result;
            }

            // Full label history for this company (no 24h limit), oldest → newest
            // so later emails refine earlier ones.
            var query = $"label:JobApplications \"{company}\"";
            var emails = (await _gmail.GetEmailsByQueryAsync(query, ct))
                .OrderBy(e => e.ReceivedAt)
                .ToList();
            result.EmailsChecked = emails.Count;

            if (emails.Count == 0)
            {
                _logger.LogInformation("No emails found for company '{Company}'", company);
                result.Success = true;
                return result;
            }

            var (parsed, updated) = await ProcessEmailsAsync(emails, new List<string> { company }, candidates, result, ct);
            result.EmailsParsed = parsed;
            result.ApplicationsUpdated = updated;
            result.Success = true;

            _logger.LogInformation(
                "=== Re-sync complete === Company: {Company}, Emails: {Checked}, Parsed: {Parsed}, Updated: {Updated}",
                company, result.EmailsChecked, parsed, updated);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Re-sync failed for company '{Company}'", company);
            result.Errors.Add($"Re-sync failed: {ex.Message}");
            result.Success = false;
        }

        return result;
    }

    /// <summary>
    /// Parse each email, match it to one of the candidate applications, and apply
    /// the update. Shared by the daily sync and re-sync. `companies` is the filter
    /// list passed to the parser; `candidates` is the set the match is drawn from.
    /// </summary>
    private async Task<(int Parsed, int Updated)> ProcessEmailsAsync(
        List<EmailMessage> emails, List<string> companies, List<TrackerApplication> candidates,
        SyncResult result, CancellationToken ct)
    {
        var parsed = 0;
        var updated = 0;

        foreach (var email in emails)
        {
            try
            {
                var update = await _parser.ParseEmailAsync(email, companies, ct);
                if (update == null) continue;
                parsed++;

                var app = MatchApplication(candidates, update);
                if (app == null)
                {
                    _logger.LogWarning("Parsed email from {Company} but no matching app found", update.Company);
                    continue;
                }

                if (await ApplyUpdateAsync(app, update, ct))
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

        return (parsed, updated);
    }

    /// <summary>
    /// Picks the application an email update belongs to. Filters by company,
    /// then — when the user has several applications at the same company —
    /// disambiguates by job title (exact → substring → token overlap). Falls
    /// back to the first company match (with a warning) when the title can't
    /// disambiguate, rather than silently guessing.
    /// </summary>
    private TrackerApplication? MatchApplication(List<TrackerApplication> activeApps, EmailUpdate update)
    {
        var candidates = activeApps
            .Where(a => a.Company.Equals(update.Company, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (candidates.Count == 0) return null;
        if (candidates.Count == 1) return candidates[0];

        if (!string.IsNullOrWhiteSpace(update.JobTitle))
        {
            var emailTitle = NormalizeTitle(update.JobTitle);

            // 1) exact normalized title match
            var exact = candidates.FirstOrDefault(a => NormalizeTitle(a.JobTitle) == emailTitle);
            if (exact is not null) return exact;

            // 2) substring either direction (e.g. "devops engineer" within a longer title)
            var sub = candidates.FirstOrDefault(a =>
            {
                var t = NormalizeTitle(a.JobTitle);
                return t.Length > 0 && (t.Contains(emailTitle) || emailTitle.Contains(t));
            });
            if (sub is not null) return sub;

            // 3) best token overlap, if any
            var emailTokens = TitleTokens(emailTitle);
            var best = candidates
                .Select(a => (app: a, score: TitleTokens(NormalizeTitle(a.JobTitle)).Count(emailTokens.Contains)))
                .OrderByDescending(x => x.score)
                .First();
            if (best.score > 0)
            {
                _logger.LogInformation(
                    "Matched email ({Company}, title '{Title}') to '{AppTitle}' by token overlap",
                    update.Company, update.JobTitle, best.app.JobTitle);
                return best.app;
            }
        }

        _logger.LogWarning(
            "Ambiguous match: {Count} '{Company}' applications and email title '{Title}' didn't disambiguate. " +
            "Falling back to first ('{AppTitle}') — interview may attach to the wrong posting.",
            candidates.Count, update.Company, update.JobTitle ?? "(none)", candidates[0].JobTitle);
        return candidates[0];
    }

    private static string NormalizeTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return "";
        var chars = title.ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) || char.IsWhiteSpace(c) ? c : ' ');
        return string.Join(' ', new string(chars.ToArray())
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    private static HashSet<string> TitleTokens(string normalizedTitle) =>
        normalizedTitle.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();

    private async Task<bool> ApplyUpdateAsync(TrackerApplication app, EmailUpdate update, CancellationToken ct)
    {
        switch (update.UpdateType)
        {
            case "ApplicationReceived":
                return await SetStatusAsync(app, "Applied", "Email confirmation received", ct);

            case "InterviewScheduled":
                var interviewAdded = await _tracker.AddInterviewAsync(app.Id, new AddInterviewRequest
                {
                    ScheduledAt = CombineDateAndTime(update.InterviewDate, update.InterviewTime),
                    Type = update.InterviewType ?? "Unknown",
                    Interviewer = update.Interviewer,
                    Topics = update.Notes,
                    Notes = "Auto-detected from email"
                }, ct);

                var newStatus = update.InterviewType?.ToLower() switch
                {
                    "phone" or "hr" => "PhoneScreen",
                    "technical" => "TechnicalInterview",
                    "final" => "FinalRound",
                    _ => "PhoneScreen"
                };

                var statusUpdated = await SetStatusAsync(
                    app, newStatus, $"Interview scheduled: {update.InterviewType}", ct);
                if (!statusUpdated)
                    _logger.LogWarning("Interview added for {AppId} but status update to {Status} failed/skipped", app.Id, newStatus);

                return interviewAdded;

            case "Rejected":
                return await SetStatusAsync(app, "Rejected", "Rejection email received", ct);

            case "OfferReceived":
                return await SetStatusAsync(app, "OfferReceived", "Offer email received", ct);

            case "FollowUp":
                _logger.LogInformation("Follow-up email for {Company}: {Notes}", app.Company, update.Notes);
                return false;

            default:
                _logger.LogInformation("Update type {Type} not handled", update.UpdateType);
                return false;
        }
    }

    // Application status lifecycle order (mirrors the API's ApplicationStatus enum).
    // Used to prevent re-syncing an older email from rewinding status.
    private static readonly string[] StatusOrder =
    {
        "Analyzing", "DecidedToApply", "Applied", "PhoneScreen", "TechnicalInterview",
        "FinalRound", "OfferReceived", "Accepted", "Rejected", "Withdrawn"
    };

    private static int StatusRank(string? status) =>
        Array.FindIndex(StatusOrder, s => s.Equals(status, StringComparison.OrdinalIgnoreCase));

    // Apply a status change, but never move an application backwards (a late /
    // re-synced early-stage email must not rewind a more advanced status). Unknown
    // statuses (rank -1) are not blocked. The API itself no-ops same-status writes.
    private async Task<bool> SetStatusAsync(TrackerApplication app, string newStatus, string note, CancellationToken ct)
    {
        var current = StatusRank(app.Status);
        var next = StatusRank(newStatus);
        if (current >= 0 && next >= 0 && next < current)
        {
            _logger.LogInformation(
                "Skipping status change {From} -> {To} for {AppId} (would move backwards)",
                app.Status, newStatus, app.Id);
            return false;
        }
        return await _tracker.UpdateApplicationStatusAsync(app.Id, newStatus, note, ct);
    }

    private DateTime CombineDateAndTime(DateTime? date, string? time)
    {
        // Fallback is date-only (no time-of-day) so a missing date never gets
        // stamped with the mailbot's run clock — which would look like a real
        // scheduled time. Normally the parser supplies the date from the email.
        var baseDate = date ?? DateTime.UtcNow.Date.AddDays(3);
        if (date is null)
            _logger.LogWarning("No interview date provided, using fallback: {Date:yyyy-MM-dd}", baseDate);

        if (string.IsNullOrWhiteSpace(time) || !TimeSpan.TryParse(time, out var timeSpan))
            return baseDate;

        return baseDate.Date.Add(timeSpan);
    }
}
