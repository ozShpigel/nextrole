using System.Text.Json;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Infrastructure.AI;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Profile;

public sealed class MongoProfileProvider : IProfileProvider
{
    private const string DocId = "default";
    private const string CollectionName = "profile";

    private const string CacheKey = "profile_doc";
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(30);

    private readonly IMongoCollection<BsonDocument> _collection;
    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _cache;
    private readonly ILogger<MongoProfileProvider> _logger;

    public MongoProfileProvider(
        IMongoClient mongoClient,
        IConfiguration configuration,
        IMemoryCache cache,
        ILogger<MongoProfileProvider> logger)
    {
        // Profile lives in its own DB by default (keeps prior JobMatchService
        // data intact). Override with `MongoDB:ProfileDatabase` if a single
        // merged DB is preferred.
        var dbName = configuration["MongoDB:ProfileDatabase"]
            ?? configuration["MongoDB:Database"]
            ?? "jobmatch";
        var db = mongoClient.GetDatabase(dbName);
        _collection = db.GetCollection<BsonDocument>(CollectionName);
        _configuration = configuration;
        _cache = cache;
        _logger = logger;
    }

    public async Task<string> GetProfileAsync(CancellationToken cancellationToken = default)
    {
        var doc = await GetProfileDocumentAsync(cancellationToken);
        return doc.Content;
    }

    public async Task<ProfileDocument> GetProfileDocumentAsync(CancellationToken cancellationToken = default)
    {
        if (_cache.TryGetValue(CacheKey, out ProfileDocument? cached) && cached is not null)
            return cached;

        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var doc = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);

        ProfileDocument result;
        if (doc is null)
        {
            _logger.LogInformation("No profile doc in Mongo; seeding from Data/professional-profile.md");
            result = await SeedFromFileAsync(cancellationToken);
        }
        else
        {
            result = ToProfileDocument(doc);
        }

        _cache.Set(CacheKey, result, CacheDuration);
        return result;
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
                mergedConfig[k] = ToBsonValue(v);
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

        _cache.Remove(CacheKey);

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

        var defaults = new ScoringConfig();

        // Accepts two shapes:
        //   New (nested):  { analyst: {...}, evaluator: {...}, min_score_to_save: N }
        //   Legacy (flat): { model, temperature, max_tokens, thinking_enabled, thinking_budget, min_score_to_save }
        // Flat keys map to the Evaluator role (that was the only call that
        // actually honored those fields), while Analyst falls back to defaults.
        var analystDict = ExtractRoleDict(cfg, "analyst");
        var evaluatorDict = ExtractRoleDict(cfg, "evaluator") ?? cfg;

        var analyst = BuildRoleConfig(analystDict, defaults.Analyst);
        var evaluator = BuildRoleConfig(evaluatorDict, defaults.Evaluator);
        var minScore = Convert<int>(cfg, "min_score_to_save", defaults.MinScoreToSave);

        var resolved = new ScoringConfig
        {
            Analyst = analyst,
            Evaluator = evaluator,
            MinScoreToSave = minScore,
        };

        // Logged per-fetch (i.e. per /api/match call) so the models in use are
        // always visible in Render logs. Since this reads fresh from Mongo
        // every time, seeing the value change here after a Settings-page save
        // is confirmation that hot-reload works without a service restart.
        _logger.LogInformation(
            "Loaded scoring config: analyst={AnalystModel}/t={AnalystTemp}/think={AnalystThink} | evaluator={EvalModel}/t={EvalTemp}/think={EvalThink} | minScore={MinScore}",
            resolved.Analyst.Model, resolved.Analyst.Temperature, resolved.Analyst.ThinkingEnabled,
            resolved.Evaluator.Model, resolved.Evaluator.Temperature, resolved.Evaluator.ThinkingEnabled,
            resolved.MinScoreToSave);

