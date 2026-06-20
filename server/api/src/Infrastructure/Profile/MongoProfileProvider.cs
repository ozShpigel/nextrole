using ApplicationTracker.Core.Profile;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Profile;

public sealed class MongoProfileProvider : IProfileProvider
{
    private const string DocId = "default";
    private const string CollectionName = "profile";

    private const string CacheKey = "profile_doc";
    private const string InterviewPrepCacheKey = "interview_prep_doc";
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(30);

    private const string InterviewPrepKey = "interview_prep";
    private const string InterviewPrepHistoryKey = "history_interview_prep";
    private const int QaRubricMaxEntries = 200;
    private const int InterviewPrepMaxFieldLength = 50_000;
    private static readonly string[] InterviewPrepStringFields =
    {
        "self_presentation_hr", "self_presentation_technical",
        "presenting_work_project", "presenting_personal_project"
    };
    private static readonly HashSet<string> InterviewPrepHistoryFields = new(StringComparer.Ordinal)
    {
        "self_presentation_hr", "self_presentation_technical",
        "presenting_work_project", "presenting_personal_project", "qa_rubric"
    };

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

    public async Task UpsertProfileAsync(string? content, CancellationToken cancellationToken = default)
    {
        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var existing = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);

        var effectiveContent = content
            ?? (existing != null && existing.Contains("content") && existing["content"].IsString
                ? existing["content"].AsString
                : "");

        // Version history: snapshot the PREVIOUS value of `content` when it
        // actually changes (newest-first, capped). Carries existing history forward.
        var history = existing != null && existing.Contains("history") && existing["history"].IsBsonDocument
            ? existing["history"].AsBsonDocument.DeepClone().AsBsonDocument
            : new BsonDocument();
        var prevSavedAt = existing != null && existing.Contains("updated_at") && existing["updated_at"].IsValidDateTime
            ? existing["updated_at"]
            : (BsonValue)BsonNull.Value;

        if (content is not null && existing != null && existing.Contains("content")
            && existing["content"].IsString && existing["content"].AsString != effectiveContent)
            PushHistory(history, "content", existing["content"], prevSavedAt);

        // Partial $set so this write only ever touches the fields it owns — the
        // interview_prep / history_interview_prep sub-objects (written by a
        // separate $set path) are left intact instead of being dropped by a
        // full-document replace.
        var sets = new List<UpdateDefinition<BsonDocument>>
        {
            Builders<BsonDocument>.Update.SetOnInsert("id", DocId),
            Builders<BsonDocument>.Update.Set("updated_at", DateTime.UtcNow),
        };

        // content: overwrite only when provided; otherwise leave existing untouched
        // (seed an empty string on first insert so the field always exists).
        sets.Add(content is not null
            ? Builders<BsonDocument>.Update.Set("content", content)
            : Builders<BsonDocument>.Update.SetOnInsert("content", effectiveContent));

        if (history.ElementCount > 0)
            sets.Add(Builders<BsonDocument>.Update.Set("history", history));

        await _collection.UpdateOneAsync(
            filter,
            Builders<BsonDocument>.Update.Combine(sets),
            new UpdateOptions { IsUpsert = true },
            cancellationToken);

        _cache.Remove(CacheKey);

