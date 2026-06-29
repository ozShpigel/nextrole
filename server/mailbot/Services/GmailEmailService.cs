using Mailbot.Models;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Flows;
using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Gmail.v1;
using Google.Apis.Gmail.v1.Data;
using Google.Apis.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System.Text.Json;

namespace Mailbot.Services;

/// <summary>
/// Fetches emails from Gmail API. Uses OAuth2 for authentication.
/// Named GmailEmailService to avoid conflict with Google.Apis.Gmail.v1.GmailService.
/// </summary>
public sealed class GmailEmailService : IGmailEmailService
{
    private readonly GmailService _gmail;
    private readonly ILogger<GmailEmailService> _logger;
    private readonly string? _query;
    private readonly string _labelName;

    // Read mail + manage filters. Reading messages needs GmailReadonly; creating/deleting
    // filters needs GmailSettingsBasic. Adding settings.basic is a scope change — the cached
    // OAuth token must be re-consented to both, else filter calls 403.
    private static readonly string[] Scopes =
        { GmailService.Scope.GmailReadonly, GmailService.Scope.GmailSettingsBasic };

    // Resolve the Gmail credentials path in order of preference:
    // 1. Explicit Gmail:CredentialsPath config (absolute or relative to content root)
    // 2. Render secret file at /etc/secrets/credentials.json
    // 3. Local credentials.json next to the executable (content root)
    // Returns true (with the resolved existing path) only if a file is present, so
    // the host can choose to skip Gmail entirely instead of crashing.
    public static bool TryResolveCredentialsPath(IConfiguration config, string contentRoot, out string path)
    {
        var configuredPath = config["Gmail:CredentialsPath"];
        if (!string.IsNullOrWhiteSpace(configuredPath))
        {
            path = Path.IsPathRooted(configuredPath)
                ? configuredPath
                : Path.Combine(contentRoot, configuredPath);
        }
        else if (File.Exists("/etc/secrets/credentials.json"))
        {
            path = "/etc/secrets/credentials.json";
        }
        else
        {
            path = Path.Combine(contentRoot, "credentials.json");
        }
        return File.Exists(path);
    }

