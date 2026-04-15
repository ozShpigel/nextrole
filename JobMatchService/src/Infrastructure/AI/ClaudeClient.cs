using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Anthropic.SDK;
using Anthropic.SDK.Constants;
using Anthropic.SDK.Messaging;
using JobMatchService.Core.AI;
using JobMatchService.Core.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace JobMatchService.Infrastructure.AI;

public sealed class ClaudeClient : IClaudeClient
{
    private readonly AnthropicClient _client;
    private readonly PromptBuilder _promptBuilder;
    private readonly ILogger<ClaudeClient> _logger;
    private readonly IHttpClientFactory? _httpClientFactory;
    private readonly string? _discoveryBaseUrl;

    private const string DefaultModel = "claude-opus-4-20250514";

    public ClaudeClient(
        IConfiguration configuration,
        PromptBuilder promptBuilder,
        ILogger<ClaudeClient> logger,
        IHttpClientFactory? httpClientFactory = null)
    {
        var apiKey = configuration["Anthropic:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("Anthropic:ApiKey is not configured");
        }

        _client = new AnthropicClient(apiKey);
        _promptBuilder = promptBuilder;
        _logger = logger;
        _httpClientFactory = httpClientFactory;
        _discoveryBaseUrl = configuration["JobDiscovery:BaseUrl"];
    }

    private async Task<(string model, decimal tempMatch, int maxTokensMatch)> GetScoringConfigAsync()
    {
        if (!string.IsNullOrEmpty(_discoveryBaseUrl) && _httpClientFactory != null)
        {
            try
            {
                var client = _httpClientFactory.CreateClient("ProfileApi");
                var response = await client.GetAsync($"{_discoveryBaseUrl}/api/discovery/profile");
                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync();
                    var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.TryGetProperty("scoring_config", out var config))
                    {
                        var model = config.TryGetProperty("model", out var m) ? m.GetString() ?? DefaultModel : DefaultModel;
                        var temp = config.TryGetProperty("temperature_match", out var t) ? (decimal)t.GetDouble() : 0.5m;
                        var tokens = config.TryGetProperty("max_tokens_match", out var mt) ? mt.GetInt32() : 4096;
                        _logger.LogInformation("Scoring config from MongoDB: model={Model}, temp={Temp}, maxTokens={MaxTokens}", model, temp, tokens);
                        return (model, temp, tokens);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch scoring config, using defaults");
            }
        }
        return (DefaultModel, 0.5m, 4096);
    }

