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

    public GmailEmailService(IConfiguration config, IHostEnvironment env, ILogger<GmailEmailService> logger)
    {
        _logger = logger;

        // Choose credentials path in order of preference:
        // 1. Explicit Gmail:CredentialsPath config (absolute or relative)
        // 2. Render secret file at /etc/secrets/credentials.json
        // 3. Local credentials.json next to the executable (content root)
        var configuredPath = config["Gmail:CredentialsPath"];
        var secretPath = "/etc/secrets/credentials.json";
        var localPath = Path.Combine(env.ContentRootPath, "credentials.json");

        string credentialPath;
        if (!string.IsNullOrWhiteSpace(configuredPath))
        {
            credentialPath = Path.IsPathRooted(configuredPath)
                ? configuredPath
                : Path.Combine(env.ContentRootPath, configuredPath);
            _logger.LogInformation("Using configured Gmail credentials path: {Path}", credentialPath);
        }
        else if (File.Exists(secretPath))
        {
            credentialPath = secretPath;
            _logger.LogInformation("Using Gmail credentials from secret path: {Path}", credentialPath);
        }
        else
        {
            credentialPath = localPath;
            _logger.LogInformation("Using Gmail credentials from local path: {Path}", credentialPath);
        }

        if (!File.Exists(credentialPath))
        {
            throw new FileNotFoundException($"Gmail credentials file not found at '{credentialPath}'. " +
                                            "Ensure credentials.json is mounted as a secret or provide Gmail:CredentialsPath.");
        }

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
        var yesterdayFormatted = yesterday.ToString("yyyy/MM/dd");

        var effectiveQuery = string.IsNullOrWhiteSpace(_query)
            ? $"after:{yesterdayFormatted}"
            : _query;

        if (string.IsNullOrWhiteSpace(_query))
        {
            _logger.LogInformation("Fetching emails since {Date} (last 24 hours) with default query: {Query}", yesterday, effectiveQuery);
        }
        else
        {
            _logger.LogInformation("Fetching emails using configured Gmail query: {Query}", effectiveQuery);
        }

        var request = _gmail.Users.Messages.List("me");
        request.Q = effectiveQuery;

        var response = await request.ExecuteAsync(ct);

        if (response.Messages == null || !response.Messages.Any())
        {
            _logger.LogInformation("No emails found in last 24 hours");
            return new List<EmailMessage>();
        }

        var emails = new List<EmailMessage>();

        foreach (var message in response.Messages)
        {
            var fullMessage = await _gmail.Users.Messages.Get("me", message.Id).ExecuteAsync(ct);
            var email = ParseGmailMessage(fullMessage);

            // Double-check it's actually from last 24 hours
            if (email.ReceivedAt >= yesterday)
            {
                emails.Add(email);
            }
        }

        _logger.LogInformation("Found {Count} emails from last 24 hours", emails.Count);
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

    private static DateTime ParseEmailDate(string dateString)
    {
        if (DateTime.TryParse(dateString, out var date))
            return date;

        return DateTime.UtcNow;
    }
}