        return resolved;
    }

    private static Dictionary<string, object?>? ExtractRoleDict(Dictionary<string, object?> cfg, string key)
    {
        if (!cfg.TryGetValue(key, out var v) || v is null) return null;
        // BsonTypeMapper gives us Dictionary<string, object>; JSON deserialization
        // gives us Dictionary<string, object?>; be permissive and accept anything dict-shaped.
        if (v is System.Collections.IDictionary dict)
        {
            var map = new Dictionary<string, object?>();
            foreach (var dk in dict.Keys)
            {
                if (dk is string ks) map[ks] = dict[dk];
            }
            return map;
        }
        if (v is MongoDB.Bson.BsonDocument bson)
        {
            var map = new Dictionary<string, object?>();
            foreach (var el in bson) map[el.Name] = MongoDB.Bson.BsonTypeMapper.MapToDotNetValue(el.Value);
            return map;
        }
        return null;
    }

    private static RoleScoringConfig BuildRoleConfig(Dictionary<string, object?>? src, RoleScoringConfig fallback) =>
        new()
        {
            Model = Convert(src, "model", fallback.Model),
            Temperature = Convert(src, "temperature", fallback.Temperature),
            MaxTokens = Convert(src, "max_tokens", fallback.MaxTokens),
            ThinkingEnabled = Convert(src, "thinking_enabled", fallback.ThinkingEnabled),
            ThinkingBudget = Convert(src, "thinking_budget", fallback.ThinkingBudget),
        };

    private static T Convert<T>(Dictionary<string, object?>? src, string key, T fallback)
    {
        if (src is null || !src.TryGetValue(key, out var v) || v is null) return fallback;
        try
        {
            if (typeof(T) == typeof(decimal))
                return (T)(object)System.Convert.ToDecimal(v);
            if (typeof(T) == typeof(int))
                return (T)(object)System.Convert.ToInt32(v);
            if (typeof(T) == typeof(bool))
                return (T)(object)System.Convert.ToBoolean(v);
            if (typeof(T) == typeof(string))
                return (T)(object)System.Convert.ToString(v)!;
            return (T)v;
        }
        catch
        {
            return fallback;
        }
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
        var analystIsOverride = HasStoredOverride(doc, "analyst_prompt");
        var evaluatorIsOverride = HasStoredOverride(doc, "evaluator_prompt");

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
            AnalystIsOverride = analystIsOverride,
            EvaluatorIsOverride = evaluatorIsOverride,
            UpdatedAt = updatedAt
        };
    }

    private static bool HasStoredOverride(BsonDocument doc, string field) =>
        doc.Contains(field) && doc[field].IsString && !string.IsNullOrWhiteSpace(doc[field].AsString);

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

    // Incoming scoring_config values arrive as JsonElement (System.Text.Json
    // produces these when deserializing into Dictionary<string, object?>).
    // BsonValue.Create doesn't understand JsonElement, so unwrap to primitives
    // before handing off to the Mongo driver.
    private static BsonValue ToBsonValue(object? value) => value switch
    {
        null => BsonNull.Value,
        JsonElement el => JsonElementToBson(el),
        _ => BsonValue.Create(value)
    };

    private static BsonValue JsonElementToBson(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => BsonNull.Value,
        JsonValueKind.True => BsonBoolean.True,
        JsonValueKind.False => BsonBoolean.False,
        JsonValueKind.String => new BsonString(el.GetString() ?? ""),
        JsonValueKind.Number when el.TryGetInt32(out var i) => new BsonInt32(i),
        JsonValueKind.Number when el.TryGetInt64(out var l) => new BsonInt64(l),
        JsonValueKind.Number => new BsonDouble(el.GetDouble()),
        JsonValueKind.Array => new BsonArray(el.EnumerateArray().Select(JsonElementToBson)),
        JsonValueKind.Object => new BsonDocument(
            el.EnumerateObject().Select(p => new BsonElement(p.Name, JsonElementToBson(p.Value)))),
        _ => BsonNull.Value
    };
}
