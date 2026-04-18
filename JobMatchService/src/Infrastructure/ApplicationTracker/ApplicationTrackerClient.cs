using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Logging;

namespace JobMatchService.Infrastructure.ApplicationTracker;

public sealed class ApplicationTrackerClient : IApplicationTrackerClient
{
    private const int MaxRetries = 3;

    private static readonly HashSet<HttpStatusCode> TransientStatuses = new()
    {
        HttpStatusCode.TooManyRequests,     // 429
        HttpStatusCode.BadGateway,          // 502
        HttpStatusCode.ServiceUnavailable,  // 503
        HttpStatusCode.GatewayTimeout       // 504
    };

    private readonly HttpClient _httpClient;
    private readonly ILogger<ApplicationTrackerClient> _logger;

    public ApplicationTrackerClient(HttpClient httpClient, ILogger<ApplicationTrackerClient> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<bool> IsTrackerHealthyAsync(CancellationToken ct = default)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
            var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Application Tracker health check failed");
            return false;
        }
    }

    public async Task<bool> CreateApplicationAsync(CreateApplicationRequest request, CancellationToken ct = default)
    {
        using var response = await SendWithRetryAsync(
            () => _httpClient.PostAsJsonAsync("/api/applications", request, ct),
            "CreateApplicationAsync",
            ct);

        if (response is null)
            return false;

        if (response.IsSuccessStatusCode)
        {
            _logger.LogInformation("Application saved to tracker: {Company} - {JobTitle}",
                request.Company, request.JobTitle);
            return true;
        }

        _logger.LogWarning("Failed to save application to tracker. Status: {Status}", response.StatusCode);
        return false;
    }

    public async Task<bool> IsApplicationExistsAsync(string company, string jobTitle, CancellationToken ct = default)
    {
        using var response = await SendWithRetryAsync(
            () => _httpClient.GetAsync(
                $"/api/applications/exists?company={Uri.EscapeDataString(company)}&jobTitle={Uri.EscapeDataString(jobTitle)}",
                ct),
            "IsApplicationExistsAsync",
            ct);

        if (response is null || !response.IsSuccessStatusCode)
            return false;

        return await response.Content.ReadFromJsonAsync<bool>(cancellationToken: ct);
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
