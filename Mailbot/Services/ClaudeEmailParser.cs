using System.Text.Json;
using Anthropic.SDK;
using Anthropic.SDK.Messaging;
using Mailbot.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Mailbot.Services;

/// <summary>
/// Uses Claude to parse job-related emails and extract structured updates.
/// Only parses emails from tracked companies.
/// </summary>
public sealed class ClaudeEmailParser : IEmailParser
{
    private readonly AnthropicClient _claude;
    private readonly ILogger<ClaudeEmailParser> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public ClaudeEmailParser(IConfiguration config, ILogger<ClaudeEmailParser> logger)
    {
        var apiKey = config["Anthropic:ApiKey"]?.Trim();
        if (string.IsNullOrEmpty(apiKey))
            throw new InvalidOperationException("Anthropic API key not configured. Set Anthropic:ApiKey or environment variable Anthropic__ApiKey.");

        _claude = new AnthropicClient(apiKey);
        _logger = logger;
    }

    public async Task<EmailUpdate?> ParseEmailAsync(
        EmailMessage email,
        List<string> knownCompanies,
        CancellationToken ct = default)
    {
        try
        {
            var companiesList = string.Join(", ", knownCompanies);

            var prompt = $$"""
                You are parsing a job application email. The user is tracking applications to these companies:
                {{companiesList}}
                
                ONLY parse this email if it's from one of these companies. If it's not, return null.
                
                EMAIL SUBJECT: {{email.Subject}}
                EMAIL FROM: {{email.From}}
                EMAIL BODY:
                {{email.Body}}
                
                ---
                
                If this email is from one of the tracked companies AND is job-related, return JSON:
                {
                  "company": "exact company name from the list above",
                  "updateType": "ApplicationReceived" | "InterviewScheduled" | "Rejected" | "OfferReceived" | "FollowUp",
                  "interviewDate": "YYYY-MM-DD or null",
                  "interviewTime": "HH:MM or null",
                  "interviewer": "name or null",
                  "interviewType": "Phone" | "Technical" | "Final" | "HR" | null,
                  "notes": "important details or null"
                }
                
                If NOT from tracked companies or NOT job-related, return: null
                
                Return ONLY the JSON or null, nothing else.
                """;

            var messages = new List<Message>
            {
                new(RoleType.User, prompt)
            };

            var parameters = new MessageParameters
            {
                Messages = messages,
                Model = "claude-opus-4-20250514",
                MaxTokens = 512,
                Temperature = 0.3m,
                Stream = false
            };

            var response = await _claude.Messages.GetClaudeMessageAsync(parameters, ct);
            var jsonContent = response.Content.OfType<TextContent>().FirstOrDefault()?.Text?.Trim();

            if (string.IsNullOrWhiteSpace(jsonContent) || jsonContent.Equals("null", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogInformation("Email not relevant: {Subject}", email.Subject);
                return null;
            }

            // Clean potential markdown code fence
            jsonContent = jsonContent.Replace("```json", "").Replace("```", "").Trim();

            var update = JsonSerializer.Deserialize<EmailUpdate>(jsonContent, JsonOptions);

            _logger.LogInformation("Parsed email from {Company}: {Type}", update?.Company, update?.UpdateType);
            return update;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error parsing email: {Subject}", email.Subject);
            return null;
        }
    }
}
