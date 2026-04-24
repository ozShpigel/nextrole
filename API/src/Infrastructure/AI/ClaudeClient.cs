using System.Text.Json;
using System.Text.Json.Nodes;
using Anthropic.SDK;
using Anthropic.SDK.Messaging;
using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Profile;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Infrastructure.AI;

public sealed class ClaudeClient : IClaudeClient
{
    private readonly HttpClient _httpClient;
    private readonly AnthropicClient _client;
    private readonly PromptBuilder _promptBuilder;
    private readonly IProfileProvider _profileProvider;
    private readonly ILogger<ClaudeClient> _logger;

    public ClaudeClient(
        IConfiguration configuration,
        PromptBuilder promptBuilder,
        IProfileProvider profileProvider,
        ILogger<ClaudeClient> logger)
    {
        var apiKey = configuration["Anthropic:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("Anthropic:ApiKey is not configured");
        }

        // Anthropic.SDK 5.9 ships its internal HttpClient with the default
        // 100s timeout, which isn't enough for Sonnet-with-extended-thinking
        // on long prompts (our evaluate calls routinely run ~2-3m). The
        // caller-side timeout (scraper) is 300s, so match that here — any
        // genuine stall beyond 5 minutes is an upstream issue, not ours.
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(300) };
        _client = new AnthropicClient(apiKey, _httpClient);
        _promptBuilder = promptBuilder;
        _profileProvider = profileProvider;
        _logger = logger;
    }

    public async Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Parsing job description");

        var analystPrompt = await _profileProvider.GetAnalystPromptAsync(cancellationToken);
        var prompt = _promptBuilder.BuildAnalysisPrompt(jobDescription, analystPrompt);
        var cfg = (await _profileProvider.GetScoringConfigAsync(cancellationToken)).Analyst;

        _logger.LogInformation("=== Claude parse request ===");
        _logger.LogInformation("Model: {Model} | MaxTokens: {MaxTokens} | Temp: {Temp} | Thinking: {Thinking}",
            cfg.Model, cfg.MaxTokens, cfg.Temperature, cfg.ThinkingEnabled);
        _logger.LogInformation("Job description length: {Length} chars", jobDescription.Length);
        _logger.LogInformation("Prompt length: {Length} chars", prompt.Length);
        _logger.LogDebug("=== Full parse prompt ===\n{Prompt}\n=== End parse prompt ===", prompt);

        var parameters = new MessageParameters
        {
            Messages = new List<Message> { new(RoleType.User, prompt) },
            MaxTokens = cfg.MaxTokens,
            Model = cfg.Model,
            Stream = false,
            Temperature = cfg.Temperature
        };

        if (cfg.ThinkingEnabled && cfg.ThinkingBudget > 0 && cfg.MaxTokens > cfg.ThinkingBudget)
        {
            parameters.Thinking = new ThinkingParameters
            {
                BudgetTokens = cfg.ThinkingBudget
            };
            parameters.Temperature = 1m;
        }

        var inputJson = SerializeCallInput(parameters, prompt);

        var response = await _client.Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        if (response?.Message == null)
            throw new InvalidOperationException("Empty response from Claude API");

        var content = response.Message.ToString() ?? "";
        _logger.LogDebug("Received parse response from Claude. Length: {Length} chars", content.Length);

        var jsonContent = ExtractJson(content);
        var parsedJob = JsonSerializer.Deserialize<ParsedJob>(jsonContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("Failed to deserialize ParsedJob");

        _logger.LogInformation("Job parsed. Title: {Title}", parsedJob.JobTitle);
        return (parsedJob, new ClaudeCallSnapshot(inputJson, content));
    }

    public async Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Evaluating job match");

        var evaluatorPrompt = await _profileProvider.GetEvaluatorPromptAsync(cancellationToken);
        var prompt = _promptBuilder.BuildEvaluationPrompt(profile, parsedJob, evaluatorPrompt);
        var cfg = (await _profileProvider.GetScoringConfigAsync(cancellationToken)).Evaluator;

        _logger.LogInformation("=== Claude evaluate request ===");
        _logger.LogInformation("Model: {Model} | MaxTokens: {MaxTokens} | Temp: {Temp} | Thinking: {Thinking}",
            cfg.Model, cfg.MaxTokens, cfg.Temperature, cfg.ThinkingEnabled);
        _logger.LogInformation("Profile length: {ProfileLen} chars | Prompt length: {PromptLen} chars",
            profile.Length, prompt.Length);
        _logger.LogInformation("Job: {Title} at {Company}", parsedJob.JobTitle, parsedJob.Company);
        _logger.LogDebug("=== Full evaluate prompt ===\n{Prompt}\n=== End evaluate prompt ===", prompt);

        var parameters = new MessageParameters
        {
            Messages = new List<Message> { new(RoleType.User, prompt) },
            MaxTokens = cfg.MaxTokens,
            Model = cfg.Model,
            Stream = false,
            Temperature = cfg.Temperature
        };

        if (cfg.ThinkingEnabled && cfg.ThinkingBudget > 0 && cfg.MaxTokens > cfg.ThinkingBudget)
        {
            parameters.Thinking = new ThinkingParameters
            {
                BudgetTokens = cfg.ThinkingBudget
            };
            parameters.Temperature = 1m;
        }

        var inputJson = SerializeCallInput(parameters, prompt);

        var response = await _client.Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        if (response?.Message == null)
            throw new InvalidOperationException("Empty response from Claude API");

        var content = response.Message.ToString() ?? "";
        _logger.LogDebug("Received evaluate response from Claude. Length: {Length} chars", content.Length);

        var jsonContent = ExtractJson(content);
        var matchResponse = JsonSerializer.Deserialize<MatchResponse>(jsonContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("Failed to deserialize MatchResponse");

        _logger.LogInformation("Match evaluation completed. Verdict: {Verdict}, Score: {Score}",
            matchResponse.Verdict, matchResponse.OverallScore);
        return (matchResponse, new ClaudeCallSnapshot(inputJson, content));
    }

    private static string SerializeCallInput(MessageParameters parameters, string userPrompt)
    {
        // Capture what's actually sent to Claude so we can later replay or
        // diff a failed call. We serialize via reflection for `System`
        // because its shape (string vs. list-of-blocks) has shifted across
        // Anthropic.SDK major versions; a reflected read keeps us working
        // if the SDK changes the type without forcing us to re-write this.
        object? systemValue = null;
        try
        {
            var systemProp = parameters.GetType().GetProperty("System");
            systemValue = systemProp?.GetValue(parameters);
        }
        catch
        {
            // If reflection fails for any reason, just omit it — we still
            // have the full user prompt which is the primary artifact.
        }

        return JsonSerializer.Serialize(new
        {
            system = systemValue,
            user = userPrompt,
            model = parameters.Model,
            maxTokens = parameters.MaxTokens,
            temperature = parameters.Temperature,
            thinking = parameters.Thinking == null
                ? null
                : new { budgetTokens = parameters.Thinking.BudgetTokens } as object
        }, new JsonSerializerOptions { WriteIndented = false });
    }

    private static string ExtractJson(string? content)
    {
        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidOperationException("Empty content from Claude API");

        var json = content.Trim();

        if (json.StartsWith("```json", StringComparison.OrdinalIgnoreCase))
            json = json.Substring(7);
        else if (json.StartsWith("```", StringComparison.OrdinalIgnoreCase))
            json = json.Substring(3);

        if (json.EndsWith("```", StringComparison.OrdinalIgnoreCase))
            json = json.Substring(0, json.Length - 3);

        json = json.Trim();

        var node = JsonNode.Parse(json);
        if (node != null)
        {
            NormalizeKeys(node);
            json = node.ToJsonString();
        }

        return json;
    }

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
                if (value != null) NormalizeKeys(value);
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
