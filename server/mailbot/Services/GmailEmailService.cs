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
                    Scopes = new[] { GmailService.Scope.GmailReadonly }
                });

                credential = new UserCredential(flow, "user", token);
            }
            else
            {
                _logger.LogInformation("Gmail token secret not found, falling back to interactive authorization.");

                credential = GoogleWebAuthorizationBroker.AuthorizeAsync(
                    clientSecrets.Secrets,
                    new[] { GmailService.Scope.GmailReadonly },
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

    private static string GetEmailBody(MessagePart payload)
    {
        if (payload.Body?.Data != null)
        {
            var bytes = Convert.FromBase64String(
                payload.Body.Data.Replace('-', '+').Replace('_', '/'));
            return System.Text.Encoding.UTF8.GetString(bytes);
        }

        if (payload.Parts != null)
        {
            foreach (var part in payload.Parts)
            {
                if (part.MimeType is "text/plain" or "text/html")
                {
                    return GetEmailBody(part);
                }
            }
        }

        return string.Empty;
    }

    private DateTime ParseEmailDate(string dateString)
    {
        if (DateTimeOffset.TryParse(dateString, out var dto))
            return dto.UtcDateTime;

        _logger.LogWarning("Failed to parse email date '{DateString}', falling back to UtcNow", dateString);
        return DateTime.UtcNow;
    }
}
