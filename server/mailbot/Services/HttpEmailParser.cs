using System.Net;
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

    /// <summary>
    /// Returns the parsed update, or null when the API says this email is not
    /// job-related (204). Throws <see cref="EmailParseException"/> when it could
    /// not answer — see that type for why the two must not share a return value.
    /// </summary>
    public async Task<EmailUpdate?> ParseEmailAsync(
        EmailMessage email,
        List<string> knownCompanies,
        DateTime? referenceDateOverride = null,
        CancellationToken ct = default)
    {
        HttpResponseMessage response;
        try
        {
            var request = new
            {
                subject = email.Subject,
                from = email.From,
                body = email.Body,
                knownCompanies,
                receivedAt = referenceDateOverride ?? email.ReceivedAt
            };

            response = await _http.PostAsJsonAsync("/api/emails/parse", request, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // A cancelled run is not a parse failure. Let it through untouched so
            // it is never recorded as an error against this email.
            throw;
        }
        catch (Exception ex)
        {
            throw new EmailParseException(
                $"Could not reach the parse API for '{email.Subject}': {ex.Message}", ex);
        }

        using (response)
        {
            if (response.StatusCode == HttpStatusCode.NoContent)
            {
                // The one legitimate null: the model read it and it is not about a
                // job application.
                _logger.LogInformation("Email not relevant: {Subject}", email.Subject);
                return null;
            }

            if (!response.IsSuccessStatusCode)
            {
                throw new EmailParseException(
                    $"Parse API returned {(int)response.StatusCode} ({response.StatusCode}) "
                    + $"for '{email.Subject}'.");
            }

            EmailUpdate? update;
            try
            {
                update = await response.Content.ReadFromJsonAsync<EmailUpdate>(JsonOptions, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new EmailParseException(
                    $"Parse API returned {(int)response.StatusCode} for '{email.Subject}' "
                    + $"but the body could not be read: {ex.Message}", ex);
            }

            if (update is null)
            {
                // "Not relevant" is 204 by contract (EmailParseEndpoints returns
                // NoContent for it), so a success status carrying no body is a
                // fault rather than an answer -- and silently treating it as "not
                // relevant" is exactly the conflation this class no longer makes.
                throw new EmailParseException(
                    $"Parse API returned {(int)response.StatusCode} with no body for "
                    + $"'{email.Subject}'.");
            }

            _logger.LogInformation("Parsed email from {Company}: {Type}", update.Company, update.UpdateType);
            return update;
        }
    }
}