    public GmailEmailService(IConfiguration config, IHostEnvironment env, ILogger<GmailEmailService> logger)
    {
        _logger = logger;

        if (!TryResolveCredentialsPath(config, env.ContentRootPath, out var credentialPath))
        {
            throw new FileNotFoundException($"Gmail credentials file not found at '{credentialPath}'. " +
                                            "Ensure credentials.json is mounted as a secret or provide Gmail:CredentialsPath.");
        }
        _logger.LogInformation("Using Gmail credentials path: {Path}", credentialPath);

        var tokenSecretPath = "/etc/secrets/gmail-token.json";
        UserCredential credential;

        using (var stream = new FileStream(credentialPath, FileMode.Open, FileAccess.Read))
        {
            var clientSecrets = GoogleClientSecrets.FromStream(stream);

            if (File.Exists(tokenSecretPath))
            {
                _logger.LogInformation("Using Gmail token from secret path: {Path}", tokenSecretPath);

                var tokenJson = File.ReadAllText(tokenSecretPath);

                // System.Text.Json PropertyNameCaseInsensitive does NOT handle snake_case → PascalCase mapping.
                // TokenResponse JSON uses snake_case keys (refresh_token, access_token) so we read them manually.
                var doc = JsonDocument.Parse(tokenJson);
                var root = doc.RootElement;

                var token = new TokenResponse
                {
                    AccessToken = root.TryGetProperty("access_token", out var at) ? at.GetString() : null,
                    RefreshToken = root.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : null,
                    TokenType = root.TryGetProperty("token_type", out var tt) ? tt.GetString() : null,
                    ExpiresInSeconds = root.TryGetProperty("expires_in", out var ei) ? ei.GetInt64() : null,
                    Scope = root.TryGetProperty("scope", out var sc) ? sc.GetString() : null,
                    IssuedUtc = DateTime.UtcNow.AddDays(-1)
                };

                if (string.IsNullOrWhiteSpace(token.RefreshToken))
                    throw new InvalidOperationException($"Gmail token at '{tokenSecretPath}' has no refresh_token. Re-run the OAuth flow locally and update the secret.");

                _logger.LogInformation("Loaded Gmail token. RefreshToken present: {Present}", !string.IsNullOrEmpty(token.RefreshToken));

                var flow = new GoogleAuthorizationCodeFlow(new GoogleAuthorizationCodeFlow.Initializer
                {
                    ClientSecrets = clientSecrets.Secrets,
                    Scopes = Scopes
                });

                credential = new UserCredential(flow, "user", token);
            }
            else
            {
                _logger.LogInformation("Gmail token secret not found, falling back to interactive authorization.");

                credential = GoogleWebAuthorizationBroker.AuthorizeAsync(
                    clientSecrets.Secrets,
                    Scopes,
                    "user",
                    CancellationToken.None).Result;
            }
        }

        _gmail = new GmailService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "Mailbot"
        });

        _query = config["Gmail:Query"];
        _labelName = string.IsNullOrWhiteSpace(config["Gmail:Label"]) ? "JobApplications" : config["Gmail:Label"]!;

        _logger.LogInformation("Gmail service initialized");
    }

    public async Task<List<EmailMessage>> GetEmailsFromLast24HoursAsync(CancellationToken ct = default)
    {
        var yesterday = DateTime.UtcNow.AddHours(-24);
        var effectiveQuery = string.IsNullOrWhiteSpace(_query)
            ? $"after:{yesterday:yyyy/MM/dd}"
            : _query;

        // The query is coarse (day granularity / label-based), so still enforce
        // the precise 24h cutoff in code.
        var emails = (await FetchByQueryAsync(effectiveQuery, ct))
            .Where(e => e.ReceivedAt >= yesterday)
            .ToList();

        _logger.LogInformation("Found {Count} emails from last 24 hours", emails.Count);
        return emails;
    }

    public async Task<List<EmailMessage>> GetEmailsByQueryAsync(string query, CancellationToken ct = default)
    {
        var emails = await FetchByQueryAsync(query, ct);
        _logger.LogInformation("Found {Count} emails for query: {Query}", emails.Count, query);
        return emails;
    }

    public async Task<bool> EnsureJobApplicationsFilterAsync(IReadOnlyCollection<string> coreCompanies, CancellationToken ct = default)
    {
        if (coreCompanies.Count == 0)
        {
            _logger.LogInformation("No companies to filter on — skipping Gmail filter reconcile.");
            return false;
        }

        // Resolve the label id. We never create the label here (keeps scopes minimal and
        // avoids a surprise label) — if it's missing the user hasn't set up the label the
        // whole flow relies on, so warn and skip.
        var labels = await _gmail.Users.Labels.List("me").ExecuteAsync(ct);
        var label = labels.Labels?.FirstOrDefault(l =>
            string.Equals(l.Name, _labelName, StringComparison.OrdinalIgnoreCase));
        if (label is null)
        {
            _logger.LogWarning(
                "Gmail label '{Label}' not found — cannot manage its filter. Create the label in Gmail first.",
                _labelName);
            return false;
        }

        var desiredQuery = BuildFilterQuery(coreCompanies);

        var existing = await _gmail.Users.Settings.Filters.List("me").ExecuteAsync(ct);
        // Mailbot-managed = any filter whose action adds our label. The user should not keep
        // a separate manual filter on this label; the mailbot owns it.
        var managed = (existing.Filter ?? new List<Filter>())
            .Where(f => f.Action?.AddLabelIds?.Contains(label.Id) == true)
            .ToList();

        if (managed.Count == 1 && string.Equals(managed[0].Criteria?.Query, desiredQuery, StringComparison.Ordinal))
        {
            _logger.LogInformation("Gmail filter already in sync ({Count} companies) — no change.", coreCompanies.Count);
            return false;
        }

        foreach (var f in managed)
        {
            await _gmail.Users.Settings.Filters.Delete("me", f.Id).ExecuteAsync(ct);
            _logger.LogInformation("Deleted stale Gmail filter {Id}", f.Id);
        }

        var created = await _gmail.Users.Settings.Filters.Create(new Filter
        {
            Criteria = new FilterCriteria { Query = desiredQuery },
            Action = new FilterAction { AddLabelIds = new List<string> { label.Id } }
        }, "me").ExecuteAsync(ct);

        _logger.LogInformation(
            "Created Gmail filter {Id} labeling {Count} companies as '{Label}': {Query}",
            created.Id, coreCompanies.Count, _labelName, desiredQuery);
        return true;
    }

    // Canonical filter query: distinct, trimmed company names, sorted case-insensitively,
    // each quoted, joined with OR — e.g. "Acme" OR "Globex". Deterministic so the in-sync
    // check above is a stable string compare. (Inner quotes are stripped to keep the query
    // well-formed.)
    internal static string BuildFilterQuery(IEnumerable<string> coreCompanies) =>
        string.Join(" OR ", coreCompanies
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c.Trim().Replace("\"", ""))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .Select(c => $"\"{c}\""));

    // Runs a Gmail query with paging and returns the parsed messages. No date
    // filtering — callers apply any window they need.
    private async Task<List<EmailMessage>> FetchByQueryAsync(string query, CancellationToken ct)
    {
        _logger.LogInformation("Fetching emails with query: {Query}", query);

        var request = _gmail.Users.Messages.List("me");
        request.Q = query;
        request.MaxResults = 500;

        var emails = new List<EmailMessage>();

        do
        {
            var response = await request.ExecuteAsync(ct);

            if (response.Messages == null || !response.Messages.Any())
                break;

            foreach (var message in response.Messages)
            {
                var fullMessage = await _gmail.Users.Messages.Get("me", message.Id).ExecuteAsync(ct);
                emails.Add(ParseGmailMessage(fullMessage));
            }

            request.PageToken = response.NextPageToken;
        } while (request.PageToken != null);

        return emails;
    }

    private EmailMessage ParseGmailMessage(Message message)
    {
        var headers = message.Payload.Headers;
        var subject = headers.FirstOrDefault(h => h.Name == "Subject")?.Value ?? "";
        var from = headers.FirstOrDefault(h => h.Name == "From")?.Value ?? "";
        var dateStr = headers.FirstOrDefault(h => h.Name == "Date")?.Value ?? "";

        var body = GetEmailBody(message.Payload);

        return new EmailMessage
        {
            Subject = subject,
            From = from,
            Body = body,
            ReceivedAt = ParseEmailDate(dateStr)
        };
    }

    // Collect ALL text parts (plain + html), decoding each and stripping HTML, then
    // concatenate. Earlier this returned only the FIRST text part, so dates/times
    // rendered inside ATS / calendar-invite HTML cards (e.g. eightfold "Meeting
    // Agenda", Google Calendar) never reached the parser. Gathering everything makes
    // those visible.
    private static string GetEmailBody(MessagePart payload)
    {
        var sb = new System.Text.StringBuilder();
        CollectText(payload, sb);
        var text = sb.ToString().Trim();
        const int max = 50_000; // keep the parse request bounded
        return text.Length > max ? text[..max] : text;
    }

    private static void CollectText(MessagePart? part, System.Text.StringBuilder sb)
    {
        if (part is null) return;

        if (part.Body?.Data != null && part.MimeType is "text/plain" or "text/html")
        {
            var bytes = Convert.FromBase64String(part.Body.Data.Replace('-', '+').Replace('_', '/'));
            var text = System.Text.Encoding.UTF8.GetString(bytes);
            if (part.MimeType == "text/html") text = StripHtml(text);
            if (!string.IsNullOrWhiteSpace(text)) sb.AppendLine(text);
        }

        if (part.Parts != null)
            foreach (var child in part.Parts) CollectText(child, sb);
    }

    private static string StripHtml(string html)
    {
        html = System.Text.RegularExpressions.Regex.Replace(
            html, @"<(script|style)[^>]*>.*?</\1>", " ",
            System.Text.RegularExpressions.RegexOptions.Singleline | System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        html = System.Text.RegularExpressions.Regex.Replace(html, @"<[^>]+>", " ");
        html = System.Net.WebUtility.HtmlDecode(html);
        return System.Text.RegularExpressions.Regex.Replace(html, @"\s+", " ").Trim();
    }

    private DateTime ParseEmailDate(string dateString)
    {
        // RFC 2822 Date headers often carry a trailing comment like " (UTC)" that
        // DateTimeOffset.TryParse rejects (e.g. "Wed, 17 Jun 2026 07:37:26 +0000 (UTC)").
        // Strip a trailing parenthetical before parsing.
        var cleaned = System.Text.RegularExpressions.Regex
            .Replace(dateString ?? "", @"\s*\([^)]*\)\s*$", "")
            .Trim();

        if (DateTimeOffset.TryParse(cleaned, out var dto))
            return dto.UtcDateTime;

        _logger.LogWarning("Failed to parse email date '{DateString}', falling back to UtcNow", dateString);
        return DateTime.UtcNow;
    }
}
