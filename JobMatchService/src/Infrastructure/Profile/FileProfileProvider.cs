using System.Text.Json;
using JobMatchService.Core.Profile;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace JobMatchService.Infrastructure.Profile;

public sealed class FileProfileProvider : IProfileProvider
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<FileProfileProvider> _logger;
    private readonly HttpClient? _httpClient;

    public FileProfileProvider(
        IConfiguration configuration,
        ILogger<FileProfileProvider> logger,
        IHttpClientFactory? httpClientFactory = null)
    {
        _configuration = configuration;
        _logger = logger;
        _httpClient = httpClientFactory?.CreateClient("ProfileApi");
    }

    public async Task<string> GetProfileAsync(CancellationToken cancellationToken = default)
    {
        // Try MongoDB via JobDiscovery API first
        var discoveryUrl = _configuration["JobDiscovery:BaseUrl"];
        if (!string.IsNullOrEmpty(discoveryUrl) && _httpClient != null)
        {
            try
            {
                _logger.LogInformation("Fetching profile from JobDiscovery: {Url}", discoveryUrl);
                var response = await _httpClient.GetAsync(
                    $"{discoveryUrl}/api/discovery/profile", cancellationToken);

                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync(cancellationToken);
                    var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.TryGetProperty("content", out var contentEl))
                    {
                        var content = contentEl.GetString();
                        if (!string.IsNullOrEmpty(content))
                        {
                            _logger.LogInformation(
                                "Profile loaded from MongoDB via JobDiscovery ({Length} chars)", content.Length);
                            return content;
                        }
                    }
                }
                _logger.LogWarning("JobDiscovery profile response was empty, falling back to file");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch profile from JobDiscovery, falling back to file");
            }
        }

        // Fallback to file
        var basePath = _configuration["ContentRoot"] ?? Directory.GetCurrentDirectory();
        var relativePath = _configuration["Profile:FilePath"] ?? "Data/professional-profile.md";
        var filePath = Path.Combine(basePath, relativePath);

        _logger.LogInformation("Loading profile from file: {FilePath}", filePath);

        if (!File.Exists(filePath))
        {
            _logger.LogError("Profile file not found: {FilePath}", filePath);
            throw new FileNotFoundException($"Profile file not found: {filePath}");
        }

        try
        {
            var content = await File.ReadAllTextAsync(filePath, cancellationToken);
            _logger.LogDebug("Profile loaded from file. Length: {Length} characters", content.Length);
            return content;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading profile file: {FilePath}", filePath);
            throw;
        }
    }
}
