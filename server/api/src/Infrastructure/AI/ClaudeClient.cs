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
    private readonly PromptBuilder _promptBuilder;
    private readonly IProfileProvider _profileProvider;
    private readonly PromptOptions _prompts;
    private readonly ScoringConfig _scoring;
    private readonly ILogger<ClaudeClient> _logger;

    public ClaudeClient(
        IConfiguration configuration,
        IHttpClientFactory httpClientFactory,
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

        var httpClient = httpClientFactory.CreateClient("anthropic");
        _client = new AnthropicClient(apiKey, httpClient);
        _promptBuilder = promptBuilder;
        _profileProvider = profileProvider;
        _prompts = prompts;
        _scoring = scoring;
        _logger = logger;
    }

    // Configured prompts, blank-guarded back to the bundled seed so an empty
    // override env var can never silently ship an empty system prompt.
    private string AnalystPrompt =>
        string.IsNullOrWhiteSpace(_prompts.Analyzer) ? PromptSeeds.Analyst : _prompts.Analyzer;
    private string EvaluatorPrompt =>
        string.IsNullOrWhiteSpace(_prompts.Evaluator) ? PromptSeeds.Evaluator : _prompts.Evaluator;

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

    public Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CancellationToken cancellationToken = default)
        => EvaluateMatchAsync(profile, parsedJob, EvaluatorPrompt, _scoring.Evaluator, companyNews, glassdoorData, cancellationToken);

    public async Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, string evaluatorPrompt, RoleScoringConfig evaluatorConfig, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Evaluating job match: {Title} at {Company}", parsedJob.JobTitle, parsedJob.Company);

        var (systemPrompt, userMessage) = _promptBuilder.BuildEvaluationPrompt(profile, parsedJob, evaluatorPrompt, companyNews, glassdoorData);

        var (result, snapshot) = await CallClaudeAsync<MatchResponse>(systemPrompt, userMessage, evaluatorConfig, "evaluate", cancellationToken);
        _logger.LogInformation("Match evaluation completed. Verdict: {Verdict}, Score: {Score}",
            result.Verdict, result.OverallScore);
        return (result, snapshot);
    }

    public async Task<EmailParseResult?> ParseEmailAsync(
        string subject, string from, string body, List<string> knownCompanies,
        CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Parsing email: {Subject}", subject);

        var companiesList = string.Join(", ", knownCompanies);
        var systemPrompt = string.Format(PromptSeeds.EmailParser, companiesList);
        var userMessage = $"<email>\n<subject>{subject}</subject>\n<from>{from}</from>\n<body>{body}</body>\n</email>";

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage> { new(systemPrompt) },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = 512,
            Model = "claude-sonnet-4-6",
            Temperature = 0.3m,
            Stream = false
        };

        var response = await _client.Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim();

        if (string.IsNullOrWhiteSpace(content) || content.Equals("null", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogInformation("Email not relevant: {Subject}", subject);
            return null;
        }

        var jsonContent = ExtractJson(content);
        var result = JsonSerializer.Deserialize<EmailParseResult>(jsonContent, CaseInsensitive);
        _logger.LogInformation("Parsed email from {Company}: {Type}", result?.Company, result?.UpdateType);
        return result;
    }

    public async Task<string> SummarizeCompanyAsync(string companyName, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Generating company summary for: {Company}", companyName);

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage> { new(PromptSeeds.CompanySummary) },
            Messages = new List<Message> { new(RoleType.User, companyName) },
            MaxTokens = 512,
            Model = "claude-sonnet-4-6",
            Temperature = 0.3m,
            Stream = false
        };

        var response = await _client.Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        _logger.LogInformation("Company summary generated for: {Company}", companyName);
        return content;
    }

    public async Task<string> GenerateWhyWorkHereAsync(Application app, string profile, InterviewPrepDocument prep, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Generating 'why work here' answer for: {Company} / {Title}", app.Company, app.JobTitle);

        // System prompt: trusted instructions + the user's own (trusted) profile
        // and self-presentation. External company/job data goes in the user
        // message wrapped in XML tags (treated as untrusted data).
        var systemBuilder = new System.Text.StringBuilder(PromptSeeds.WhyWorkHere);
        if (!string.IsNullOrWhiteSpace(profile))
            systemBuilder.Append("\n\n# פרופיל המועמד\n").Append(profile.Trim());
        if (!string.IsNullOrWhiteSpace(prep.SelfPresentationHr))
            systemBuilder.Append("\n\n# הצגה עצמית (HR)\n").Append(prep.SelfPresentationHr.Trim());
        if (!string.IsNullOrWhiteSpace(prep.SelfPresentationTechnical))
            systemBuilder.Append("\n\n# הצגה עצמית (טכנית)\n").Append(prep.SelfPresentationTechnical.Trim());

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
            Model = "claude-sonnet-4-6",
            Temperature = 0.6m,
            Stream = false
        };

        var response = await _client.Messages.GetClaudeMessageAsync(parameters, cancellationToken);
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
            System = new List<SystemMessage> { new(PromptSeeds.PresentationCues) },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = 1024,
            Model = "claude-sonnet-4-6",
            Temperature = 0.2m,
            Stream = false
        };

        var response = await _client.Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        var json = ExtractJson(content);
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

    // ── Mock interview ──────────────────────────────────────────────────────

    public async Task<MockTurnResult> GenerateMockInterviewTurnAsync(
        MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Mock interview turn — persona={Persona}, lang={Lang}, turns={Turns}, bound={Bound}",
            context.Persona, context.Language, transcript.Count, context.Application != null);

        var systemPrompt = await BuildMockSystemPromptAsync(PromptSeeds.MockInterviewTurn, context, cancellationToken);
        var userMessage = BuildMockUserMessage(context, transcript);

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage> { new(systemPrompt) },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = 1024,
            // Per-turn questions are high-frequency, low-difficulty — Haiku keeps
            // the back-and-forth fast and cheap; the debrief uses Sonnet.
            Model = "claude-haiku-4-5-20251001",
            Temperature = 0.5m,
            Stream = false
        };

        var response = await _client.Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        var json = ExtractJson(content);
        var result = JsonSerializer.Deserialize<MockTurnResult>(json, CaseInsensitive)
            ?? throw new InvalidOperationException("Failed to deserialize MockTurnResult");
        return result;
    }

    public async Task<MockInterviewDebrief> GenerateMockInterviewDebriefAsync(
        MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Mock interview debrief — persona={Persona}, turns={Turns}", context.Persona, transcript.Count);

        var systemPrompt = await BuildMockSystemPromptAsync(PromptSeeds.MockInterviewDebrief, context, cancellationToken);
        var userMessage = BuildMockUserMessage(context, transcript);

        var parameters = new MessageParameters
        {
            System = new List<SystemMessage> { new(systemPrompt) },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = 2048,
            Model = "claude-sonnet-4-6",
            Temperature = 0.4m,
            Stream = false
        };

        var response = await _client.Messages.GetClaudeMessageAsync(parameters, cancellationToken);
        var content = response.Message?.ToString()?.Trim()
            ?? throw new InvalidOperationException("Empty response from Claude API");

        var json = ExtractJson(content);
        var result = JsonSerializer.Deserialize<MockInterviewDebrief>(json, CaseInsensitive)
            ?? throw new InvalidOperationException("Failed to deserialize MockInterviewDebrief");
        return result;
    }

    // Trusted context: base instruction + persona/language directives + the
    // user's own profile, the persona-matched self-presentation, project
    // pitches, and the prepared-question skeleton. All trusted (system prompt).
    private async Task<string> BuildMockSystemPromptAsync(string seed, MockInterviewContext context, CancellationToken ct)
    {
        var profile = await _profileProvider.GetProfileAsync(ct);
        var prep = await _profileProvider.GetInterviewPrepAsync(ct);

        var sb = new System.Text.StringBuilder(seed);

        var personaLine = context.Persona == "technical"
            ? "אתה בתפקיד מראיין/ת טכני/ת. התמקד בעומק טכני, החלטות הנדסיות, פתרון בעיות, מערכות וניסיון מעשי."
            : "אתה בתפקיד מראיין/ת HR / מגייס/ת. התמקד במוטיבציה, התאמה תרבותית, ערכים, ציפיות ותקשורת בין-אישית.";
        sb.Append("\n\n# סוג המראיין\n").Append(personaLine);

        if (context.Language == "en")
            sb.Append("\n\n# שפת הראיון\nנהל את שיח הראיון — השאלות וה-nudge — באנגלית.");
        else
            sb.Append("\n\n# שפת הראיון\nנהל את שיח הראיון בעברית. מונחים טכניים נשארים באנגלית.");

        if (seed == PromptSeeds.MockInterviewTurn)
            sb.Append("\n\n# מספר שאלות מתוכנן\nכ-").Append(context.QuestionTarget)
              .Append(" שאלות (כולל שאלות המשך). סיים סביב מספר זה.");

        if (!string.IsNullOrWhiteSpace(profile))
            sb.Append("\n\n# פרופיל המועמד\n").Append(profile.Trim());

        var presentation = context.Persona == "technical" ? prep.SelfPresentationTechnical : prep.SelfPresentationHr;
        if (!string.IsNullOrWhiteSpace(presentation))
            sb.Append("\n\n# הצגה עצמית\n").Append(presentation.Trim());
        if (!string.IsNullOrWhiteSpace(prep.PresentingWorkProject))
            sb.Append("\n\n# הצגת פרויקט מהעבודה\n").Append(prep.PresentingWorkProject.Trim());
        if (!string.IsNullOrWhiteSpace(prep.PresentingPersonalProject))
            sb.Append("\n\n# הצגת פרויקט אישי\n").Append(prep.PresentingPersonalProject.Trim());

        var questions = prep.QaRubric
            .Select(q => q.Question?.Trim() ?? "")
            .Where(q => q.Length > 0)
            .ToList();
        if (questions.Count > 0)
            sb.Append("\n\n# שלד שאלות שהמשתמש הכין\n")
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
            System = new List<SystemMessage> { new(systemPrompt) },
            Messages = new List<Message> { new(RoleType.User, userMessage) },
            MaxTokens = cfg.MaxTokens,
            Model = cfg.Model,
            Stream = stream,
            Temperature = cfg.Temperature,
            // Static system prompt (evaluator instructions + injected profile) is
            // identical across a run — cache it so reads cost ~0.1x of input.
            PromptCaching = PromptCacheType.AutomaticToolsAndSystem,
        };
        if (cfg.ThinkingEnabled && cfg.ThinkingBudget > 0 && cfg.MaxTokens > cfg.ThinkingBudget)
        {
            p.Thinking = new ThinkingParameters { BudgetTokens = cfg.ThinkingBudget };
            p.Temperature = 1m;
        }
        return p;
    }

    public async Task<string> SubmitEvaluationBatchAsync(IReadOnlyList<EvaluationBatchItem> items, CancellationToken cancellationToken = default)
    {
        var profile = await _profileProvider.GetProfileAsync(cancellationToken);
        var evaluatorPrompt = EvaluatorPrompt;
        var cfg = _scoring.Evaluator;

        var requests = new List<BatchRequest>(items.Count);
        foreach (var item in items)
        {
            var (system, user) = _promptBuilder.BuildEvaluationPrompt(
                profile, item.ParsedJob, evaluatorPrompt, item.CompanyNews, item.GlassdoorData);
            // Batch results are not streamed — build with stream:false.
            var parameters = BuildParameters(system, user, cfg, stream: false);
            requests.Add(new BatchRequest { CustomId = item.CustomId, MessageParameters = parameters });
        }

        var resp = await _client.Batches.CreateBatchAsync(requests, cancellationToken);
        _logger.LogInformation("Submitted evaluation batch {BatchId} ({Count} requests)", resp.Id, requests.Count);
        return resp.Id;
    }

    public async Task<EvaluationBatchResult> GetEvaluationBatchAsync(string batchId, CancellationToken cancellationToken = default)
    {
        var status = await _client.Batches.RetrieveBatchStatusAsync(batchId, cancellationToken);
        var processing = Convert.ToString(status.ProcessingStatus) ?? "";
        if (!string.Equals(processing, "ended", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogInformation("Batch {BatchId} not ready — status={Status}", batchId, processing);
            return new EvaluationBatchResult { Status = processing };
        }

        var lines = new List<EvaluationBatchLine>();
        await foreach (var raw in _client.Batches.RetrieveBatchResultsJsonlAsync(batchId, cancellationToken))
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            lines.Add(ParseBatchLine(raw));
        }
        var ok = lines.Count(l => l.Response != null);
        _logger.LogInformation("Batch {BatchId} ended: {Ok}/{Total} parsed ok", batchId, ok, lines.Count);
        return new EvaluationBatchResult { Status = processing, Lines = lines };
    }

    // Parses one line of the documented batch-results JSONL:
    //   {"custom_id":"...","result":{"type":"succeeded","message":{"content":[{"type":"text","text":"..."}]}}}
    //   {"custom_id":"...","result":{"type":"errored"|"expired"|"canceled","error":{...}}}
    private EvaluationBatchLine ParseBatchLine(string raw)
    {
        string customId = "";
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            customId = root.GetProperty("custom_id").GetString() ?? "";
            var result = root.GetProperty("result");
            var type = result.TryGetProperty("type", out var t) ? t.GetString() : null;

            if (type == "succeeded" && result.TryGetProperty("message", out var msg)
                && msg.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
            {
                var sb = new System.Text.StringBuilder();
                foreach (var block in content.EnumerateArray())
                    if (block.TryGetProperty("type", out var bt) && bt.GetString() == "text"
                        && block.TryGetProperty("text", out var txt))
                        sb.Append(txt.GetString());
                var rawText = sb.ToString();
                try
                {
                    var json = ExtractJson(rawText);
                    var mr = JsonSerializer.Deserialize<MatchResponse>(json, CaseInsensitive)
                        ?? throw new InvalidOperationException("null MatchResponse");
                    return new EvaluationBatchLine { CustomId = customId, Response = mr, RawOutput = rawText };
                }
                catch (Exception ex)
                {
                    return new EvaluationBatchLine { CustomId = customId, RawOutput = rawText, Error = "parse: " + ex.Message };
                }
            }

            var err = type ?? "unknown";
            if (result.TryGetProperty("error", out var e)) err = e.ToString();
            return new EvaluationBatchLine { CustomId = customId, Error = err };
        }
        catch (Exception ex)
        {
            return new EvaluationBatchLine { CustomId = customId, Error = "line: " + ex.Message };
        }
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
            await foreach (var chunk in _client.Messages.StreamClaudeMessageAsync(parameters, cancellationToken))
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

            try
            {
                var jsonContent = ExtractJson(content);
                var result = JsonSerializer.Deserialize<T>(jsonContent, CaseInsensitive)
                    ?? throw new InvalidOperationException($"Failed to deserialize {typeof(T).Name}");
                return (result, new ClaudeCallSnapshot(inputJson, content));
            }
            catch (JsonException ex) when (attempt == 0)
            {
                _logger.LogWarning("Claude {Label} returned non-JSON, retrying: {Error}", label, ex.Message);
                parameters.Messages = new List<Message>
                {
                    new(RoleType.User, userMessage),
                    new(RoleType.Assistant, content),
                    new(RoleType.User, "Your response was not valid JSON. Return ONLY the JSON object, no commentary.")
                };
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

    private static string ExtractJson(string? content)
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
            node = JsonNode.Parse(json);
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

            node = JsonNode.Parse(repaired);
        }

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
