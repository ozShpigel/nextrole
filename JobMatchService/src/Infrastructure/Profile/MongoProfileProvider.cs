using JobMatchService.Core.Profile;
using JobMatchService.Infrastructure.AI;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;

namespace JobMatchService.Infrastructure.Profile;

public sealed class MongoProfileProvider : IProfileProvider
{
    private const string DocId = "default";
    private const string CollectionName = "profile";

    private readonly IMongoCollection<BsonDocument> _collection;
    private readonly IConfiguration _configuration;
    private readonly ILogger<MongoProfileProvider> _logger;

    public MongoProfileProvider(
        IMongoClient mongoClient,
        IConfiguration configuration,
        ILogger<MongoProfileProvider> logger)
    {
        var dbName = configuration["MongoDB:Database"] ?? "jobmatch";
        var db = mongoClient.GetDatabase(dbName);
        _collection = db.GetCollection<BsonDocument>(CollectionName);
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<string> GetProfileAsync(CancellationToken cancellationToken = default)
    {
        var doc = await GetProfileDocumentAsync(cancellationToken);
        return doc.Content;
    }

    public async Task<ProfileDocument> GetProfileDocumentAsync(CancellationToken cancellationToken = default)
    {
        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var doc = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);

        if (doc is null)
        {
            _logger.LogInformation("No profile doc in Mongo; seeding from Data/professional-profile.md");
            return await SeedFromFileAsync(cancellationToken);
        }

        return ToProfileDocument(doc);
    }

    public async Task UpsertProfileAsync(
        string? content,
        Dictionary<string, object?>? scoringConfig,
        string? analystPrompt,
        string? evaluatorPrompt,
        CancellationToken cancellationToken = default)
    {
        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var existing = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);

        var mergedConfig = existing != null && existing.Contains("scoring_config") && existing["scoring_config"].IsBsonDocument
            ? existing["scoring_config"].AsBsonDocument.DeepClone().AsBsonDocument
            : new BsonDocument();

        if (scoringConfig is not null)
        {
            foreach (var (k, v) in scoringConfig)
            {
                mergedConfig[k] = v is null ? BsonNull.Value : BsonValue.Create(v);
            }
        }

        var effectiveContent = content
            ?? (existing != null && existing.Contains("content") && existing["content"].IsString
                ? existing["content"].AsString
                : "");

        var update = new BsonDocument
        {
            ["id"] = DocId,
            ["content"] = effectiveContent,
            ["scoring_config"] = mergedConfig,
            ["updated_at"] = DateTime.UtcNow
        };

        // Per-field semantics: null = carry forward existing (if any); non-null = overwrite
        // (empty string clears the override → GET falls back to bundled seed)
        CarryOrOverwrite(update, existing, "analyst_prompt", analystPrompt);
        CarryOrOverwrite(update, existing, "evaluator_prompt", evaluatorPrompt);

        await _collection.ReplaceOneAsync(
            filter,
            update,
            new ReplaceOptions { IsUpsert = true },
            cancellationToken);