        _logger.LogInformation(
            "Profile upserted (content={ContentState})",
            content is null ? "unchanged" : $"{content.Length} chars");
    }

    private const int HistoryCap = 10;
    private static readonly HashSet<string> HistoryFields = new(StringComparer.Ordinal)
    {
        "content"
    };

    private static void ValidateHistoryField(string field)
    {
        if (!HistoryFields.Contains(field))
            throw new ArgumentException($"Unknown history field: {field}");
    }

    private static void PushHistory(BsonDocument history, string field, BsonValue previousValue, BsonValue savedAt)
    {
        var arr = history.Contains(field) && history[field].IsBsonArray
            ? history[field].AsBsonArray
            : new BsonArray();
        arr.Insert(0, new BsonDocument
        {
            ["value"] = previousValue.DeepClone(),
            ["saved_at"] = savedAt,
        });
        while (arr.Count > HistoryCap) arr.RemoveAt(arr.Count - 1);
        history[field] = arr;
    }

    public async Task<IReadOnlyList<ProfileHistoryEntry>> GetHistoryAsync(string field, CancellationToken cancellationToken = default)
    {
        ValidateHistoryField(field);

        // Read straight from Mongo — the cached ProfileDocument doesn't carry history.
        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var doc = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);

        var entries = new List<ProfileHistoryEntry>();
        if (doc is null || !doc.Contains("history") || !doc["history"].IsBsonDocument) return entries;
        var history = doc["history"].AsBsonDocument;
        if (!history.Contains(field) || !history[field].IsBsonArray) return entries;

        var arr = history[field].AsBsonArray;
        for (var i = 0; i < arr.Count; i++)
        {
            if (!arr[i].IsBsonDocument) continue;
            var el = arr[i].AsBsonDocument;
            var value = el.GetValue("value", BsonNull.Value);
            DateTime? savedAt = el.Contains("saved_at") && el["saved_at"].IsValidDateTime
                ? el["saved_at"].ToUniversalTime()
                : null;
            var (preview, length) = PreviewOf(value);
            entries.Add(new ProfileHistoryEntry { Index = i, SavedAt = savedAt, Preview = preview, Length = length });
        }
        return entries;
    }

    public async Task RestoreHistoryAsync(string field, int index, CancellationToken cancellationToken = default)
    {
        ValidateHistoryField(field);

        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var doc = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);
        if (doc is null || !doc.Contains("history") || !doc["history"].IsBsonDocument)
            throw new ArgumentException("No history to restore from");
        var history = doc["history"].AsBsonDocument;
        if (!history.Contains(field) || !history[field].IsBsonArray)
            throw new ArgumentException($"No history for field: {field}");
        var arr = history[field].AsBsonArray;
        if (index < 0 || index >= arr.Count || !arr[index].IsBsonDocument)
            throw new ArgumentException($"History index out of range: {index}");

        var value = arr[index].AsBsonDocument.GetValue("value", BsonNull.Value);

        // Route through UpsertProfileAsync so restoring itself snapshots the
        // current value into history (i.e. a restore is undoable).
        if (field == "content")
            await UpsertProfileAsync(value.IsString ? value.AsString : "", cancellationToken);
    }

    // ── Interview prep ──────────────────────────────────────────────────────
    // Stored under the `interview_prep` sub-object on the same singleton doc,
    // with version history under `history_interview_prep`. Writes use a partial
    // $set so the profile `content` field is untouched.

    public async Task<InterviewPrepDocument> GetInterviewPrepAsync(CancellationToken cancellationToken = default)
    {
        if (_cache.TryGetValue(InterviewPrepCacheKey, out InterviewPrepDocument? cached) && cached is not null)
            return cached;

        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var doc = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);

        var sub = doc != null && doc.Contains(InterviewPrepKey) && doc[InterviewPrepKey].IsBsonDocument
            ? doc[InterviewPrepKey].AsBsonDocument
            : new BsonDocument();
        var result = ToInterviewPrepDocument(sub);

        _cache.Set(InterviewPrepCacheKey, result, CacheDuration);
        return result;
    }

    private static InterviewPrepDocument ToInterviewPrepDocument(BsonDocument sub)
    {
        string Str(string field) => sub.Contains(field) && sub[field].IsString ? sub[field].AsString : "";
        List<string> Cues(string field) =>
            sub.Contains(field) && sub[field].IsBsonArray
                ? sub[field].AsBsonArray.Where(v => v.IsString).Select(v => v.AsString).ToList()
                : new List<string>();

        var qa = sub.Contains("qa_rubric") ? ReadQaRubric(sub["qa_rubric"]) : new List<QaEntry>();

        DateTime? updatedAt = null;
        if (sub.Contains("updated_at") && sub["updated_at"].IsValidDateTime)
            updatedAt = sub["updated_at"].ToUniversalTime();

        return new InterviewPrepDocument
        {
            SelfPresentationHr = Str("self_presentation_hr"),
            SelfPresentationTechnical = Str("self_presentation_technical"),
            PresentingWorkProject = Str("presenting_work_project"),
            PresentingPersonalProject = Str("presenting_personal_project"),
            QaRubric = qa,
            SelfPresentationHrCues = Cues("self_presentation_hr_cues"),
            SelfPresentationTechnicalCues = Cues("self_presentation_technical_cues"),
            UpdatedAt = updatedAt,
        };
    }

    public async Task UpsertInterviewPrepAsync(
        string? selfPresentationHr,
        string? selfPresentationTechnical,
        string? presentingWorkProject,
        string? presentingPersonalProject,
        IReadOnlyList<QaEntry>? qaRubric,
        CancellationToken cancellationToken = default)
    {
        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var existing = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);

        // Ensure the base profile doc is seeded before we attach interview prep,
        // so an upsert here never creates a doc that bypasses profile seeding.
        if (existing is null)
        {
            await GetProfileDocumentAsync(cancellationToken);
            existing = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);
        }

        var existingSub = existing != null && existing.Contains(InterviewPrepKey) && existing[InterviewPrepKey].IsBsonDocument
            ? existing[InterviewPrepKey].AsBsonDocument
            : new BsonDocument();

        ValidateStringField(selfPresentationHr);
        ValidateStringField(selfPresentationTechnical);
        ValidateStringField(presentingWorkProject);
        ValidateStringField(presentingPersonalProject);

        var sub = new BsonDocument { ["updated_at"] = DateTime.UtcNow };
        CarryOrOverwrite(sub, existingSub, "self_presentation_hr", selfPresentationHr);
        CarryOrOverwrite(sub, existingSub, "self_presentation_technical", selfPresentationTechnical);
        CarryOrOverwrite(sub, existingSub, "presenting_work_project", presentingWorkProject);
        CarryOrOverwrite(sub, existingSub, "presenting_personal_project", presentingPersonalProject);

        // Cached keyword cues are tied to the saved presentation text: carry them
        // forward, but drop them when the underlying text actually changes (the
        // rebuilt `sub` would otherwise just lose them on every save).
        CarryCues(sub, existingSub, "self_presentation_hr", selfPresentationHr);
        CarryCues(sub, existingSub, "self_presentation_technical", selfPresentationTechnical);

        var newRubric = qaRubric is not null
            ? BuildQaRubricBson(qaRubric)
            : (existingSub.Contains("qa_rubric") && existingSub["qa_rubric"].IsBsonArray
                ? existingSub["qa_rubric"].AsBsonArray
                : new BsonArray());
        sub["qa_rubric"] = newRubric;

        // Version history: snapshot the previous value of each tracked field that
        // is actually changing (newest-first, capped). Carries existing history forward.
        var history = existing != null && existing.Contains(InterviewPrepHistoryKey) && existing[InterviewPrepHistoryKey].IsBsonDocument
            ? existing[InterviewPrepHistoryKey].AsBsonDocument.DeepClone().AsBsonDocument
            : new BsonDocument();
        var prevSavedAt = existingSub.Contains("updated_at") && existingSub["updated_at"].IsValidDateTime
            ? existingSub["updated_at"]
            : (BsonValue)BsonNull.Value;

        foreach (var field in InterviewPrepStringFields)
        {
            var incoming = field switch
            {
                "self_presentation_hr" => selfPresentationHr,
                "self_presentation_technical" => selfPresentationTechnical,
                "presenting_work_project" => presentingWorkProject,
                "presenting_personal_project" => presentingPersonalProject,
                _ => null
            };
            if (incoming is not null && existingSub.Contains(field)
                && existingSub[field].IsString && existingSub[field].AsString != incoming)
                PushHistory(history, field, existingSub[field], prevSavedAt);
        }

        if (qaRubric is not null && existingSub.Contains("qa_rubric")
            && existingSub["qa_rubric"].IsBsonArray && !existingSub["qa_rubric"].AsBsonArray.Equals(newRubric))
            PushHistory(history, "qa_rubric", existingSub["qa_rubric"], prevSavedAt);

        var update = Builders<BsonDocument>.Update
            .Set(InterviewPrepKey, sub)
            .Set(InterviewPrepHistoryKey, history);

        await _collection.UpdateOneAsync(
            filter, update, new UpdateOptions { IsUpsert = true }, cancellationToken);

        _cache.Remove(InterviewPrepCacheKey);

        _logger.LogInformation(
            "Interview prep upserted (hr={Hr}, tech={Tech}, work={Work}, personal={Personal}, qaEntries={QaCount})",
            FieldStateDescription(selfPresentationHr), FieldStateDescription(selfPresentationTechnical),
            FieldStateDescription(presentingWorkProject), FieldStateDescription(presentingPersonalProject),
            qaRubric is null ? "unchanged" : newRubric.Count.ToString());
    }

    public async Task SetPresentationCuesAsync(string field, IReadOnlyList<string> cues, CancellationToken cancellationToken = default)
    {
        if (field is not ("self_presentation_hr" or "self_presentation_technical"))
            throw new ArgumentException($"Cues are not supported for field '{field}'");

        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        // Ensure the base/interview-prep doc exists before a targeted $set.
        var existing = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);
        if (existing is null)
            await GetProfileDocumentAsync(cancellationToken);

        var arr = new BsonArray(cues.Select(c => (BsonValue)c));
        // Dot-path $set touches only this one key — siblings (text, qa_rubric,
        // the other field's cues, history) are left intact.
        var update = Builders<BsonDocument>.Update.Set($"{InterviewPrepKey}.{field}_cues", arr);
        await _collection.UpdateOneAsync(
            filter, update, new UpdateOptions { IsUpsert = true }, cancellationToken);

        _cache.Remove(InterviewPrepCacheKey);
        _logger.LogInformation("Persisted {Count} keyword cues for {Field}", cues.Count, field);
    }

    public async Task<IReadOnlyList<ProfileHistoryEntry>> GetInterviewPrepHistoryAsync(string field, CancellationToken cancellationToken = default)
    {
        ValidateInterviewPrepHistoryField(field);

        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var doc = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);

        var entries = new List<ProfileHistoryEntry>();
        if (doc is null || !doc.Contains(InterviewPrepHistoryKey) || !doc[InterviewPrepHistoryKey].IsBsonDocument) return entries;
        var history = doc[InterviewPrepHistoryKey].AsBsonDocument;
        if (!history.Contains(field) || !history[field].IsBsonArray) return entries;

        var arr = history[field].AsBsonArray;
        for (var i = 0; i < arr.Count; i++)
        {
            if (!arr[i].IsBsonDocument) continue;
            var el = arr[i].AsBsonDocument;
            var value = el.GetValue("value", BsonNull.Value);
            DateTime? savedAt = el.Contains("saved_at") && el["saved_at"].IsValidDateTime
                ? el["saved_at"].ToUniversalTime()
                : null;
            var (preview, length) = PreviewOf(value);
            entries.Add(new ProfileHistoryEntry { Index = i, SavedAt = savedAt, Preview = preview, Length = length });
        }
        return entries;
    }

    public async Task RestoreInterviewPrepHistoryAsync(string field, int index, CancellationToken cancellationToken = default)
    {
        ValidateInterviewPrepHistoryField(field);

        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        var doc = await _collection.Find(filter).FirstOrDefaultAsync(cancellationToken);
        if (doc is null || !doc.Contains(InterviewPrepHistoryKey) || !doc[InterviewPrepHistoryKey].IsBsonDocument)
            throw new ArgumentException("No history to restore from");
        var history = doc[InterviewPrepHistoryKey].AsBsonDocument;
        if (!history.Contains(field) || !history[field].IsBsonArray)
            throw new ArgumentException($"No history for field: {field}");
        var arr = history[field].AsBsonArray;
        if (index < 0 || index >= arr.Count || !arr[index].IsBsonDocument)
            throw new ArgumentException($"History index out of range: {index}");

        var value = arr[index].AsBsonDocument.GetValue("value", BsonNull.Value);

        // Route through UpsertInterviewPrepAsync so restoring snapshots the
        // current value into history (i.e. a restore is undoable).
        switch (field)
        {
            case "self_presentation_hr":
                await UpsertInterviewPrepAsync(value.IsString ? value.AsString : "", null, null, null, null, cancellationToken);
                break;
            case "self_presentation_technical":
                await UpsertInterviewPrepAsync(null, value.IsString ? value.AsString : "", null, null, null, cancellationToken);
                break;
            case "presenting_work_project":
                await UpsertInterviewPrepAsync(null, null, value.IsString ? value.AsString : "", null, null, cancellationToken);
                break;
            case "presenting_personal_project":
                await UpsertInterviewPrepAsync(null, null, null, value.IsString ? value.AsString : "", null, cancellationToken);
                break;
            case "qa_rubric":
                await UpsertInterviewPrepAsync(null, null, null, null, ReadQaRubric(value), cancellationToken);
                break;
        }
    }

    private static void ValidateInterviewPrepHistoryField(string field)
    {
        if (!InterviewPrepHistoryFields.Contains(field))
            throw new ArgumentException($"Unknown history field: {field}");
    }

    private static void ValidateStringField(string? value)
    {
        if (value is not null && value.Length > InterviewPrepMaxFieldLength)
            throw new ArgumentException($"Field exceeds maximum length of {InterviewPrepMaxFieldLength} characters");
    }

    private static List<QaEntry> ReadQaRubric(BsonValue value)
    {
        var list = new List<QaEntry>();
        if (!value.IsBsonArray) return list;
        foreach (var item in value.AsBsonArray)
        {
            if (!item.IsBsonDocument) continue;
            var d = item.AsBsonDocument;
            list.Add(new QaEntry
            {
                Question = d.Contains("question") && d["question"].IsString ? d["question"].AsString : "",
                Answer = d.Contains("answer") && d["answer"].IsString ? d["answer"].AsString : "",
            });
        }
        return list;
    }

    private static BsonArray BuildQaRubricBson(IReadOnlyList<QaEntry> entries)
    {
        var arr = new BsonArray();
        foreach (var e in entries)
        {
            var question = (e.Question ?? "").Trim();
            var answer = e.Answer ?? "";
            // Skip fully-empty rows so blank trailing entries don't persist.
            if (question.Length == 0 && answer.Trim().Length == 0) continue;
            if (question.Length > InterviewPrepMaxFieldLength || answer.Length > InterviewPrepMaxFieldLength)
                throw new ArgumentException($"qa_rubric entry exceeds maximum length of {InterviewPrepMaxFieldLength} characters");
            if (arr.Count >= QaRubricMaxEntries)
                throw new ArgumentException($"qa_rubric exceeds maximum of {QaRubricMaxEntries} entries");
            arr.Add(new BsonDocument { ["question"] = question, ["answer"] = answer });
        }
        return arr;
    }

    private static (string Preview, int Length) PreviewOf(BsonValue value)
    {
        const int max = 300;
        string text = value switch
        {
            { IsString: true } => value.AsString,
            { IsBsonArray: true } => PreviewBsonArray(value.AsBsonArray),
            { IsBsonDocument: true } => value.AsBsonDocument.ToJson(),
            _ => value.ToString() ?? ""
        };
        var preview = text.Length > max ? text[..max] + "…" : text;
        return (preview, text.Length);
    }

    // Renders a qa_rubric snapshot (array of {question, answer}) as readable
    // "Q: …\nA: …" blocks for the history preview, instead of a raw JSON dump.
    private static string PreviewBsonArray(BsonArray arr)
    {
        var blocks = new List<string>();
        foreach (var item in arr)
        {
            if (!item.IsBsonDocument) continue;
            var d = item.AsBsonDocument;
            var q = d.Contains("question") && d["question"].IsString ? d["question"].AsString : "";
            var a = d.Contains("answer") && d["answer"].IsString ? d["answer"].AsString : "";
            blocks.Add($"Q: {q}\nA: {a}");
        }
        return string.Join("\n\n", blocks);
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

        var doc = new BsonDocument
        {
            ["id"] = DocId,
            ["content"] = content,
            ["updated_at"] = DateTime.UtcNow
        };

        var filter = Builders<BsonDocument>.Filter.Eq("id", DocId);
        await _collection.ReplaceOneAsync(
            filter, doc, new ReplaceOptions { IsUpsert = true }, cancellationToken);

        return ToProfileDocument(doc);
    }

    private static ProfileDocument ToProfileDocument(BsonDocument doc)
    {
        var content = doc.Contains("content") && doc["content"].IsString ? doc["content"].AsString : "";

        DateTime? updatedAt = null;
        if (doc.Contains("updated_at") && doc["updated_at"].IsValidDateTime)
        {
            updatedAt = doc["updated_at"].ToUniversalTime();
        }

        return new ProfileDocument
        {
            Content = content,
            UpdatedAt = updatedAt
        };
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

    // Carry a field's cached cues (`<field>_cues`) forward, unless the field's
    // text is being overwritten with a different value — in which case the cues
    // no longer match the text and are dropped (so the next view regenerates).
    private static void CarryCues(BsonDocument update, BsonDocument existing, string textField, string? incomingText)
    {
        var cuesKey = textField + "_cues";
        if (!existing.Contains(cuesKey) || !existing[cuesKey].IsBsonArray) return;
        var existingText = existing.Contains(textField) && existing[textField].IsString ? existing[textField].AsString : "";
        var resultingText = incomingText ?? existingText; // null incoming = carry text forward
        if (resultingText == existingText)
            update[cuesKey] = existing[cuesKey];
    }

    private static string FieldStateDescription(string? value) =>
        value is null ? "unchanged" : value.Length == 0 ? "cleared" : $"{value.Length} chars";
}
