using System.Net;
using System.Net.Http.Json;
using Mailbot.Models;
using Microsoft.Extensions.Logging;

namespace Mailbot.Services;

/// <summary>
/// HTTP client for the ApplicationTracker API.
/// Aligned with actual API endpoints:
///   GET  /api/applications              -> all apps (filtered client-side for active)
///   PUT  /api/applications/{id}/status  -> { "newStatus": "...", "note": "..." }
///   POST /api/applications/{id}/interviews -> Interview object
/// </summary>
public sealed class TrackerApiClient : ITrackerApiClient
{
    private const int MaxRetries = 3;

    private static readonly HashSet<HttpStatusCode> TransientStatuses = new()
    {
        HttpStatusCode.TooManyRequests,     // 429
        HttpStatusCode.BadGateway,          // 502
        HttpStatusCode.ServiceUnavailable,  // 503
        HttpStatusCode.GatewayTimeout       // 504
    };

    private readonly HttpClient _http;
    private readonly ILogger<TrackerApiClient> _logger;

    // Statuses that are considered "active" (not terminal)
    private static readonly HashSet<string> TerminalStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "Rejected", "Withdrawn", "Accepted"
    };

    public TrackerApiClient(HttpClient http, ILogger<TrackerApiClient> logger)
    {
        _http = http;
        _logger = logger;
    }

    public async Task<List<TrackerApplication>?> GetActiveApplicationsAsync(CancellationToken ct = default)
    {
        using var response = await SendWithRetryAsync(
            () => _http.GetAsync("/api/applications", ct),
            "GetActiveApplicationsAsync",
            ct);

        if (response is null || !response.IsSuccessStatusCode)
        {
            _logger.LogError("Failed to get applications from Tracker API. Status: {Status}",
                response?.StatusCode.ToString() ?? "no response");
            return null;
        }

        var apps = await response.Content.ReadFromJsonAsync<List<TrackerApplication>>(cancellationToken: ct)
            ?? new List<TrackerApplication>();

        var active = apps.Where(a => !TerminalStatuses.Contains(a.Status)).ToList();
        _logger.LogInformation("Retrieved {Total} applications, {Active} active", apps.Count, active.Count);
        return active;
    }

    public async Task<bool> UpdateApplicationStatusAsync(Guid appId, string newStatus, string? note = null, CancellationToken ct = default)
    {
        using var response = await SendWithRetryAsync(
            () => _http.PutAsJsonAsync(
                $"/api/applications/{appId}/status",
                new { newStatus, note },
                ct),
            $"UpdateApplicationStatusAsync({appId})",
            ct);

        if (response is null)
            return false;

        if (response.IsSuccessStatusCode)
        {
            _logger.LogInformation("Updated application {AppId} to status {Status}", appId, newStatus);
            return true;
        }

        _logger.LogWarning("Failed to update application {AppId}. Status: {HttpStatus}",
            appId, response.StatusCode);
        return false;
    }

    public async Task<bool> AddInterviewAsync(Guid appId, AddInterviewRequest interview, CancellationToken ct = default)
    {
        using var response = await SendWithRetryAsync(
            () => _http.PostAsJsonAsync(
                $"/api/applications/{appId}/interviews",
                new
                {
                    applicationId = appId,
                    scheduledAt = interview.ScheduledAt,
                    type = interview.Type,
                    interviewer = interview.Interviewer,
                    topics = interview.Topics,
                    notes = interview.Notes
                },
                ct),
            $"AddInterviewAsync({appId})",
            ct);

        if (response is null)
            return false;

        if (response.IsSuccessStatusCode)
        {
            _logger.LogInformation("Added {Type} interview for application {AppId}", interview.Type, appId);
            return true;
        }

        _logger.LogWarning("Failed to add interview for {AppId}. Status: {HttpStatus}",
            appId, response.StatusCode);
        return false;
    }

    private async Task<HttpResponseMessage?> SendWithRetryAsync(
        Func<Task<HttpResponseMessage>> send,
        string operationName,
        CancellationToken ct)
    {
        for (var attempt = 0; attempt <= MaxRetries; attempt++)
        {
            HttpResponseMessage? response = null;
            try
            {
                response = await send();

                if (TransientStatuses.Contains(response.StatusCode) && attempt < MaxRetries)
                {
                    var delay = BackoffDelay(attempt);
                    _logger.LogWarning(
                        "{Operation} returned {Status} — retry {Attempt}/{Max} in {Delay}s",
                        operationName, (int)response.StatusCode, attempt + 1, MaxRetries, delay.TotalSeconds);
                    response.Dispose();
                    await Task.Delay(delay, ct);
                    continue;
                }

                return response;
            }
            catch (Exception ex) when (attempt < MaxRetries && IsTransient(ex))
            {
                response?.Dispose();
                var delay = BackoffDelay(attempt);
                _logger.LogWarning(ex,
                    "{Operation} transport error — retry {Attempt}/{Max} in {Delay}s",
                    operationName, attempt + 1, MaxRetries, delay.TotalSeconds);
                await Task.Delay(delay, ct);
            }
            catch (Exception ex)
            {
                response?.Dispose();
                _logger.LogError(ex, "{Operation} failed", operationName);
                return null;
            }
        }

        return null;
    }

    private static TimeSpan BackoffDelay(int attempt) =>
        TimeSpan.FromSeconds(Math.Min(Math.Pow(2, attempt), 8));

    private static bool IsTransient(Exception ex)
    {
        if (ex is HttpRequestException or TaskCanceledException or TimeoutException)
            return true;
        return ex.InnerException is not null && IsTransient(ex.InnerException);
    }
}
