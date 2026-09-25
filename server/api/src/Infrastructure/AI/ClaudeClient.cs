using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Anthropic.SDK;
using Anthropic.SDK.Batches;
using Anthropic.SDK.Messaging;
using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Email;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Infrastructure.AI;

internal sealed class LenientStringArrayConverter : JsonConverter<string[]>
{
    public override string[] Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            reader.Skip();
            return [];
        }
        var list = new List<string>();
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndArray)
                break;
            if (reader.TokenType == JsonTokenType.String)
                list.Add(reader.GetString()!);
            else if (reader.TokenType == JsonTokenType.Number)
                list.Add(reader.GetDouble().ToString());
            else if (reader.TokenType is JsonTokenType.True or JsonTokenType.False)
                list.Add(reader.GetBoolean().ToString());
            else if (reader.TokenType == JsonTokenType.Null)
                continue;
            else
                reader.Skip();
        }
        return list.ToArray();
    }

    public override void Write(Utf8JsonWriter writer, string[] value, JsonSerializerOptions options)
    {
        writer.WriteStartArray();
        foreach (var item in value)
            writer.WriteStringValue(item);
        writer.WriteEndArray();
    }
}

internal sealed class LenientNullableStringConverter : JsonConverter<string?>
{
    public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
            return reader.GetString();
        if (reader.TokenType == JsonTokenType.Null)
            return null;
        if (reader.TokenType == JsonTokenType.Number)
            return reader.GetDouble().ToString();
        if (reader.TokenType is JsonTokenType.True or JsonTokenType.False)
            return reader.GetBoolean().ToString();
        reader.Skip();
        return null;
    }

    public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else writer.WriteStringValue(value);
    }
}

