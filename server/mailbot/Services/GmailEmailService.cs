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
    private readonly int _lookbackDays;

    // Read-only: the mailbot only searches and reads mail. (Tokens consented with
    // broader scopes keep working — a superset is fine.)
    private static readonly string[] Scopes = { GmailService.Scope.GmailReadonly };

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
        _lookbackDays = int.TryParse(config["Gmail:LookbackDays"], out var days) && days > 0 ? days : 3;

        _logger.LogInformation("Gmail service initialized");
    }

    // Automated senders that never carry a genuine employer decision — verified
    // against live mailbox data (2026-08-21): every false-positive match in a
    // real run traced to one of these (LinkedIn job-alert digests, profile-view
    // stats, connection/message teasers, "application sent/viewed" trackers;
    // Indeed's recommendation bot). LinkedIn's message-teaser emails never
    // include the actual message body, so nothing parseable is ever lost by
    // excluding the domain upfront — a real employer reply always comes from
    // the company's own domain or ATS, never from these. Shared with re-sync's
    // query (MailbotOrchestrator) so both paths get the same reduction.
    public const string NoiseExclusions = "-from:linkedin.com -from:donotreply@match.indeed.com";

    // Daily sync: search recent mail directly by the tracked companies' names.
    // Search is retroactive by nature, so a company added to the tracker today is
    // found against the whole window immediately — no label/filter dependency.
    // The window (default 3d) overlaps previous runs on purpose: re-processing is
    // idempotent, and the slack covers "applied Friday, tracked Sunday".
    public async Task<List<EmailMessage>> GetEmailsForCompaniesAsync(IReadOnlyCollection<string> coreCompanies, CancellationToken ct = default)
    {
        if (coreCompanies.Count == 0)
        {
            _logger.LogInformation("No companies to search for — skipping Gmail fetch.");
            return new List<EmailMessage>();
        }

        // Gmail:Query, when set, overrides the built query verbatim (ops escape hatch).
        var effectiveQuery = string.IsNullOrWhiteSpace(_query)
            ? $"newer_than:{_lookbackDays}d ({BuildCompanyNamesQuery(coreCompanies)}) {NoiseExclusions}"
            : _query;

        var emails = await FetchByQueryAsync(effectiveQuery, ct);
        _logger.LogInformation("Found {Count} emails in the last {Days}d for {Companies} companies",
            emails.Count, _lookbackDays, coreCompanies.Count);
        return emails;
    }

    public async Task<List<EmailMessage>> GetEmailsByQueryAsync(string query, CancellationToken ct = default)
    {
        var emails = await FetchByQueryAsync(query, ct);
        _logger.LogInformation("Found {Count} emails for query: {Query}", emails.Count, query);
        return emails;
    }

    // Canonical company-names query: distinct, trimmed names, sorted case-insensitively,
    // each quoted, joined with OR — e.g. "Acme" OR "Globex". (Inner quotes are stripped
    // to keep the query well-formed.)
    internal static string BuildCompanyNamesQuery(IEnumerable<string> coreCompanies) =>
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
            GmailMessageId = message.Id,
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