    public async Task<ParsedJob> ParseJobDescriptionAsync(string jobDescription, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Parsing job description");

        try
        {
            var prompt = _promptBuilder.BuildAnalysisPrompt(jobDescription);

            var (model, _, _) = await GetScoringConfigAsync();

            _logger.LogInformation("=== Claude parse request ===");
            _logger.LogInformation("Model: {Model} | MaxTokens: 2048 | Temp: 0.3", model);
            _logger.LogInformation("Job description length: {Length} chars", jobDescription.Length);
            _logger.LogInformation("Prompt length: {Length} chars", prompt.Length);

            var messages = new List<Message>
            {
                new(RoleType.User, prompt)
            };

            var parameters = new MessageParameters
            {
                Messages = messages,
                MaxTokens = 2048,
                Model = model,
                Stream = false,
                Temperature = 0.3m
            };

            var response = await _client.Messages.GetClaudeMessageAsync(parameters, cancellationToken);
            
            if (response?.Message == null)
            {
                throw new InvalidOperationException("Empty response from Claude API");
            }

            var content = response.Message.ToString();
            _logger.LogDebug("Received response from Claude API. Length: {Length} characters", content?.Length ?? 0);

            // Extract JSON from response (handle markdown code blocks if present)
            var jsonContent = ExtractJson(content);
            
            var parsedJob = JsonSerializer.Deserialize<ParsedJob>(jsonContent, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

            if (parsedJob == null)
            {
                throw new InvalidOperationException("Failed to deserialize ParsedJob from Claude response");
            }

            _logger.LogInformation("Job description parsed successfully. Job Title: {JobTitle}", parsedJob.JobTitle);
            return parsedJob;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error parsing job description");
            throw;
        }
    }

    public async Task<MatchResponse> EvaluateMatchAsync(string profile, ParsedJob parsedJob, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Evaluating job match");

        try
        {
            var prompt = _promptBuilder.BuildEvaluationPrompt(profile, parsedJob);

            var (model, tempMatch, maxTokensMatch) = await GetScoringConfigAsync();

            _logger.LogInformation("=== Claude evaluate request ===");
            _logger.LogInformation("Model: {Model} | MaxTokens: {MaxTokens} | Temp: {Temp}", model, maxTokensMatch, tempMatch);
            _logger.LogInformation("Profile length: {ProfileLen} chars | Prompt length: {PromptLen} chars", profile.Length, prompt.Length);
            _logger.LogInformation("Job: {Title} at {Company}", parsedJob.JobTitle, parsedJob.Company);

            var messages = new List<Message>
            {
                new(RoleType.User, prompt)
            };

            var parameters = new MessageParameters
            {
                Messages = messages,
                MaxTokens = maxTokensMatch,
                Model = model,
                Stream = false,
                Temperature = tempMatch
            };

            var response = await _client.Messages.GetClaudeMessageAsync(parameters, cancellationToken);
            
            if (response?.Message == null)
            {
                throw new InvalidOperationException("Empty response from Claude API");
            }

            var content = response.Message.ToString();
            _logger.LogDebug("Received response from Claude API. Length: {Length} characters", content?.Length ?? 0);

            // Extract JSON from response (handle markdown code blocks if present)
            var jsonContent = ExtractJson(content);
            
            var matchResponse = JsonSerializer.Deserialize<MatchResponse>(jsonContent, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

            if (matchResponse == null)
            {
                throw new InvalidOperationException("Failed to deserialize MatchResponse from Claude response");
            }

            _logger.LogInformation("Match evaluation completed. Verdict: {Verdict}, Score: {Score}", 
                matchResponse.Verdict, matchResponse.OverallScore);
            return matchResponse;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error evaluating job match");
            throw;
        }
    }

    private static string ExtractJson(string? content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            throw new InvalidOperationException("Empty content from Claude API");
        }

        // Remove markdown code blocks if present
        var json = content.Trim();
        
        if (json.StartsWith("```json", StringComparison.OrdinalIgnoreCase))
        {
            json = json.Substring(7);
        }
        else if (json.StartsWith("```", StringComparison.OrdinalIgnoreCase))
        {
            json = json.Substring(3);
        }

        if (json.EndsWith("```", StringComparison.OrdinalIgnoreCase))
        {
            json = json.Substring(0, json.Length - 3);
        }

        json = json.Trim();

        // Normalize snake_case keys to camelCase so the deserializer handles both conventions
        var node = JsonNode.Parse(json);
        if (node != null)
        {
            NormalizeKeys(node);
            json = node.ToJsonString();
        }

        return json;
    }

    /// <summary>
    /// Recursively converts all snake_case JSON keys to camelCase.
    /// Combined with PropertyNameCaseInsensitive, this handles both snake_case and camelCase from Claude.
    /// </summary>
    private static void NormalizeKeys(JsonNode node)
    {
        if (node is JsonObject obj)
        {
            var entries = obj.ToList();
            foreach (var (key, value) in entries)
            {
                var camelKey = SnakeToCamel(key);
                if (camelKey != key)
                {
                    obj.Remove(key);
                    obj[camelKey] = value;
                }
                if (value != null)
                {
                    NormalizeKeys(value);
                }
            }
        }
        else if (node is JsonArray arr)
        {
            foreach (var item in arr)
            {
                if (item != null) NormalizeKeys(item);
            }
        }
    }

    private static string SnakeToCamel(string snake)
    {
        if (!snake.Contains('_')) return snake;

        var parts = snake.Split('_');
        return parts[0] + string.Concat(parts.Skip(1).Select(p =>
            p.Length > 0 ? char.ToUpper(p[0]) + p.Substring(1) : ""));
    }
}