public sealed class ClaudeClient : IClaudeClient
{
    private static readonly JsonSerializerOptions CaseInsensitive = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new LenientStringArrayConverter(), new LenientNullableStringConverter() }
    };

    private readonly AnthropicClient _client;
    // Per-caller Anthropic API keys (Anthropic:ApiKeys:{source}), so the
    // Anthropic Console can report cost split by caller (mailbot vs. ingest
    // vs. everything else on the default key). Keyed by the inbound
    // X-Source header, read per-call via IHttpContextAccessor since this
    // service is a DI singleton — see ResolveClient().
    private readonly Dictionary<string, AnthropicClient> _clientsBySource;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly PromptBuilder _promptBuilder;
    private readonly IProfileProvider _profileProvider;
    private readonly PromptOptions _prompts;
    private readonly ScoringConfig _scoring;
    private readonly ILogger<ClaudeClient> _logger;

    public ClaudeClient(
        IConfiguration configuration,
        IHttpClientFactory httpClientFactory,
        IHttpContextAccessor httpContextAccessor,
        PromptBuilder promptBuilder,
        IProfileProvider profileProvider,
        PromptOptions prompts,
        ScoringConfig scoring,
        ILogger<ClaudeClient> logger)
    {
        var apiKey = configuration["Anthropic:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("Anthropic:ApiKey is not configured");
        }

        // Anthropic.SDK's AnthropicClient applies its API key to the HttpClient
        // it's given (confirmed empirically against SDK 5.9.0: it's sticky on
        // that HttpClient instance, not sent per-request) — sharing ONE
        // HttpClient across multiple AnthropicClient instances means whichever
        // one set the header first "wins" for every call through any of them,
        // silently defeating per-source key routing below. Each client gets
        // its own HttpClient from the factory (still pools connections/handlers
        // under the hood — this is the intended way to call CreateClient more
        // than once) so its own key actually takes effect.
        _client = new AnthropicClient(apiKey, httpClientFactory.CreateClient("anthropic"));

        var sourceKeys = configuration.GetSection("Anthropic:ApiKeys").Get<Dictionary<string, string>>() ?? [];
        _clientsBySource = new Dictionary<string, AnthropicClient>(StringComparer.OrdinalIgnoreCase);
        foreach (var (source, key) in sourceKeys)
        {
            if (!string.IsNullOrWhiteSpace(key))
                _clientsBySource[source] = new AnthropicClient(key, httpClientFactory.CreateClient("anthropic"));
        }

        _httpContextAccessor = httpContextAccessor;
        _promptBuilder = promptBuilder;
        _profileProvider = profileProvider;
        _prompts = prompts;
        _scoring = scoring;
        _logger = logger;
    }

    // Picks the Anthropic client for the current request's X-Source header
    // (set by mailbot/scraper — see AGENTS.md-adjacent callers), falling
    // back to the default client for the browser/UI and any unrecognized
    // or missing source.
    private AnthropicClient ResolveClient()
    {
        var source = _httpContextAccessor.HttpContext?.Request.Headers["X-Source"].ToString();
        if (string.IsNullOrEmpty(source))
        {
            return _client;
        }
        if (_clientsBySource.TryGetValue(source, out var client))
        {
            _logger.LogInformation("Claude call routed to source-specific key for '{Source}'", source);
            return client;
        }
        _logger.LogWarning("X-Source '{Source}' has no configured Anthropic API key — falling back to default", source);
        return _client;
    }

    // Raw X-Source header value (or null), for callers that just want to
    // attribute a call rather than route its API key — see ResolveClient().
    private string? CurrentSource()
    {
        var source = _httpContextAccessor.HttpContext?.Request.Headers["X-Source"].ToString();
        return string.IsNullOrEmpty(source) ? null : source;
    }

    // Configured prompts, blank-guarded back to the bundled seed so an empty
    // override env var can never silently ship an empty system prompt.
    private string AnalystPrompt =>
        string.IsNullOrWhiteSpace(_prompts.Analyzer) ? PromptSeeds.Analyst : _prompts.Analyzer;
    private string EvaluatorPrompt =>
        string.IsNullOrWhiteSpace(_prompts.Evaluator) ? PromptSeeds.Evaluator : _prompts.Evaluator;

    // {{OUTPUT_LANGUAGE}} substitution for the prompts that don't go through
    // PromptBuilder (which hardcodes English for its own — see
    // PromptBuilder.OutputLanguage). Every call site below passes a
    // hardcoded `false` — not a config lookup — so generation is always
    // English; Hebrew is requested per-application afterward via
    // TranslateTextAsync/TranslateMatchAnalysisAsync instead (CompanySummary
    // and WhyWorkHere used to vary this via the now-removed
    // Prompts__HebrewOutput flags, generating Hebrew directly and giving the
    // user no English version at all — replaced by the same on-demand
    // translate-per-application pattern the match analysis already used).
    private static string ResolveOutputLanguage(string prompt, bool hebrew) =>
        prompt.Replace("{{OUTPUT_LANGUAGE}}", hebrew ? "Hebrew" : "English");

    public Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, CancellationToken cancellationToken = default)
        => ParseJobDescriptionAsync(jobDescription, AnalystPrompt, _scoring.Analyst, cancellationToken);

    public async Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, string analystPrompt, RoleScoringConfig analystConfig, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Parsing job description ({Length} chars)", jobDescription.Length);

        var (systemPrompt, userMessage) = _promptBuilder.BuildAnalysisPrompt(jobDescription, analystPrompt);

        var (result, snapshot) = await CallClaudeAsync<ParsedJob>(systemPrompt, userMessage, analystConfig, "parse", cancellationToken);
        _logger.LogInformation("Job parsed. Title: {Title}", result.JobTitle);
        return (result, snapshot);
    }

    public async Task<(List<ParseBatchResult> Results, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionBatchAsync(IReadOnlyList<MatchBatchItem> jobs, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Parsing {Count} job descriptions in one batch call", jobs.Count);

        var (systemPrompt, userMessage) = _promptBuilder.BuildAnalysisBatchPrompt(jobs, AnalystPrompt);

        var (envelope, snapshot) = await CallClaudeAsync<ParseBatchApiEnvelope>(systemPrompt, userMessage, _scoring.AnalystBatch, "parse-batch", cancellationToken);

        var byId = (envelope.Results ?? [])
            .Where(r => !string.IsNullOrWhiteSpace(r.Id) && r.Parsed is not null)
            .ToDictionary(r => r.Id!, r => r.Parsed!);

        var missing = jobs.Select(j => j.Id).Where(id => !byId.ContainsKey(id)).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException(
                $"Batch parse response is missing job id(s): {string.Join(", ", missing)}");

        var results = jobs.Select(j => new ParseBatchResult { Id = j.Id, Parsed = byId[j.Id] }).ToList();
        _logger.LogInformation("Batch parse completed: {Count} results", results.Count);
        return (results, snapshot);
    }

    private sealed record ParseBatchApiEnvelope
    {
        [JsonPropertyName("results")]
        public List<ParseBatchApiItem>? Results { get; init; }
    }

    private sealed record ParseBatchApiItem
    {
        [JsonPropertyName("id")]
        public string? Id { get; init; }
        [JsonPropertyName("parsed")]
        public ParsedJob? Parsed { get; init; }
    }

    public Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CompanyProfile? companyProfile = null, CancellationToken cancellationToken = default)
        => EvaluateMatchAsync(profile, parsedJob, EvaluatorPrompt, _scoring.Evaluator, companyNews, glassdoorData, companyProfile, cancellationToken);

    public async Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, string evaluatorPrompt, RoleScoringConfig evaluatorConfig, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CompanyProfile? companyProfile = null, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Evaluating job match: {Title} at {Company}", parsedJob.JobTitle, parsedJob.Company);

        var (systemPrompt, userMessage) = _promptBuilder.BuildEvaluationPrompt(profile, parsedJob, evaluatorPrompt, companyNews, glassdoorData, companyProfile);

        var (result, snapshot) = await CallClaudeAsync<MatchResponse>(systemPrompt, userMessage, evaluatorConfig, "evaluate", cancellationToken);
        _logger.LogInformation("Match evaluation completed. Verdict: {Verdict}, Score: {Score}",
            result.Verdict, result.OverallScore);
        return (result, snapshot);
    }

    public async Task<(List<MatchBatchResult> Results, ClaudeCallSnapshot Snapshot, string? Source)> EvaluateMatchBatchAsync(string profile, IReadOnlyList<EvaluationBatchItem> jobs, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Evaluating {Count} jobs in one batch call", jobs.Count);

        var (systemPrompt, userMessage) = _promptBuilder.BuildEvaluationBatchPrompt(profile, jobs, EvaluatorPrompt);

        var (envelope, snapshot) = await CallClaudeAsync<MatchBatchApiEnvelope>(systemPrompt, userMessage, _scoring.EvaluatorBatch, "evaluate-batch", cancellationToken);

        var byId = (envelope.Results ?? [])
            .Where(r => !string.IsNullOrWhiteSpace(r.Id) && r.Response is not null)
            .ToDictionary(r => r.Id!, r => r.Response!);

        // Fail loud rather than silently drop a job — a missing id means every
        // job in this batch stays unscored on the caller's retry-next-cycle
        // path (orchestrator.py), which is safer than guessing.
        var missing = jobs.Select(j => j.Id).Where(id => !byId.ContainsKey(id)).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException(
                $"Batch evaluation response is missing job id(s): {string.Join(", ", missing)}");

        var results = jobs.Select(j => new MatchBatchResult { Id = j.Id, Response = byId[j.Id] }).ToList();
        _logger.LogInformation("Batch evaluation completed: {Count} results", results.Count);
        return (results, snapshot, CurrentSource());
    }

    private sealed record MatchBatchApiEnvelope
    {
        [JsonPropertyName("results")]
        public List<MatchBatchApiItem>? Results { get; init; }
    }

    private sealed record MatchBatchApiItem
    {
        [JsonPropertyName("id")]
        public string? Id { get; init; }
        [JsonPropertyName("response")]
        public MatchResponse? Response { get; init; }
    }

    public async Task<NarrativeEnrichResponse> EnrichNarrativeAsync(Guid userId, NarrativeEnrichRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Enriching narrative for: {Title} at {Company}", request.Title, request.Company);

        var profile = await _profileProvider.GetProfileAsync(userId, cancellationToken);
        var (systemPrompt, userMessage) = _promptBuilder.BuildNarrativeEnrichmentPrompt(profile, request, PromptSeeds.NarrativeEnrichment);

        var (result, _) = await CallClaudeAsync<NarrativeEnrichResponse>(
            systemPrompt, userMessage, _scoring.NarrativeEnrichment, "enrich-narrative", cancellationToken);

        // Prompt asks for at most 3 questions, but LLMs don't reliably
        // self-enforce numeric caps — clamp here too.
        if (result.Recommendation is { QuestionsToAsk.Length: > 3 } rec)
        {
            result = result with { Recommendation = rec with { QuestionsToAsk = rec.QuestionsToAsk[..3] } };
        }

        return result;
    }

    public async Task<EmailParseResult?> ParseEmailAsync(
        string subject, string from, string body, List<string> knownCompanies,
        DateTime? referenceDate = null,
        CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Parsing email: {Subject}", subject);

        // Company names come from scraped job postings — untrusted. They must not
        // be interpolated into the system prompt; they go in the user message,
        // XML-wrapped like the email itself, so prompt-injection attempts in a
        // poisoned company name are treated as data, not instructions.
        var companiesList = string.Join(", ", knownCompanies);
        // Reference date for resolving day-first / year-less / relative interview
        // dates (e.g. "28.6" → 2026-06-28). Use the email's own received date when
        // known (so re-syncing old mail resolves the right year); else now.
        var refDate = (referenceDate ?? DateTime.UtcNow).ToString("yyyy-MM-dd");
        var systemPrompt = string.Format(PromptSeeds.EmailParser, refDate);

        var parameters = new MessageParameters
        {
            // System prompt (instructions + reference date) repeats across every
            // email in a mailbot run — cache it so only the first email per
            // distinct reference date pays full input price.
            System = new List<SystemMessage>
            {
                new(systemPrompt, new CacheControl { Type = CacheControlType.ephemeral, TTL = CacheDuration.OneHour }),
            },
            Messages = new List<Message>
            {
                new()
                {
                    Role = RoleType.User,
                    Content = new List<ContentBase>
                    {
                        // The known-companies list also repeats across every email in
                        // a run — cache it as its own block so moving it out of the
                        // system prompt doesn't reintroduce the cache-fragmentation
                        // cost bug this project already fixed once.
                        new TextContent
                        {
                            Text = $"<known_companies>\n{companiesList}\n</known_companies>",
                            CacheControl = new CacheControl { Type = CacheControlType.ephemeral, TTL = CacheDuration.OneHour },
                        },
                        new TextContent
                        {
                            Text = $"<email>\n<subject>{subject}</subject>\n<from>{from}</from>\n<body>{body}</body>\n</email>",
                        },
                    },
                },
            },
            MaxTokens = 512,
            // Simple structured extraction — Haiku handles it at ~1/3 the cost of
            // Sonnet, and the daily 3d-lookback re-parses every email ~3 times.
            Model = "claude-haiku-4-5-20251001",
            Temperature = 0.3m,
            Stream = false,
            PromptCaching = PromptCacheType.FineGrained,
        };

        var response = await ResolveClient().Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim();

        if (string.IsNullOrWhiteSpace(content) || content.Equals("null", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogInformation("Email not relevant: {Subject}", subject);
            return null;
        }

        var jsonContent = ExtractJson(content, "parse-email");
        var result = JsonSerializer.Deserialize<EmailParseResult>(jsonContent, CaseInsensitive);
        _logger.LogInformation("Parsed email from {Company}: {Type}", result?.Company, result?.UpdateType);
        return result;
    }

    public async Task<string> SummarizeCompanyAsync(string companyName, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Generating company summary for: {Company}", companyName);

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage> { new(ResolveOutputLanguage(PromptSeeds.CompanySummary, false)) },
            Messages = new List<Message> { new(RoleType.User, companyName) },
            MaxTokens = 512,
            Model = "claude-haiku-4-5-20251001",
            Temperature = 0.3m,
            Stream = false
        };

        var response = await ResolveClient().Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        _logger.LogInformation("Company summary generated for: {Company}", companyName);
        return content;
    }

    public async Task<string> TranslateMatchAnalysisAsync(string matchAnalysisJson, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Translating match analysis to Hebrew ({Length} chars)", matchAnalysisJson.Length);

        // matchAnalysisJson is our own stored MatchResponse JSON, not scraped
        // external data — still XML-wrapped per house convention, since the
        // model must be told to treat it as data (its string values, sourced
        // originally from a job posting, could contain injection attempts).
        var userMessage = $"<match_analysis>\n{matchAnalysisJson}\n</match_analysis>";

        var (result, _) = await CallClaudeAsync<JsonObject>(
            PromptSeeds.TranslateMatchAnalysis, userMessage, _scoring.TranslateAnalysis, "translate-analysis", cancellationToken);

        return result.ToJsonString();
    }

    // Plain-text counterpart to TranslateMatchAnalysisAsync — Company Summary
    // and the "Why work here?" answer are single paragraphs, not JSON, so
    // this calls Claude directly (like SummarizeCompanyAsync) instead of
    // going through CallClaudeAsync<T>'s JSON deserialization.
    public async Task<string> TranslateTextAsync(string text, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Translating text to Hebrew ({Length} chars)", text.Length);

        // Not scraped external data, but still XML-wrapped per house
        // convention — the model must be told to treat it as data, since its
        // content was ultimately shaped by a job posting/company name.
        var userMessage = $"<text>\n{text}\n</text>";

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage> { new(PromptSeeds.TranslateFreeText) },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = _scoring.TranslateAnalysis.MaxTokens,
            Model = _scoring.TranslateAnalysis.Model,
            Temperature = _scoring.TranslateAnalysis.Temperature,
            Stream = false
        };

        var response = await ResolveClient().Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        _logger.LogInformation("Text translated to Hebrew ({Length} chars)", content.Length);
        return content;
    }

    public async Task<string> GenerateWhyWorkHereAsync(Application app, string profile, InterviewPrepDocument prep, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Generating 'why work here' answer for: {Company} / {Title}", app.Company, app.JobTitle);

        // System prompt: trusted instructions + the user's own (trusted) profile
        // and self-presentation. External company/job data goes in the user
        // message wrapped in XML tags (treated as untrusted data).
        var systemBuilder = new System.Text.StringBuilder(ResolveOutputLanguage(PromptSeeds.WhyWorkHere, false));
        if (!string.IsNullOrWhiteSpace(profile))
            systemBuilder.Append("\n\n# Candidate Profile\n").Append(profile.Trim());
        if (!string.IsNullOrWhiteSpace(prep.SelfPresentationHr))
            systemBuilder.Append("\n\n# Self-Presentation (HR)\n").Append(prep.SelfPresentationHr.Trim());
        if (!string.IsNullOrWhiteSpace(prep.SelfPresentationTechnical))
            systemBuilder.Append("\n\n# Self-Presentation (Technical)\n").Append(prep.SelfPresentationTechnical.Trim());

        var userBuilder = new System.Text.StringBuilder();
        userBuilder.Append("<company>").Append(app.Company).Append("</company>\n");
        userBuilder.Append("<job_title>").Append(app.JobTitle).Append("</job_title>\n");
        if (!string.IsNullOrWhiteSpace(app.JobDescription))
            userBuilder.Append("<job_description>").Append(app.JobDescription).Append("</job_description>\n");
        if (!string.IsNullOrWhiteSpace(app.CompanySummary))
            userBuilder.Append("<company_summary>").Append(app.CompanySummary).Append("</company_summary>\n");
        if (!string.IsNullOrWhiteSpace(app.CompanyNews))
            userBuilder.Append("<company_news>").Append(app.CompanyNews).Append("</company_news>\n");
        if (!string.IsNullOrWhiteSpace(app.GlassdoorData))
            userBuilder.Append("<glassdoor>").Append(app.GlassdoorData).Append("</glassdoor>\n");

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage> { new(systemBuilder.ToString()) },
            Messages = new List<Message> { new(RoleType.User, userBuilder.ToString()) },
            MaxTokens = 800,
            Model = "claude-haiku-4-5-20251001",
            Temperature = 0.6m,
            Stream = false
        };

        var response = await ResolveClient().Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        _logger.LogInformation("'Why work here' answer generated for: {Company} ({Length} chars)", app.Company, content.Length);
        return content;
    }

    public async Task<List<string>> GeneratePresentationCuesAsync(string presentationText, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Generating presentation cues ({Length} chars)", presentationText.Length);

        // The user's own text — wrapped in XML and labelled as data, consistent
        // with the project's system/user separation convention.
        var userMessage = $"<presentation>\n{presentationText.Trim()}\n</presentation>";

        var parameters = new MessageParameters
        {
            // Hardcoded false, not a config lookup — PresentationCues isn't
            // one of the two agents PromptOptions.HebrewOutput can vary.
            System = new List<SystemMessage> { new(ResolveOutputLanguage(PromptSeeds.PresentationCues, false)) },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = 1024,
            Model = "claude-haiku-4-5-20251001",
            Temperature = 0.2m,
            Stream = false
        };

        var response = await ResolveClient().Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        var json = ExtractJson(content, "presentation-cues");
        var parsed = JsonSerializer.Deserialize<PresentationCuesResult>(json, CaseInsensitive);
        var cues = (parsed?.Cues ?? [])
            .Select(c => c?.Trim() ?? "")
            .Where(c => c.Length > 0)
            .ToList();

        _logger.LogInformation("Generated {Count} presentation cues", cues.Count);
        return cues;
    }

    private sealed record PresentationCuesResult
    {
        [JsonPropertyName("cues")]
        public string[]? Cues { get; init; }
    }

    // Both batched classification calls below send every item in one request and
    // correlate the results by jobId, so the response size scales with the batch
    // — and the endpoints accept up to 200 items. A single MaxTokens is therefore
    // a guess that a large enough run invalidates, which is exactly what happened:
    // correlating by jobId grew each result row from {"index":12} to a 36-char
    // UUID, output blew past MaxTokens=2000 on any run over ~40 titles, and the
    // callers' fail-open path quietly scored every job for twelve days.
    // Chunking makes the per-call output budget one number for every run size.
    //
    // Measured on Haiku 4.5 against a real 90-title run: 30 titles produced 1512
    // output tokens (~50/row, dominated by the UUID) and 48 titles truncated at
    // 2000. Seniority rows are cheaper (no reason string) but share the shape.
    private const int ClassifyChunkSize = 25;
    // Job-facts rows are far bigger than a triage or seniority row — two tech
    // arrays plus four scalars, versus a verdict and a short reason. Measured on
    // a real 167-job run: 25 items produced 3,192-3,779 output tokens (~140/row)
    // and one chunk of 25 tipped past 4,000 and truncated, costing its call and
    // leaving 25 jobs unextracted. Sized for roughly double the observed worst
    // case, because a truncation is deterministic for a given chunk: retrying
    // the same items in the same size truncates again, so those jobs would burn
    // all three attempts and end up with no facts at all.
    private const int JobFactsChunkSize = 12;
    private const int ClassifyChunkMaxTokens = 4000;
    // Keeps a full 200-item run (8 chunks) inside the scraper's 120s timeout.
    private const int ClassifyChunkParallelism = 4;

    // A truncated response is not a malformed response, and the two must stop
    // looking alike. Past MaxTokens the JSON is cut off mid-array, ExtractJson
    // throws the same JsonException a genuinely bad answer would, and the caller
    // treats it as "the model had nothing useful to say" — which is how a 2x
    // ingest bill read as a normal run. Name the cause while it is still knowable.
    private static void ThrowIfTruncated(MessageResponse response, string label, int itemCount)
    {
        if (string.Equals(response.StopReason, "max_tokens", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"{label}: hit max_tokens on a {itemCount}-item chunk — the response was truncated mid-JSON, "
                + "not a model failure. Lower ClassifyChunkSize or raise ClassifyChunkMaxTokens.");
        }
    }

    // Runs one batched classification prompt over fixed-size chunks and merges
    // the results. A chunk that fails is logged and dropped rather than failing
    // the whole call: every caller reads a missing jobId as "no verdict" and
    // keeps the job, so one bad chunk costs one chunk's filtering instead of the
    // run's. The caller records how many verdicts went missing — see the
    // scraper's triage_status.
    private async Task<List<TResult>> ClassifyInChunksAsync<TItem, TResponse, TResult>(
        IReadOnlyList<TItem> items,
        string systemPrompt,
        string label,
        Func<IReadOnlyList<TItem>, string> buildUserMessage,
        Func<TResponse, List<TResult>> selectResults,
        CancellationToken cancellationToken,
        int? chunkSize = null) where TResponse : class
    {
        var chunks = items.Chunk(chunkSize ?? ClassifyChunkSize).ToList();
        var perChunk = new List<TResult>[chunks.Count];
        using var gate = new SemaphoreSlim(ClassifyChunkParallelism);

        await Task.WhenAll(chunks.Select(async (chunk, index) =>
        {
            await gate.WaitAsync(cancellationToken);
            try
            {
                var parameters = ClassifyParameters(systemPrompt, buildUserMessage(chunk));

                var response = await ResolveClient().Messages.GetClaudeMessageAsync(parameters, cancellationToken);
                ThrowIfTruncated(response, label, chunk.Length);

                // Same usage line the streaming path emits. These batched calls
                // are the whole per-run bill for ingest, so "what does a day
                // cost" has to be answerable from the logs rather than estimated.
                _logger.LogInformation(
                    "Claude {Label} usage — input={Input} output={Output} items={Items}",
                    label, response.Usage?.InputTokens, response.Usage?.OutputTokens, chunk.Length);

                var content = response.Message?.ToString()?.Trim()
                    ?? throw new InvalidOperationException($"{label}: empty response from Claude API");
                var parsed = JsonSerializer.Deserialize<TResponse>(ExtractJson(content, label), CaseInsensitive)
                    ?? throw new InvalidOperationException($"{label}: could not parse response");

                perChunk[index] = selectResults(parsed);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex,
                    "{Label}: chunk {Index}/{Total} ({Count} items) failed — those items get no verdict",
                    label, index + 1, chunks.Count, chunk.Length);
                perChunk[index] = [];
            }
            finally
            {
                gate.Release();
            }
        }));

        var merged = new List<TResult>(items.Count);
        foreach (var part in perChunk)
        {
            merged.AddRange(part);
        }
        return merged;
    }

    // One chunk's request, for the live call above and for a batch request
    // alike -- so the two cannot drift, and a batch answer is the answer the
    // live call would have given.
    private MessageParameters ClassifyParameters(string systemPrompt, string userMessage) => new()
    {
        System = new List<SystemMessage> { new(systemPrompt) },
        Messages = new List<Message> { new(RoleType.User, userMessage) },
        MaxTokens = ClassifyChunkMaxTokens,
        Model = _scoring.Analyst.Model,
        Temperature = 0.2m,
        Stream = false
    };

    public async Task<TitleTriageResponse> TriageTitlesAsync(TitleTriageRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Triaging {Count} scraped titles against intent '{Intent}'",
            request.Titles.Count, request.SearchIntent);

        var intent = request.SearchIntent.Trim();
        var camelCase = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        var results = await ClassifyInChunksAsync<TitleTriageItem, TitleTriageResponse, TitleTriageResult>(
            request.Titles,
            // Hardcoded false, not a config lookup — TitleTriage isn't one of
            // the two agents PromptOptions.HebrewOutput can vary.
            ResolveOutputLanguage(PromptSeeds.TitleTriage, false),
            "title-triage",
            chunk =>
            {
                var titlesJson = JsonSerializer.Serialize(
                    chunk.Select(t => new { t.JobId, t.Title, t.Company }), camelCase);
                // Titles come from external job boards — untrusted, XML-wrapped as data.
                return $"<search_intent>\n{intent}\n</search_intent>\n\n"
                     + $"<scraped_titles>\n{titlesJson}\n</scraped_titles>";
            },
            r => r.Results,
            cancellationToken);

        // Counted three ways on purpose: "dropped" and "no verdict" both leave
        // jobs_triaged_out low, and only this line separates them.
        _logger.LogInformation(
            "Title triage: {Total} titles, {Verdicts} verdicts, {Dropped} off-target, {Missing} without a verdict (kept by default)",
            request.Titles.Count, results.Count, results.Count(r => !r.Relevant), request.Titles.Count - results.Count);
        return new TitleTriageResponse { Results = results };
    }

    public async Task<SeniorityClassifyResponse> ClassifySeniorityAsync(SeniorityClassifyRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Classifying seniority for {Count} scraped jobs", request.Jobs.Count);

        var camelCase = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        var results = await ClassifyInChunksAsync<SeniorityClassifyItem, SeniorityClassifyResponse, SeniorityClassifyResult>(
            request.Jobs,
            PromptSeeds.SeniorityClassification,
            "seniority-classify",
            chunk =>
            {
                var jobsJson = JsonSerializer.Serialize(
                    chunk.Select(j => new { j.JobId, j.Title, j.Description }), camelCase);
                // Scraped postings — untrusted, XML-wrapped as data.
                return $"<scraped_jobs>\n{jobsJson}\n</scraped_jobs>";
            },
            r => r.Results,
            cancellationToken);

        _logger.LogInformation(
            "Seniority classification: {Total} jobs, {Verdicts} verdicts, {Labeled} labeled, {Missing} without a verdict",
            request.Jobs.Count, results.Count, results.Count(r => r.Level is not null), request.Jobs.Count - results.Count);
        return new SeniorityClassifyResponse { Results = results };
    }

    public async Task<JobFactsResponse> ExtractJobFactsAsync(JobFactsRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Extracting job facts for {Count} pool jobs", request.Jobs.Count);

        var results = await ClassifyInChunksAsync<JobFactsItem, JobFactsResponse, JobFacts>(
            request.Jobs,
            PromptSeeds.JobFactsExtraction,
            "job-facts",
            JobFactsUserMessage,
            r => r.Results,
            cancellationToken,
            JobFactsChunkSize);

        results = NormalizeJobFacts(results);

        // A job with no facts is not dropped: the pool keeps it and the caller
        // records that extraction is still owed, so a bad run costs a retry
        // rather than a posting.
        _logger.LogInformation(
            "Job facts: {Total} jobs, {Extracted} extracted, {Missing} without facts",
            request.Jobs.Count, results.Count, request.Jobs.Count - results.Count);
        return new JobFactsResponse { Results = results };
    }

    private static readonly JsonSerializerOptions CamelCase =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static string JobFactsUserMessage(IReadOnlyList<JobFactsItem> chunk)
    {
        var jobsJson = JsonSerializer.Serialize(
            chunk.Select(j => new { j.JobId, j.Title, j.Company, j.Location, j.Description }), CamelCase);
        // Scraped postings — untrusted, XML-wrapped as data.
        return $"<scraped_jobs>\n{jobsJson}\n</scraped_jobs>";
    }

    // Groups are the source of truth for what is required; the flat list is
    // derived from them so the two can never disagree. A model that ignored the
    // new field and answered only the flat list gets each name as its own
    // requirement -- the old behaviour, never a worse one. Shared by the live
    // and batch paths: whatever arrives, it is normalised the same way.
    private static List<JobFacts> NormalizeJobFacts(IEnumerable<JobFacts> results) =>
        [.. results.Select(r =>
        {
            var groups = RequirementGroups.From(r.MustHaveGroups, r.MustHaveTech);
            return r with
            {
                MustHaveGroups = groups,
                MustHaveTech = RequirementGroups.Flatten(groups),
                // Off-list values are dropped here, so storage only ever holds
                // the fixed list the filter compares against.
                Functions = JobFunctions.Normalize(r.Functions, JobFunctions.MaxPerJob),
            };
        })];

    public string ParseVersion =>
        ParseVersioning.Compute(AnalystPrompt, _scoring.AnalystBatch.Model, _scoring.AnalystBatch.Temperature);

    public async Task<JobParseResponse> ParseJobsForPoolAsync(
        JobParseRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Parsing {Count} pool jobs (ingest-time Analyst)", request.Jobs.Count);

        // Reuses the existing batch parse rather than a parallel implementation:
        // the per-user scan and the ingest must never drift on the extraction
        // schema, and the surest way to guarantee that is one call site.
        var items = PoolParseItems(request.Jobs);

        var (results, _) = await ParseJobDescriptionBatchAsync(items, cancellationToken);

        var parsed = VerifyPoolParses(request.Jobs, results);

        _logger.LogInformation("Pool parse completed: {Count} results at version {Version}",
            parsed.Count, ParseVersion);
        return new JobParseResponse { Results = parsed, ParseVersion = ParseVersion };
    }

    private static List<MatchBatchItem> PoolParseItems(IEnumerable<JobParseItem> jobs) =>
        [.. jobs.Select(j => new MatchBatchItem
        {
            Id = j.JobId,
            JobDescription = j.Description ?? "",
            Title = j.Title,
            Company = j.Company,
        })];

    // Everything that guards a shared parse runs here, before it is stored,
    // on the live and batch paths alike (see JobParse.cs on why).
    private List<JobParseResult> VerifyPoolParses(IReadOnlyList<JobParseItem> jobs, IEnumerable<ParseBatchResult> results)
    {
        // Title/Company overrides are applied the same way the scan applied
        // them — after parsing, never sent to the model.
        var byId = jobs.ToDictionary(j => j.JobId);
        return [.. results.Where(r => byId.ContainsKey(r.Id)).Select(r =>
        {
            var item = byId[r.Id];
            var verified = VerbatimCulturalSignals.Enforce(
                r.Parsed, item.Description ?? "", (signal, category) => _logger.LogWarning(
                    "Fabricated cultural signal dropped before storing a shared parse: "
                    + "signal={Signal} category={Category} jobId={JobId}", signal, category, r.Id));
            return new JobParseResult
            {
                JobId = r.Id,
                Parsed = verified with
                {
                    JobTitle = !string.IsNullOrWhiteSpace(item.Title) ? item.Title! : verified.JobTitle,
                    Company = !string.IsNullOrWhiteSpace(item.Company) ? item.Company : verified.Company,
                },
            };
        })];
    }

    // ── Ingest reads through the Message Batches API ────────────────────────
    //
    // Same requests the live endpoints make -- ClassifyParameters and
    // BuildParameters, the same chunk sizes, the same prompts -- submitted in
    // one batch at half the price. See IngestBatch.cs.

    /// <summary>Parse chunk per batch request: the ingest's own live chunk size.</summary>
    private const int PoolParseChunkSize = 10;

    public async Task<IngestBatchSubmitted> SubmitJobFactsBatchAsync(
        JobFactsRequest request, CancellationToken cancellationToken = default)
    {
        var requests = request.Jobs.Chunk(JobFactsChunkSize)
            .Select((chunk, i) => new BatchRequest
            {
                CustomId = $"c{i}",
                MessageParameters = ClassifyParameters(PromptSeeds.JobFactsExtraction, JobFactsUserMessage(chunk)),
            })
            .ToList();

        var id = await SubmitBatchAsync(requests, "job-facts-batch", request.Jobs.Count, cancellationToken);
        return new IngestBatchSubmitted { BatchId = id, Requests = requests.Count };
    }

    public async Task<IngestBatchSubmitted> SubmitJobParseBatchAsync(
        JobParseRequest request, CancellationToken cancellationToken = default)
    {
        var requests = PoolParseItems(request.Jobs).Chunk(PoolParseChunkSize)
            .Select((chunk, i) =>
            {
                var (systemPrompt, userMessage) = _promptBuilder.BuildAnalysisBatchPrompt(chunk, AnalystPrompt);
                return new BatchRequest
                {
                    CustomId = $"c{i}",
                    // stream:false -- a batch request is never streamed.
                    MessageParameters = BuildParameters(systemPrompt, userMessage, _scoring.AnalystBatch, stream: false),
                };
            })
            .ToList();

        var id = await SubmitBatchAsync(requests, "job-parse-batch", request.Jobs.Count, cancellationToken);
        return new IngestBatchSubmitted { BatchId = id, Requests = requests.Count, ParseVersion = ParseVersion };
    }

    public async Task<JobFactsBatchResponse> CollectJobFactsBatchAsync(
        string batchId, CancellationToken cancellationToken = default)
    {
        var (status, lines) = await ReadBatchAsync(batchId, "job-facts-batch", cancellationToken);
        if (status != IngestBatchStatus.Ended) return new JobFactsBatchResponse { Status = status };

        var results = new List<JobFacts>();
        var failed = 0;
        foreach (var line in lines)
        {
            var parsed = DeserializeBatchText<JobFactsResponse>(line, "job-facts-batch");
            if (parsed is null) { failed++; continue; }
            results.AddRange(parsed.Results);
        }

        return new JobFactsBatchResponse
        {
            Status = status,
            Results = NormalizeJobFacts(results),
            FailedRequests = failed,
        };
    }

    public async Task<JobParseBatchResponse> CollectJobParseBatchAsync(
        string batchId, JobParseRequest request, CancellationToken cancellationToken = default)
    {
        var (status, lines) = await ReadBatchAsync(batchId, "job-parse-batch", cancellationToken);
        if (status != IngestBatchStatus.Ended) return new JobParseBatchResponse { Status = status };

        var results = new List<ParseBatchResult>();
        var failed = 0;
        foreach (var line in lines)
        {
            var envelope = DeserializeBatchText<ParseBatchApiEnvelope>(line, "job-parse-batch");
            if (envelope is null) { failed++; continue; }
            // Unlike the live call, a missing id does not fail the rest: the
            // chunk's other parses are paid for, and the job without one is
            // simply read again on a later run.
            results.AddRange((envelope.Results ?? [])
                .Where(r => !string.IsNullOrWhiteSpace(r.Id) && r.Parsed is not null)
                .Select(r => new ParseBatchResult { Id = r.Id!, Parsed = r.Parsed! }));
        }

        return new JobParseBatchResponse
        {
            Status = status,
            // Only ids the caller sent: the request is what the answers are
            // verified against, and an id it did not send has nothing to check.
            Results = VerifyPoolParses(request.Jobs, results),
            FailedRequests = failed,
        };
    }

    private async Task<string> SubmitBatchAsync(
        List<BatchRequest> requests, string label, int jobs, CancellationToken cancellationToken)
    {
        var batch = await ResolveClient().Batches.CreateBatchAsync(requests, cancellationToken);
        _logger.LogInformation("Claude {Label} submitted batch {BatchId}: {Requests} request(s) over {Jobs} job(s)",
            label, batch.Id, requests.Count, jobs);
        return batch.Id;
    }

    /// <summary>One batch result line: its request id, and either the text or why there is none.</summary>
    private sealed record BatchLine(string CustomId, string? Text, string? Error);

    private async Task<(string Status, List<BatchLine> Lines)> ReadBatchAsync(
        string batchId, string label, CancellationToken cancellationToken)
    {
        var client = ResolveClient();
        var status = await client.Batches.RetrieveBatchStatusAsync(batchId, cancellationToken);
        var processing = Convert.ToString(status.ProcessingStatus) ?? "";
        if (!string.Equals(processing, "ended", StringComparison.OrdinalIgnoreCase))
            return (IngestBatchStatus.InProgress, []);

        var lines = new List<BatchLine>();
        await foreach (var raw in client.Batches.RetrieveBatchResultsJsonlAsync(batchId, cancellationToken))
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            lines.Add(ParseBatchLine(raw, label));
        }

        _logger.LogInformation("Claude {Label} batch {BatchId} ended: {Ok}/{Total} request(s) answered",
            label, batchId, lines.Count(l => l.Text is not null), lines.Count);
        return (IngestBatchStatus.Ended, lines);
    }

    // One line of the documented results JSONL:
    //   {"custom_id":"...","result":{"type":"succeeded","message":{"content":[...],"usage":{...},"stop_reason":"..."}}}
    //   {"custom_id":"...","result":{"type":"errored"|"expired"|"canceled","error":{...}}}
    // Logs the same usage line as the live path, so the day's cost stays
    // answerable from the logs.
    private BatchLine ParseBatchLine(string raw, string label)
    {
        var customId = "";
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            customId = root.GetProperty("custom_id").GetString() ?? "";
            var result = root.GetProperty("result");
            var type = result.TryGetProperty("type", out var t) ? t.GetString() : null;

            if (type != "succeeded" || !result.TryGetProperty("message", out var msg))
            {
                var error = result.TryGetProperty("error", out var e) ? e.ToString() : type ?? "unknown";
                _logger.LogWarning("Claude {Label} batch request {CustomId} ended {Type}: {Error}", label, customId, type, error);
                return new BatchLine(customId, null, type ?? "unknown");
            }

            if (msg.TryGetProperty("usage", out var usage))
                _logger.LogInformation(
                    "Claude {Label} usage — input={Input} output={Output} items={Items}",
                    label,
                    usage.TryGetProperty("input_tokens", out var i) ? i.GetInt32() : null,
                    usage.TryGetProperty("output_tokens", out var o) ? o.GetInt32() : null,
                    customId);

            // Truncated JSON is not a malformed answer to repair: the same
            // budget truncates it again (see ThrowIfTruncated).
            if (msg.TryGetProperty("stop_reason", out var stop) && stop.GetString() == "max_tokens")
            {
                _logger.LogError("Claude {Label} batch request {CustomId} hit max_tokens; its jobs get no read", label, customId);
                return new BatchLine(customId, null, "max_tokens");
            }

            var sb = new System.Text.StringBuilder();
            if (msg.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
                foreach (var block in content.EnumerateArray())
                    if (block.TryGetProperty("type", out var bt) && bt.GetString() == "text"
                        && block.TryGetProperty("text", out var txt))
                        sb.Append(txt.GetString());

            return new BatchLine(customId, sb.ToString(), null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Claude {Label} batch line for {CustomId} could not be read", label, customId);
            return new BatchLine(customId, null, "line: " + ex.Message);
        }
    }

    private T? DeserializeBatchText<T>(BatchLine line, string label) where T : class
    {
        if (line.Text is null) return null;
        try
        {
            return JsonSerializer.Deserialize<T>(ExtractJson(line.Text, label), CaseInsensitive);
        }
        catch (Exception ex)
        {
            // No repair retry here: that would be a live call at full price,
            // for a read the next run makes again anyway.
            _logger.LogError(ex, "Claude {Label} batch request {CustomId} returned unparseable JSON", label, line.CustomId);
            return null;
        }
    }

    public async Task<RoleClassificationResponse> ClassifyRoleAsync(
        RoleClassificationRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation(
            "Classifying pool role from {Titles} title(s) against {Existing} existing role(s)",
            request.Titles.Count, request.ExistingRoles.Count);

        var camelCase = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        var candidate = JsonSerializer.Serialize(
            new { request.Titles, request.Summary, request.Skills }, camelCase);

        // The candidate's own profile text is data, not instruction — same
        // XML-wrapped treatment as every other untrusted input.
        var userMessage =
            $"<existing_roles>\n{JsonSerializer.Serialize(request.ExistingRoles, camelCase)}\n</existing_roles>\n\n"
            + $"<candidate>\n{candidate}\n</candidate>";

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage> { new(PromptSeeds.RoleClassification) },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = 256,
            Model = "claude-haiku-4-5-20251001",
            Temperature = 0m,
            Stream = false,
        };

        var response = await ResolveClient().Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        var json = ExtractJson(content, "role-classification");
        var result = JsonSerializer.Deserialize<RoleClassificationResponse>(json, CaseInsensitive)
            ?? throw new InvalidOperationException("Failed to deserialize RoleClassificationResponse");

        // `existing` is the model's claim; this is the check. A role reported as
        // existing that is not on the list would otherwise consume a cap slot
        // while looking free.
        var matched = request.ExistingRoles.FirstOrDefault(
            r => string.Equals(r, result.Role, StringComparison.OrdinalIgnoreCase));
        var corrected = result with
        {
            Role = matched ?? result.Role,
            Existing = matched is not null,
        };
        if (corrected.Existing != result.Existing)
            _logger.LogInformation(
                "Role classification claimed existing={Claimed} for {Role}; corrected to {Actual}",
                result.Existing, result.Role, corrected.Existing);

        return corrected;
    }

    public async Task<NormalizedProfile> NormalizeProfileAsync(string text, CancellationToken cancellationToken = default, bool essentialsOnly = false)
    {
        _logger.LogInformation("Normalizing profile free-text ({Length} chars)", text.Length);

        // The candidate's own pasted text — wrapped in XML and labelled as data,
        // consistent with the project's system/user separation convention.
        var userMessage = new Message(RoleType.User, $"<candidate_text>\n{text.Trim()}\n</candidate_text>");
        return await NormalizeProfileCoreAsync(userMessage, essentialsOnly, cancellationToken);
    }

    public async Task<NormalizedProfile> NormalizeProfileFromPdfAsync(byte[] pdfBytes, CancellationToken cancellationToken = default, bool essentialsOnly = false)
    {
        _logger.LogInformation("Normalizing profile from PDF résumé ({Bytes} bytes)", pdfBytes.Length);

        // Hand the PDF straight to Claude as a native document content block (no
        // text extraction) plus a short framing text — same system prompt and
        // parsing tail as the pasted-text path.
        var userMessage = new Message
        {
            Role = RoleType.User,
            Content = new List<ContentBase>
            {
                new DocumentContent
                {
                    Source = new DocumentSource
                    {
                        Type = SourceType.base64,
                        MediaType = "application/pdf",
                        Data = Convert.ToBase64String(pdfBytes),
                    },
                },
                new TextContent
                {
                    Text = "<candidate_text>\nThe candidate's résumé is the attached PDF document. Extract per your instructions.\n</candidate_text>",
                },
            },
        };
        return await NormalizeProfileCoreAsync(userMessage, essentialsOnly, cancellationToken);
    }

    // Shared normalize call + parse: the user Message differs (pasted text vs PDF
    // document block) but the system prompt, model/config, and JSON tail are the same.
    //
    // essentialsOnly: the short read that lets matching start before the full
    // one lands (NormalizeProfileEssentials). Same prompt plus an addendum, so
    // every field keeps ONE definition; far less output, which is where the
    // time goes -- output tokens, not the PDF.
    private async Task<NormalizedProfile> NormalizeProfileCoreAsync(
        Message userMessage, bool essentialsOnly, CancellationToken cancellationToken)
    {
        var cfg = _scoring.Analyst;
        var label = essentialsOnly ? "normalize-profile-essentials" : "normalize-profile";

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage>
            {
                new(essentialsOnly
                    ? PromptSeeds.NormalizeProfile + PromptSeeds.NormalizeProfileEssentials
                    : PromptSeeds.NormalizeProfile),
            },
            Messages = new List<Message> { userMessage },
            MaxTokens = essentialsOnly ? 1536 : 4096,
            Model = cfg.Model,
            Temperature = cfg.Temperature,
            Stream = false
        };

        var clock = System.Diagnostics.Stopwatch.StartNew();
        var response = await ResolveClient().Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        // The CV read had no usage line at all, so neither its cost nor its
        // latency -- the whole wait after an upload -- was visible anywhere.
        _logger.LogInformation(
            "Claude {Label} usage — input={Input} output={Output} ms={Ms}",
            label, response.Usage?.InputTokens, response.Usage?.OutputTokens, clock.ElapsedMilliseconds);
        ThrowIfTruncated(response, label, 1);

        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        var json = ExtractJson(content, label);
        var result = JsonSerializer.Deserialize<NormalizedProfile>(json, CaseInsensitive)
            ?? throw new InvalidOperationException("Failed to deserialize NormalizedProfile");

        // The same closed list the postings are tagged from, and the same cap
        // the prompt states -- checked here, since the prompt alone is not.
        result = result with { Functions = JobFunctions.Normalize(result.Functions, JobFunctions.MaxPerProfile) };

        // The addendum asks for the essentials only; this makes it so. The
        // client merges this read into the profile field by field, and a field
        // present here but empty would read as "the CV says nothing" and wipe
        // what the profile had -- so everything outside the essentials is
        // cleared, never passed through half-filled.
        if (essentialsOnly) result = NormalizedProfileEssentials.Keep(result);

        _logger.LogInformation("Normalized profile: {Roles} role(s)", result.Experience.Length);
        return result;
    }

    // ── Mock interview ──────────────────────────────────────────────────────

    public async Task<MockTurnResult> GenerateMockInterviewTurnAsync(
        Guid userId, MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Mock interview turn — persona={Persona}, lang={Lang}, turns={Turns}, bound={Bound}",
            context.Persona, context.Language, transcript.Count, context.Application != null);

        var systemPrompt = await BuildMockSystemPromptAsync(userId, PromptSeeds.MockInterviewTurn, context, cancellationToken);
        var userMessage = BuildMockUserMessage(context, transcript);

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage> { new(systemPrompt) },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = 1024,
            // Per-turn questions are high-frequency, low-difficulty — Haiku keeps
            // the back-and-forth fast and cheap. The debrief below also moved to
            // Haiku on 2026-08-11 (was Sonnet), so both mock-interview calls now
            // share a model.
            // (Prompt caching was evaluated but doesn't engage for Haiku at this
            // prompt size — Sonnet caches the same prompt, Haiku doesn't — so the
            // turns run uncached.)
            Model = "claude-haiku-4-5-20251001",
            Temperature = 0.5m,
            Stream = false
        };

        var response = await ResolveClient().Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        var json = ExtractJson(content, "mock-interview-turn");
        var result = JsonSerializer.Deserialize<MockTurnResult>(json, CaseInsensitive)
            ?? throw new InvalidOperationException("Failed to deserialize MockTurnResult");
        return result;
    }

    public async Task<MockInterviewDebrief> GenerateMockInterviewDebriefAsync(
        Guid userId, MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Mock interview debrief — persona={Persona}, turns={Turns}", context.Persona, transcript.Count);

        var systemPrompt = await BuildMockSystemPromptAsync(userId, PromptSeeds.MockInterviewDebrief, context, cancellationToken);
        var userMessage = BuildMockUserMessage(context, transcript);

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage> { new(systemPrompt) },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = 2048,
            Model = "claude-haiku-4-5-20251001",
            Temperature = 0.4m,
            Stream = false
        };

        var response = await ResolveClient().Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        var json = ExtractJson(content, "mock-interview-debrief");
        var result = JsonSerializer.Deserialize<MockInterviewDebrief>(json, CaseInsensitive)
            ?? throw new InvalidOperationException("Failed to deserialize MockInterviewDebrief");
        return result;
    }

    // One-shot batch synthesis over the user's real-interview retros. Uses
    // CallClaudeAsync (streaming + JSON-repair retry) rather than the direct
    // non-streaming style above — this is a user-triggered "regenerate"
    // button, so the retry safety net is worth it. Always reads the full raw
    // retro text (never the previous summary) — see the interface doc comment.
    public async Task<InterviewInsightsSynthesis> GenerateInterviewInsightAsync(
        IReadOnlyList<Interview> retros, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Generating interview insight over {Count} retros", retros.Count);

        var userMessage = BuildInterviewInsightsUserMessage(retros);
        // Hardcoded false, not a config lookup — InterviewInsights isn't one
        // of the two agents PromptOptions.HebrewOutput can vary.
        var (result, _) = await CallClaudeAsync<InterviewInsightsSynthesis>(
            ResolveOutputLanguage(PromptSeeds.InterviewInsights, false), userMessage, _scoring.InterviewInsights, "interview-insights", cancellationToken);

        return result;
    }

    // Untrusted data: each retro's self-rating + free text the user wrote
    // about themselves, XML-wrapped per house convention (own text is still
    // data, not instructions — same treatment mock-interview <candidate>
    // answers get).
    private static string BuildInterviewInsightsUserMessage(IReadOnlyList<Interview> retros)
    {
        var sb = new System.Text.StringBuilder("<retros>\n");
        foreach (var r in retros)
        {
            sb.Append("<retro id=\"").Append(r.Id).Append("\" rating=\"").Append(r.RetroRating).Append("\">\n");
            sb.Append("<went_well>").Append(r.RetroWentWell?.Trim() ?? "").Append("</went_well>\n");
            sb.Append("<to_improve>").Append(r.RetroToImprove?.Trim() ?? "").Append("</to_improve>\n");
            sb.Append("<categories>").Append(string.Join(",", r.RetroCategories)).Append("</categories>\n");
            sb.Append("</retro>\n");
        }
        sb.Append("</retros>");
        return sb.ToString();
    }

    public async Task<ResumePackSynthesis> GenerateResumePackAsync(
        Application app, string profile, StructuredProfile structuredProfile,
        CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Generating resume pack for: {Company} / {Title}", app.Company, app.JobTitle);

        // System prompt: trusted instructions + the candidate's own (trusted)
        // profile, same pattern as GenerateWhyWorkHereAsync. The target job
        // goes in the user message, XML-wrapped as untrusted data.
        var systemBuilder = new System.Text.StringBuilder(PromptSeeds.ResumePack);
        if (!string.IsNullOrWhiteSpace(profile))
            systemBuilder.Append("\n\n# CANDIDATE PROFILE\n").Append(profile.Trim());

        // Figures the résumé may state that aren't written down anywhere in the
        // profile text — currently only years of experience, computed from the
        // earliest employment start. The validator accepts these as a legal
        // source alongside the profile text, so the model has to be told them or
        // it has no grounded way to say "N years" at all. See ProfileFacts.
        var facts = ProfileFacts.From(structuredProfile, DateOnly.FromDateTime(DateTime.UtcNow));
        var factsBlock = facts.ToPromptBlock();
        if (factsBlock.Length > 0)
            systemBuilder.Append("\n\n# DERIVED FACTS\n").Append(factsBlock);

        var userBuilder = new System.Text.StringBuilder();
        userBuilder.Append("<company>").Append(app.Company).Append("</company>\n");
        userBuilder.Append("<job_title>").Append(app.JobTitle).Append("</job_title>\n");
        if (!string.IsNullOrWhiteSpace(app.JobDescription))
            userBuilder.Append("<job_description>").Append(app.JobDescription).Append("</job_description>\n");
        // The Evaluator already scored this posting against this profile at ingest,
        // and its verdict sits on the application — strengths, gaps, per-dimension
        // breakdown. Without it the pack re-derives the same reading from the raw
        // posting and can contradict the match score shown beside it. It is our own
        // model's opinion, not a source of facts: the prompt treats it as a steer
        // for emphasis only.
        if (!string.IsNullOrWhiteSpace(app.MatchAnalysis))
            userBuilder.Append("<match_analysis>").Append(app.MatchAnalysis).Append("</match_analysis>\n");

        var (result, _) = await CallClaudeAsync<ResumePackSynthesis>(
            systemBuilder.ToString(), userBuilder.ToString(), _scoring.ResumePack, "resume-pack", cancellationToken);

        // Provenance isn't persisted with the pack — logged here so a
        // fabrication complaint can be traced back to what the model claimed
        // its source was, without carrying that audit trail into the DB/PDF.
        _logger.LogInformation(
            "Resume pack generated for {Company}: {ExperienceCount} experience entries, {SkillCategories} skill categories, {ProvenanceRows} provenance rows",
            app.Company, result.Experience.Count, result.HighlightedSkills.Count, result.Provenance.Count);

        return result;
    }

    // Trusted context: base instruction + persona/language directives + the
    // user's own profile, the persona-matched self-presentation, project
    // pitches, and the prepared-question skeleton. All trusted (system prompt).
    private async Task<string> BuildMockSystemPromptAsync(Guid userId, string seed, MockInterviewContext context, CancellationToken ct)
    {
        var profile = await _profileProvider.GetProfileAsync(userId, ct);
        var prep = await _profileProvider.GetInterviewPrepAsync(userId, ct);

        var sb = new System.Text.StringBuilder(seed);

        var personaLine = context.Persona == "technical"
            ? "You are acting as a technical interviewer. Focus on technical depth, engineering decisions, problem-solving, systems, and hands-on experience."
            : "You are acting as an HR / recruiter interviewer. Focus on motivation, cultural fit, values, expectations, and interpersonal communication.";
        sb.Append("\n\n# Interviewer type\n").Append(personaLine);

        if (context.Language == "en")
            sb.Append("\n\n# Interview language\nConduct the interview dialogue — questions and nudge — in English.");
        else
            sb.Append("\n\n# Interview language\nConduct the interview dialogue in Hebrew. Technical terms stay in English.");

        if (seed == PromptSeeds.MockInterviewTurn)
            sb.Append("\n\n# Planned number of questions\nAbout ").Append(context.QuestionTarget)
              .Append(" questions (including follow-ups). Wrap up around this number.");

        if (!string.IsNullOrWhiteSpace(profile))
            sb.Append("\n\n# Candidate Profile\n").Append(profile.Trim());

        var presentation = context.Persona == "technical" ? prep.SelfPresentationTechnical : prep.SelfPresentationHr;
        if (!string.IsNullOrWhiteSpace(presentation))
            sb.Append("\n\n# Self-Presentation\n").Append(presentation.Trim());
        if (!string.IsNullOrWhiteSpace(prep.PresentingWorkProject))
            sb.Append("\n\n# Work Project Pitch\n").Append(prep.PresentingWorkProject.Trim());
        if (!string.IsNullOrWhiteSpace(prep.PresentingPersonalProject))
            sb.Append("\n\n# Personal Project Pitch\n").Append(prep.PresentingPersonalProject.Trim());

        var questions = prep.QaRubric
            .Select(q => q.Question?.Trim() ?? "")
            .Where(q => q.Length > 0)
            .ToList();
        if (questions.Count > 0)
            sb.Append("\n\n# Question outline the user prepared\n")
              .Append(string.Join("\n", questions.Select(q => "- " + q)));

        return sb.ToString();
    }

    // Untrusted data: the job/company context (when bound) followed by the
    // transcript so far. Candidate answers and job text are XML-wrapped so the
    // model treats them as data, not instructions.
    private static string BuildMockUserMessage(MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript)
    {
        var sb = new System.Text.StringBuilder();

        var app = context.Application;
        if (app != null)
        {
            sb.Append("<job_context>\n");
            sb.Append("<company>").Append(app.Company).Append("</company>\n");
            sb.Append("<job_title>").Append(app.JobTitle).Append("</job_title>\n");
            if (!string.IsNullOrWhiteSpace(app.JobDescription))
                sb.Append("<job_description>").Append(app.JobDescription).Append("</job_description>\n");
            if (!string.IsNullOrWhiteSpace(app.CompanySummary))
                sb.Append("<company_summary>").Append(app.CompanySummary).Append("</company_summary>\n");
            if (!string.IsNullOrWhiteSpace(app.CompanyNews))
                sb.Append("<company_news>").Append(app.CompanyNews).Append("</company_news>\n");
            if (!string.IsNullOrWhiteSpace(app.GlassdoorData))
                sb.Append("<glassdoor>").Append(app.GlassdoorData).Append("</glassdoor>\n");
            sb.Append("</job_context>\n\n");
        }

        if (transcript.Count == 0)
        {
            sb.Append("<transcript></transcript>");
        }
        else
        {
            sb.Append("<transcript>\n");
            foreach (var turn in transcript)
            {
                var tag = turn.Role == "candidate" ? "candidate" : "interviewer";
                sb.Append('<').Append(tag).Append('>')
                  .Append(turn.Text?.Trim() ?? "")
                  .Append("</").Append(tag).Append(">\n");
            }
            sb.Append("</transcript>");
        }

        return sb.ToString();
    }

    // Shared request builder for both the live (stream:true) and batch (stream:false)
    // evaluator paths, so caching / thinking / max_tokens are constructed identically.
    private static MessageParameters BuildParameters(string systemPrompt, string userMessage, RoleScoringConfig cfg, bool stream)
    {
        var p = new MessageParameters
        {
            System = new List<SystemMessage>
            {
                // Extended TTL: this is a single-user tool with searches spaced
                // minutes-to-hours apart, well past the default 5-minute cache
                // window — every call was writing a fresh cache entry that
                // expired before the next one could read it (confirmed via the
                // Anthropic console: 0 cache reads despite caching being on).
                // The 1-hour TTL costs a slightly pricier write but actually
                // survives the gap between real single-user calls.
                new(systemPrompt, new CacheControl { Type = CacheControlType.ephemeral, TTL = CacheDuration.OneHour }),
            },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = cfg.MaxTokens,
            Model = cfg.Model,
            Stream = stream,
            Temperature = cfg.Temperature,
            // Static system prompt (evaluator instructions + injected profile) is
            // identical across a run — cache it so reads cost ~0.1x of input.
            PromptCaching = PromptCacheType.FineGrained,
        };
        // The claude-*-5 models take neither of the knobs below. Thinking is
        // controlled for them by AnthropicThinkingHandler, which stamps
        // adaptive/effort onto the outgoing request — the SDK's ThinkingParameters
        // can only emit {"type":"enabled"}, which these models reject with 400
        // "thinking.type.enabled is not supported for this model". So
        // ThinkingEnabled/ThinkingBudget are inert here rather than a 400.
        var isNext5 = cfg.Model is "claude-opus-5" or "claude-sonnet-5";
        if (!isNext5 && cfg.ThinkingEnabled && cfg.ThinkingBudget > 0 && cfg.MaxTokens > cfg.ThinkingBudget)
        {
            p.Thinking = new ThinkingParameters { BudgetTokens = cfg.ThinkingBudget };
            p.Temperature = 1m;
        }
        // Those models also reject an explicit temperature param outright
        // (400 "temperature is deprecated for this model") — omit it for those, let
        // the API use its own default.
        if (isNext5)
        {
            p.Temperature = null;
        }
        return p;
    }

    private async Task<(T Result, ClaudeCallSnapshot Snapshot)> CallClaudeAsync<T>(
        string systemPrompt, string userMessage, RoleScoringConfig cfg, string label,
        CancellationToken cancellationToken) where T : class
    {
        _logger.LogInformation("=== Claude {Label} request === Model: {Model} | MaxTokens: {MaxTokens} | Temp: {Temp} | Thinking: {Thinking}",
            label, cfg.Model, cfg.MaxTokens, cfg.Temperature, cfg.ThinkingEnabled);
        _logger.LogDebug("=== Full system prompt ===\n{Prompt}\n=== End system prompt ===", systemPrompt);

        // Live path streams so long, high-max_tokens generations keep the
        // connection alive (a non-streaming idle wait gets the socket dropped —
        // SocketException 10054 on big jobs). Batch requests are built with
        // stream:false via the same helper.
        var parameters = BuildParameters(systemPrompt, userMessage, cfg, stream: true);

        var inputJson = SerializeCallInput(parameters, userMessage);

        string content = "";
        for (var attempt = 0; attempt < 2; attempt++)
        {
            // Consume the SSE stream: concatenate text deltas (thinking deltas
            // are ignored — they aren't part of the JSON we parse) and capture
            // usage/stop_reason from whichever chunks carry them.
            var sb = new System.Text.StringBuilder();
            int? inTok = null, outTok = null, cacheW = null, cacheR = null;
            string? stopReason = null;
            await foreach (var chunk in ResolveClient().Messages.StreamClaudeMessageAsync(parameters, cancellationToken))
            {
                if (chunk.Delta?.Text is { Length: > 0 } deltaText)
                    sb.Append(deltaText);
                var u = chunk.Usage;
                if (u != null)
                {
                    if (u.InputTokens > 0) inTok = u.InputTokens;
                    if (u.OutputTokens > 0) outTok = u.OutputTokens;
                    if (u.CacheCreationInputTokens is > 0) cacheW = u.CacheCreationInputTokens;
                    if (u.CacheReadInputTokens is > 0) cacheR = u.CacheReadInputTokens;
                }
                // In streaming, stop_reason rides on the final message-delta
                // (chunk.Delta.StopReason), not the top-level chunk.
                var chunkStop = chunk.StopReason ?? chunk.Delta?.StopReason;
                if (!string.IsNullOrEmpty(chunkStop)) stopReason = chunkStop;
            }

            content = sb.ToString();
            if (content.Length == 0)
                throw new InvalidOperationException("Empty response from Claude API");

            _logger.LogInformation(
                "Claude {Label} usage — input={Input} output={Output} cacheWrite={CacheWrite} cacheRead={CacheRead} stop={StopReason}",
                label, inTok, outTok, cacheW, cacheR, stopReason);
            _logger.LogDebug("Received {Label} response from Claude. Length: {Length} chars", label, content.Length);

            // Truncation is terminal, and retrying it is strictly worse than
            // failing. A max_tokens stop means the JSON was cut off mid-structure;
            // the repair-retry below then asks for the same output under the same
            // budget, so it dies at the same place — after paying to re-send the
            // truncated attempt as an assistant turn. Measured on a real 4-job
            // parse-batch: attempt 1 input=6616/output=4096 stop=max_tokens,
            // attempt 2 input=10734/output=4096 stop=max_tokens, then a
            // "failed to return valid JSON after retry" that named the wrong
            // cause. Raise the role's MaxTokens instead; nothing else can help.
            if (string.Equals(stopReason, "max_tokens", StringComparison.OrdinalIgnoreCase))
            {
                throw new ClaudeJsonException(
                    $"Claude {label} hit max_tokens ({cfg.MaxTokens}) and was truncated mid-JSON \u2014 "
                    + "raise MaxTokens for this role; retrying cannot succeed at the same budget.",
                    content, inputJson);
            }

            try
            {
                var jsonContent = ExtractJson(content, label);
                var result = JsonSerializer.Deserialize<T>(jsonContent, CaseInsensitive)
                    ?? throw new InvalidOperationException($"Failed to deserialize {typeof(T).Name}");
                return (result, new ClaudeCallSnapshot(inputJson, content));
            }
            // Broadened from JsonException alone: a duplicate top-level key used
            // to throw ArgumentException from deep inside JsonObject's lazy
            // dictionary build (see ExtractJson/BuildNode), which this catch
            // never matched — the whole call died uncaught, no retry, no
            // preserved output. Any parse/deserialize-stage failure now gets the
            // same one repair-retry, and the raw content is always logged before
            // we decide whether to retry or give up (cancellation excluded —
            // that's the caller aborting, not a bad model response).
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                var preview = content.Length > 2000 ? content[..2000] + "...[truncated]" : content;
                _logger.LogWarning(ex,
                    "Claude {Label} parse-stage failure (attempt {Attempt}/2): {Content}",
                    label, attempt + 1, preview);

                if (attempt == 0)
                {
                    parameters.Messages = new List<Message>
                    {
                        new(RoleType.User, userMessage),
                        new(RoleType.Assistant, content),
                        new(RoleType.User, "Your response was not valid JSON. Return ONLY the JSON object, no commentary.")
                    };
                }
            }
        }

        throw new ClaudeJsonException(
            $"Claude {label} failed to return valid JSON after retry", content, inputJson);
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

    private string ExtractJson(string? content, string label)
    {
        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidOperationException("Empty content from Claude API");

        var json = content.Trim();

        var fenceStart = json.IndexOf("```", StringComparison.Ordinal);
        if (fenceStart >= 0)
        {
            var afterFence = fenceStart + 3;
            var lineEnd = json.IndexOf('\n', afterFence);
            if (lineEnd >= 0)
                afterFence = lineEnd + 1;
            var fenceEnd = json.IndexOf("```", afterFence, StringComparison.Ordinal);
            if (fenceEnd >= 0)
                json = json.Substring(afterFence, fenceEnd - afterFence).Trim();
            else
                json = json.Substring(afterFence).Trim();
        }

        var firstBrace = json.IndexOf('{');
        var lastBrace = json.LastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace)
            json = json.Substring(firstBrace, lastBrace - firstBrace + 1);

        JsonNode? node;
        try
        {
            node = ParseTolerant(json, label);
        }
        catch (JsonException)
        {
            var lines = json.Split('\n')
                .Select(l => l.TrimEnd())
                .Where(l => !string.IsNullOrWhiteSpace(l))
                .Where(l => !l.TrimStart().StartsWith("//"))
                .ToList();
            var repaired = string.Join('\n', lines);

            firstBrace = repaired.IndexOf('{');
            lastBrace = repaired.LastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace)
                repaired = repaired.Substring(firstBrace, lastBrace - firstBrace + 1);

            node = ParseTolerant(repaired, label);
        }

        if (node != null)
            json = node.ToJsonString();

        return json;
    }

    // Parses via JsonDocument (which tolerates duplicate object keys — its
    // EnumerateObject() yields every occurrence, no exception) and rebuilds
    // the tree into fresh JsonNodes, instead of JsonNode.Parse followed by a
    // post-hoc key-normalization pass. JsonNode.Parse itself never throws on
    // a duplicate key either, but JsonObject's backing dictionary is built
    // lazily the moment anything enumerates/indexes it — a plain post-parse
    // walk (the old NormalizeKeys, via obj.ToList()) forced that build and
    // threw ArgumentException the moment the model restated a key (observed:
    // `hardBlockers` emitted twice in one response). Building fresh JsonObjects
    // here sidesteps that entirely — the indexer set is overwrite-or-add, never
    // Add-only — and folds snake_case normalization + duplicate-key handling
    // into the same pass.
    private JsonNode? ParseTolerant(string json, string label)
    {
        using var doc = JsonDocument.Parse(json);
        return BuildNode(doc.RootElement, label);
    }

    private JsonNode? BuildNode(JsonElement element, string label)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                var obj = new JsonObject();
                foreach (var prop in element.EnumerateObject())
                {
                    var camelKey = SnakeToCamel(prop.Name);
                    var value = BuildNode(prop.Value, label);
                    if (obj.ContainsKey(camelKey))
                    {
                        // Last occurrence wins — models typically restate a
                        // field to correct themselves, so the later value is
                        // the intended one. Catches both a literal duplicate
                        // key and a snake_case/camelCase collision (e.g.
                        // `hard_blockers` + `hardBlockers`), which previously
                        // overwrote silently with no trace at all.
                        _logger.LogWarning(
                            "Duplicate JSON key from model: key={Key} label={Label} — kept last occurrence",
                            camelKey, label);
                    }
                    obj[camelKey] = value;
                }
                return obj;
            case JsonValueKind.Array:
                var arr = new JsonArray();
                foreach (var item in element.EnumerateArray())
                    arr.Add(BuildNode(item, label));
                return arr;
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                return null;
            default:
                return JsonNode.Parse(element.GetRawText());
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