        _logger.LogInformation(
            "Profile upserted (content={ContentState}, configKeys={ConfigKeys}, analyst={AnalystState}, evaluator={EvaluatorState})",
            content is null ? "unchanged" : $"{content.Length} chars",
            mergedConfig.ElementCount,
            FieldStateDescription(analystPrompt),
            FieldStateDescription(evaluatorPrompt));
    }

    public async Task<ScoringConfig> GetScoringConfigAsync(CancellationToken cancellationToken = default)
    {
        var doc = await GetProfileDocumentAsync(cancellationToken);
        var cfg = doc.ScoringConfig;

        T Get<T>(string key, T fallback)
        {
            if (!cfg.TryGetValue(key, out var v) || v is null) return fallback;
            try
            {
                if (typeof(T) == typeof(decimal))
                    return (T)(object)Convert.ToDecimal(v);
                if (typeof(T) == typeof(int))
                    return (T)(object)Convert.ToInt32(v);
                if (typeof(T) == typeof(bool))
                    return (T)(object)Convert.ToBoolean(v);
                if (typeof(T) == typeof(string))
                    return (T)(object)Convert.ToString(v)!;
                return (T)v;
            }
            catch
            {
                return fallback;
            }
        }

        return new ScoringConfig
        {
            Model = Get("model", "claude-opus-4-20250514"),
            Temperature = Get("temperature", 0.5m),
            MaxTokens = Get("max_tokens", 4096),
            ThinkingEnabled = Get("thinking_enabled", false),
            ThinkingBudget = Get("thinking_budget", 2048),
            MinScoreToSave = Get("min_score_to_save", 70)
        };
    }

    public async Task<string> GetAnalystPromptAsync(CancellationToken cancellationToken = default)
    {
        var stored = await ReadStoredPromptAsync("analyst_prompt", cancellationToken);
        return !string.IsNullOrWhiteSpace(stored) ? stored : PromptSeeds.Analyst;
    }

    public async Task<string> GetEvaluatorPromptAsync(CancellationToken cancellationToken = default)
    {
        var stored = await ReadStoredPromptAsync("evaluator_prompt", cancellationToken);
        return !string.IsNullOrWhiteSpace(stored) ? stored : PromptSeeds.Evaluator;
    }

    private async Task<string?> ReadStoredPromptAsync(string field, CancellationToken cancellationToken)
    {
        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var doc = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);
        if (doc != null && doc.Contains(field) && doc[field].IsString)
        {
            return doc[field].AsString;
        }
        return null;
    }

    private async Task<ProfileDocument> SeedFromFileAsync(CancellationToken cancellationToken)
    {
        var basePath = _configuration["ContentRoot"] ?? Directory.GetCurrentDirectory();
        var relativePath = _configuration["Profile:FilePath"] ?? "Data/professional-profile.md";
        var filePath = Path.Combine(basePath, relativePath);

        string content;
        if (File.Exists(filePath))
        {
            content = await File.ReadAllTextAsync(filePath, cancellationToken);
            _logger.LogInformation("Seeded profile from file: {FilePath} ({Length} chars)", filePath, content.Length);
        }
        else
        {
            content = "";
            _logger.LogWarning("Seed file missing: {FilePath}. Inserted empty profile.", filePath);
        }

        var defaultConfig = new BsonDocument
        {
            ["model"] = "claude-opus-4-20250514",
            ["temperature"] = 0.5,
            ["max_tokens"] = 4096,
            ["thinking_enabled"] = false,
            ["thinking_budget"] = 2048,
            ["min_score_to_save"] = 70
        };

        var doc = new BsonDocument
        {
            ["id"] = DocId,
            ["content"] = content,
            ["scoring_config"] = defaultConfig,
            ["updated_at"] = DateTime.UtcNow
        };

        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        await _collection.ReplaceOneAsync(
            filter, doc, new ReplaceOptions { IsUpsert = true }, cancellationToken);

        return ToProfileDocument(doc);
    }

    private ProfileDocument ToProfileDocument(BsonDocument doc)
    {
        var content = doc.Contains("content") && doc["content"].IsString ? doc["content"].AsString : "";

        var configDict = new Dictionary<string, object?>();
        if (doc.Contains("scoring_config") && doc["scoring_config"].IsBsonDocument)
        {
            foreach (var el in doc["scoring_config"].AsBsonDocument)
            {
                configDict[el.Name] = BsonTypeMapper.MapToDotNetValue(el.Value);
            }
        }

        var analystPrompt = ExtractEffectivePrompt(doc, "analyst_prompt", PromptSeeds.Analyst);
        var evaluatorPrompt = ExtractEffectivePrompt(doc, "evaluator_prompt", PromptSeeds.Evaluator);

        DateTime? updatedAt = null;
        if (doc.Contains("updated_at") && doc["updated_at"].IsValidDateTime)
        {
            updatedAt = doc["updated_at"].ToUniversalTime();
        }

        return new ProfileDocument
        {
            Content = content,
            ScoringConfig = configDict,
            AnalystPrompt = analystPrompt,
            EvaluatorPrompt = evaluatorPrompt,
            UpdatedAt = updatedAt
        };
    }

    private static string ExtractEffectivePrompt(BsonDocument doc, string field, string seed)
    {
        if (doc.Contains(field) && doc[field].IsString && !string.IsNullOrWhiteSpace(doc[field].AsString))
        {
            return doc[field].AsString;
        }
        return seed;
    }

    private static void CarryOrOverwrite(BsonDocument update, BsonDocument? existing, string field, string? incoming)
    {
        if (incoming is not null)
        {
            update[field] = incoming;
        }
        else if (existing is not null && existing.Contains(field))
        {
            update[field] = existing[field];
        }
    }

    private static string FieldStateDescription(string? value) =>
        value is null ? "unchanged" : value.Length == 0 ? "cleared" : $"{value.Length} chars";
}
