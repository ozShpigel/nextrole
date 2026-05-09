using System.Net.Http.Json;
using System.Text.Json;
using Mailbot.Models;
using Microsoft.Extensions.Logging;

namespace Mailbot.Services;

public sealed class HttpEmailParser : IEmailParser
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly HttpClient _http;
    private readonly ILogger<HttpEmailParser> _logger;

    public HttpEmailParser(HttpClient http, ILogger<HttpEmailParser> logger)
    {
        _http = http;
        _logger = logger;
    }

    public async Task<EmailUpdate?> ParseEmailAsync(
        EmailMessage email,
        List<string> knownCompanies,
        CancellationToken ct = default)
    {
        try
        {
            var request = new
            {
                subject = email.Subject,
                from = email.From,
                body = email.Body,
                knownCompanies
            };

            using var response = await _http.PostAsJsonAsync("/api/emails/parse", request, ct);

            if (response.StatusCode == System.Net.HttpStatusCode.NoContent)
            {
                _logger.LogInformation("Email not relevant: {Subject}", email.Subject);
                return null;
            }

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Email parse API returned {Status} for: {Subject}", response.StatusCode, email.Subject);
                return null;
            }

            var update = await response.Content.ReadFromJsonAsync<EmailUpdate>(JsonOptions, ct);
            _logger.LogInformation("Parsed email from {Company}: {Type}", update?.Company, update?.UpdateType);
            return update;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error parsing email via API: {Subject}", email.Subject);
            return null;
        }
    }
}
