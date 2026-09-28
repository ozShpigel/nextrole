using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Core.Matching;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// The Greenhouse collection's write side: upsert what the board returned, and
/// close what has gone from it.
/// </summary>
/// <remarks>
/// Shared source data, like the LinkedIn pool: nothing here is user-scoped and
/// nothing goes through <c>UserScopedCollection</c>, because there is no user to
/// scope to. Apply AGENTS.md's test — would two users ever disagree about this
/// field? Every field written here is a fact about the posting, so no.
///
/// This collection is entirely separate from <c>discovered_jobs</c>. Nothing in
/// this file reads or writes the pool, and nothing merges the two sources.
/// </remarks>
public sealed class JobStore : IJobStore
{
    private readonly IMongoCollection<BsonDocument> _jobs;
    private readonly ILogger<JobStore> _log;

    public JobStore(IMongoCollection<BsonDocument> jobs, ILogger<JobStore> log)
    {
        _jobs = jobs;
        _log = log;
    }

    /// <summary>
    /// Content hashes already stored for this board, by the board's own job id.
    /// </summary>
    /// <remarks>
    /// Drives the skip: an unchanged hash costs neither an embedding nor a
    /// write. On a stable board this is the difference between re-embedding
    /// every posting daily and embedding nothing at all.
    /// </remarks>
    public async Task<Dictionary<string, string>> StoredHashesAsync(string boardKey, CancellationToken ct)
    {
        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey))
            .Project(Builders<BsonDocument>.Projection
                .Include(GreenhouseJobFields.SourceJobId).Include(GreenhouseJobFields.ContentHash))
            .ToListAsync(ct);

        var result = new Dictionary<string, string>(docs.Count);
        foreach (var doc in docs)
        {
            if (!doc.TryGetValue(GreenhouseJobFields.SourceJobId, out var id) || !id.IsString) continue;
            result[id.AsString] = doc.TryGetValue(GreenhouseJobFields.ContentHash, out var h) && h.IsString ? h.AsString : "";
        }

        return result;
    }

    /// <summary>Job ids this board currently has open (no closedAt).</summary>
    public async Task<HashSet<string>> OpenIdsAsync(string boardKey, CancellationToken ct)
    {
        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey),
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.ClosedAt, BsonNull.Value)))
            .Project(Builders<BsonDocument>.Projection.Include(GreenhouseJobFields.SourceJobId))
            .ToListAsync(ct);

        return [.. docs
            .Where(d => d.TryGetValue(GreenhouseJobFields.SourceJobId, out var v) && v.IsString)
            .Select(d => d[GreenhouseJobFields.SourceJobId].AsString)];
    }

    /// <summary>
    /// Upsert one batch of jobs with their vectors.
    /// </summary>
    /// <remarks>
    /// <b>Called per batch, never once at the end.</b> A board of 600 jobs is
    /// several embedding calls and several minutes; if the fifth call fails,
    /// the first four batches are already durable and their embeddings are
    /// already paid for. Holding every vector in memory to write them together
    /// would throw that money away on any failure.
    ///
    /// The upsert key is (boardKey, sourceJobId), backed by a unique index, so
    /// re-running is idempotent by construction rather than by the caller
    /// remembering to check first.
    /// </remarks>
    public async Task<(long Upserted, long Modified)> UpsertBatchAsync(
        IReadOnlyList<(GreenhouseJob Job, float[] Vector)> batch, string runId, DateTime now,
        CancellationToken ct)
    {
        if (batch.Count == 0) return (0, 0);

        var writes = new List<WriteModel<BsonDocument>>(batch.Count);

        foreach (var (job, vector) in batch)
        {
            var set = job.ToStoredFields();
            // BinData float32, NOT an array of doubles.
            //
            // `vector` is already float32 -- Voyage returns float32-precision
            // values and VoyageEmbeddingClient parses them into float[]. The
            // old `(double)v` widened each one to 8 bytes to carry 4 bytes of
            // information, 1024 times per job.
            //
            // Measured on the production collection: 19,545 -> 10,417 bytes per
            // document, a 46.7% cut, with retrieval IDENTICAL -- same ids, same
            // rank order, scores differing at ~1e-11 (float printing noise).
            // The round-trip is lossless by construction, so this is not a
            // precision trade: it is the same numbers in half the bytes.
            //
            // $vectorSearch reads both representations, and a collection
            // holding a mix queries correctly (verified with a one-document
            // probe against the live index), so no migration has to be
            // atomic with this change.
            set.Add(GreenhouseJobFields.Embedding,
                new BinaryVectorFloat32(vector).ToBsonBinaryData());
            set.Add(GreenhouseJobFields.EmbeddedAt, now);
            set.Add(GreenhouseJobFields.LastSeenAt, now);
            set.Add(GreenhouseJobFields.LastSeenRunId, runId);
            // A job that reappears after being closed is REOPENED, not
            // re-created. Anything upserted from a live board is by definition
            // open, so this is the reopen path as well as the insert path.
            set.Add(GreenhouseJobFields.ClosedAt, BsonNull.Value);

            writes.Add(new UpdateOneModel<BsonDocument>(
                Builders<BsonDocument>.Filter.And(
                    Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, job.BoardKey),
                    Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.SourceJobId, job.SourceJobId)),
                new BsonDocument
                {
                    { "$set", set },
                    // $setOnInsert, not $set: the extracted-fact fields are
                    // written once when a job enters and must survive every
                    // later upsert. A posting whose text changed is re-embedded
                    // but keeps its facts and its attempt count.
                    { "$setOnInsert", OnInsert(job, now) },
                })
            { IsUpsert = true });
        }

        var result = await _jobs.BulkWriteAsync(writes, new BulkWriteOptions { IsOrdered = false }, ct);
        return (result.Upserts.Count, result.ModifiedCount);
    }

    private static BsonDocument OnInsert(GreenhouseJob job, DateTime now)
    {
        var doc = GreenhouseJob.InitialExtractionFields();
        doc.Add(GreenhouseJobFields.FirstSeenAt, now);
        doc.Add(GreenhouseJobFields.Source, job.SourceName);
        return doc;
    }

    /// <summary>
    /// Mark jobs seen again whose content did not change.
    /// </summary>
    /// <remarks>
    /// Presence evidence only. No embedding, no content write: that is what the
    /// hash skip bought. <c>closedAt</c> is cleared here too, so a job that
    /// closed and reopened unchanged is reopened without being re-embedded.
    /// </remarks>
    public async Task<long> TouchAsync(
        string boardKey, IReadOnlyCollection<string> ids, string runId, DateTime now, CancellationToken ct)
    {
        if (ids.Count == 0) return 0;

        var result = await _jobs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey),
                Builders<BsonDocument>.Filter.In(GreenhouseJobFields.SourceJobId, ids)),
            Builders<BsonDocument>.Update
                .Set(GreenhouseJobFields.LastSeenAt, now)
                .Set(GreenhouseJobFields.LastSeenRunId, runId)
                .Set(GreenhouseJobFields.ClosedAt, BsonNull.Value),
            cancellationToken: ct);

        return result.ModifiedCount;
    }

    /// <summary>
    /// Store the ingest-time AI reads: the extracted facts and the Analyst parse.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Written per job rather than in one bulk update because the two
    /// dictionaries are independently sparse -- a facts chunk can succeed while
    /// the parse chunk for the same jobs fails, and vice versa. A job present in
    /// neither is left exactly as it was, with extract_attempts still counting.
    /// </para>
    /// <para>
    /// <c>extract_attempts</c> increments whether or not facts came back, which
    /// is the pool's rule: a posting the model consistently cannot read costs a
    /// bounded number of calls in its lifetime rather than one a day forever.
    /// </para>
    /// </remarks>
    /// <param name="factsAttempted">
    /// Every posting a facts read was sent for. Each is stamped with the current
    /// <c>facts_version</c> whether or not facts came back, so a re-read by
    /// version is made once -- a posting the model returns nothing for is not
    /// re-selected every run.
    /// </param>
    public async Task<long> SaveIngestAiAsync(
        string boardKey,
        IReadOnlyDictionary<string, BsonDocument> facts,
        IReadOnlyDictionary<string, BsonDocument> parsed,
        string? parseVersion,
        DateTime now,
        CancellationToken ct,
        bool countAttempt = true,
        IReadOnlyCollection<string>? factsAttempted = null)
    {
        var attempted = new HashSet<string>(factsAttempted ?? [], StringComparer.Ordinal);
        attempted.UnionWith(facts.Keys);
        var ids = facts.Keys.Union(parsed.Keys).Union(attempted).ToList();
        if (ids.Count == 0) return 0;

        var writes = new List<WriteModel<BsonDocument>>(ids.Count);

        foreach (var id in ids)
        {
            var set = new BsonDocument();

            if (facts.TryGetValue(id, out var f))
            {
                set.Add(GreenhouseJobFields.Extracted, f);
                set.Add(GreenhouseJobFields.ExtractedAt, now);
            }

            if (attempted.Contains(id))
                set.Add(GreenhouseJobFields.FactsVersion, IngestAiClient.FactsVersion);

            if (parsed.TryGetValue(id, out var p))
            {
                set.Add(GreenhouseJobFields.Parsed, p);
                set.Add(GreenhouseJobFields.ParsedAt, now);
                set.Add(GreenhouseJobFields.ParsedWith,
                    parseVersion is null ? BsonNull.Value : new BsonString(parseVersion));
            }

            // A posting only attempted -- no facts back -- still counts as read.
            var update = new BsonDocument { { "$set", set } };
            if (countAttempt && (facts.ContainsKey(id) || attempted.Contains(id)))
                update.Add("$inc", new BsonDocument { { GreenhouseJobFields.ExtractAttempts, 1 } });

            writes.Add(new UpdateOneModel<BsonDocument>(
                Builders<BsonDocument>.Filter.And(
                    Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey),
                    Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.SourceJobId, id)),
                update));
        }

        var result = await _jobs.BulkWriteAsync(writes, new BulkWriteOptions { IsOrdered = false }, ct);
        return result.ModifiedCount;
    }

    /// <summary>
    /// Close the jobs this board no longer lists.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Nothing is ever deleted.</b> A closed job keeps its text, its vector
    /// and its history; it only acquires a <c>closedAt</c>, which retrieval
    /// filters on. A job that comes back has that field cleared by
    /// <see cref="UpsertBatchAsync"/> or <see cref="TouchAsync"/>.
    /// </para>
    /// <para>
    /// <b>The second guard lives here</b> (the first is in
    /// <see cref="BoardHandler"/>: a throw on fetch never reaches this
    /// method at all). If the board returned an empty list while we hold a
    /// large number of open jobs, that is far more likely to be a board being
    /// rebuilt, a token that silently changed hands, or an upstream bug than a
    /// company closing every role it has at once. It logs and skips.
    /// </para>
    /// <para>
    /// The guard deliberately does NOT fire on a small stored count: a board
    /// with three jobs really can go to zero, and refusing to ever close those
    /// would leave them retrievable forever.
    /// </para>
    /// </remarks>
    /// <inheritdoc />
    public async Task<IReadOnlyList<StoredJobContent>> NeedingIngestAiAsync(
        string boardKey, int limit, CancellationToken ct)
    {
        // extract_attempts: 0 means nothing has read this posting yet -- the
        // value the initial write sets, and the only thing that distinguishes
        // "never attempted" from "attempted, unchanged since". Open postings
        // only: a closed one is not scored, so reading it would be spend with
        // no consumer.
        var filter = Builders<BsonDocument>.Filter.And(
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey),
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.ClosedAt, BsonNull.Value),
            Builders<BsonDocument>.Filter.Lte(GreenhouseJobFields.ExtractAttempts, 0),
            // Already in an open batch: submitting again would pay twice.
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.AiPendingFacts, BsonNull.Value),
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.AiPendingParse, BsonNull.Value));

        return await StoredContentAsync(filter, limit, ct);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<StoredJobContent>> NeedingFactsReReadAsync(
        string boardKey, int limit, CancellationToken ct)
    {
        // Read, and read before must_have_groups existed: `extracted` is a
        // document with no groups in it. Bounded by attempts rather than by
        // success, because a posting the model returns no facts for keeps
        // lacking the field -- without the bound it would be re-read every run.
        var f = Builders<BsonDocument>.Filter;
        var filter = f.And(
            f.Eq(GreenhouseJobFields.BoardKey, boardKey),
            f.Eq(GreenhouseJobFields.ClosedAt, BsonNull.Value),
            f.Type(GreenhouseJobFields.Extracted, BsonType.Document),
            f.Gt(GreenhouseJobFields.ExtractAttempts, 0),
            f.Eq(GreenhouseJobFields.AiPendingFacts, BsonNull.Value),
            f.Or(
                // Owed either field the current read produces. One re-read writes
                // the whole extracted document, so it settles both at once.
                f.And(
                    f.Or(
                        f.Exists(GreenhouseJobFields.ExtractedMustHaveGroups, false),
                        f.Exists(GreenhouseJobFields.ExtractedFunctions, false)),
                    f.Lt(GreenhouseJobFields.ExtractAttempts, MaxFactsReReadAttempts)),
                // Read by an older facts prompt, on a source that prompt got
                // wrong. Once per posting: the read stamps the version, facts or
                // none, so no attempts ceiling is needed.
                f.And(
                    f.In(GreenhouseJobFields.Source, FactsReReadSources),
                    f.Or(
                        f.Exists(GreenhouseJobFields.FactsVersion, false),
                        f.Lt(GreenhouseJobFields.FactsVersion, IngestAiClient.FactsVersion)))));

        return await StoredContentAsync(filter, limit, ct);
    }

    /// <summary>
    /// The extract_attempts ceiling for the groups re-read.
    /// </summary>
    /// <remarks>
    /// A row read once before groups existed sits at 1, so this allows it two
    /// re-reads. A posting the model still cannot read leaves the set after
    /// that and keeps its old flat facts, which are counted as before.
    /// </remarks>
    public const int MaxFactsReReadAttempts = 3;

    /// <summary>
    /// The sources whose postings are re-read when the facts prompt's version
    /// moves on (<c>IngestAiClient.FactsVersion</c>).
    /// </summary>
    /// <remarks>
    /// Version 2 (<c>hardware_engineering</c>): Workday only. Its companies are
    /// hardware-heavy, and their roles were filed as software. Greenhouse's are
    /// software companies: their rare hardware role is read right when it next
    /// changes, and everything Matches can show turns over within its 90-day
    /// window -- so re-reading ~1,200 postings (~$2) buys almost nothing.
    /// </remarks>
    public static readonly string[] FactsReReadSources = [WorkdaySource.SourceName];

    private async Task<IReadOnlyList<StoredJobContent>> StoredContentAsync(
        FilterDefinition<BsonDocument> filter, int limit, CancellationToken ct)
    {
        var docs = await _jobs
            .Find(filter)
            .Project(Builders<BsonDocument>.Projection
                .Include(GreenhouseJobFields.SourceJobId)
                .Include(GreenhouseJobFields.Title)
                .Include(GreenhouseJobFields.Company)
                .Include(GreenhouseJobFields.Location)
                .Include(GreenhouseJobFields.Content))
            // Oldest first, so a capped sweep drains the backlog instead of
            // re-reading the same newest page every run.
            .Sort(Builders<BsonDocument>.Sort.Ascending(GreenhouseJobFields.FirstSeenAt))
            .Limit(limit)
            .ToListAsync(ct);

        var result = new List<StoredJobContent>(docs.Count);
        foreach (var d in docs)
        {
            if (!d.TryGetValue(GreenhouseJobFields.SourceJobId, out var id) || !id.IsString) continue;

            // No content, nothing to read. Skipping rather than sending an
            // empty posting to Claude: the call would cost money and return
            // facts about nothing.
            var content = Str(d, GreenhouseJobFields.Content);
            if (string.IsNullOrWhiteSpace(content)) continue;

            result.Add(new StoredJobContent(
                id.AsString,
                Str(d, GreenhouseJobFields.Title) ?? "",
                Str(d, GreenhouseJobFields.Company) ?? "",
                Str(d, GreenhouseJobFields.Location),
                content));
        }

        return result;
    }

    private static string? Str(BsonDocument d, string field) =>
        d.TryGetValue(field, out var v) && v.IsString ? v.AsString : null;

    /// <inheritdoc />
    public Task<IReadOnlyList<StoredJobContent>> StoredContentForAsync(
        string boardKey, IReadOnlyCollection<string> ids, CancellationToken ct) =>
        ids.Count == 0
            ? Task.FromResult<IReadOnlyList<StoredJobContent>>([])
            : StoredContentAsync(
                Builders<BsonDocument>.Filter.And(
                    Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey),
                    Builders<BsonDocument>.Filter.In(GreenhouseJobFields.SourceJobId, ids)),
                ids.Count, ct);

    /// <inheritdoc />
    public async Task MarkAiPendingAsync(
        string boardKey, IReadOnlyCollection<string> ids, string kind, string batchId, CancellationToken ct)
    {
        if (ids.Count == 0) return;
        await _jobs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey),
                Builders<BsonDocument>.Filter.In(GreenhouseJobFields.SourceJobId, ids)),
            Builders<BsonDocument>.Update.Set(PendingField(kind), batchId),
            cancellationToken: ct);
    }

    /// <inheritdoc />
    public async Task ClearAiPendingAsync(
        string boardKey, IReadOnlyCollection<string> ids, string kind, string batchId, CancellationToken ct)
    {
        if (ids.Count == 0) return;
        var field = PendingField(kind);
        await _jobs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey),
                Builders<BsonDocument>.Filter.In(GreenhouseJobFields.SourceJobId, ids),
                // Only this batch's marker. A posting resubmitted since belongs
                // to the newer batch, which clears it when it lands.
                Builders<BsonDocument>.Filter.Eq(field, batchId)),
            Builders<BsonDocument>.Update.Unset(field),
            cancellationToken: ct);
    }

    private static string PendingField(string kind) => kind == AiBatchRecord.Facts
        ? GreenhouseJobFields.AiPendingFacts
        : GreenhouseJobFields.AiPendingParse;

    /// <inheritdoc />
    public async Task<Dictionary<string, StoredFacts>> StoredFactsAsync(
        string boardKey, IReadOnlyCollection<string> ids, CancellationToken ct)
    {
        var result = new Dictionary<string, StoredFacts>(ids.Count);
        if (ids.Count == 0) return result;

        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey),
                Builders<BsonDocument>.Filter.In(GreenhouseJobFields.SourceJobId, ids)))
            .Project(Builders<BsonDocument>.Projection
                .Include(GreenhouseJobFields.SourceJobId)
                .Include(GreenhouseJobFields.ExtractedFunctions)
                .Include(GreenhouseJobFields.ExtractedLocation))
            .ToListAsync(ct);

        foreach (var doc in docs)
        {
            if (!doc.TryGetValue(GreenhouseJobFields.SourceJobId, out var id) || !id.IsString) continue;
            var extracted = doc.TryGetValue(GreenhouseJobFields.Extracted, out var e) && e.IsBsonDocument
                ? e.AsBsonDocument
                : null;
            var functions = extracted is not null && extracted.TryGetValue("functions", out var f) && f.IsBsonArray
                ? f.AsBsonArray.Where(v => v.IsString).Select(v => v.AsString).ToArray()
                : [];
            var location = extracted is not null && extracted.TryGetValue("location", out var l) && l.IsString
                ? l.AsString
                : null;
            result[id.AsString] = new StoredFacts(functions, location);
        }

        return result;
    }

    /// <inheritdoc />
    public async Task<Dictionary<string, long>> OpenCountsByBoardAsync(CancellationToken ct)
    {
        var rows = await _jobs.Aggregate()
            .Match(Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.ClosedAt, BsonNull.Value))
            .Group(new BsonDocument { { "_id", "$" + GreenhouseJobFields.BoardKey }, { "open", new BsonDocument("$sum", 1) } })
            .ToListAsync(ct);

        return rows
            .Where(r => r["_id"].IsString)
            .ToDictionary(r => r["_id"].AsString, r => r["open"].ToInt64());
    }

    /// <inheritdoc />
    public async Task<long> CloseBoardsAsync(IReadOnlyCollection<string> boardKeys, DateTime now, CancellationToken ct)
    {
        if (boardKeys.Count == 0) return 0;

        var result = await _jobs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.In(GreenhouseJobFields.BoardKey, boardKeys),
                // Only open ones: closedAt records when a posting FIRST went.
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.ClosedAt, BsonNull.Value)),
            Builders<BsonDocument>.Update.Set(GreenhouseJobFields.ClosedAt, now),
            cancellationToken: ct);
        return result.ModifiedCount;
    }

    /// <inheritdoc />
    public async Task<long> StampCompanyLogoAsync(string boardKey, string? logoUrl, CancellationToken ct)
    {
        BsonValue value = logoUrl is null ? BsonNull.Value : new BsonString(logoUrl);

        // Only rows that differ, so a stable config writes nothing. $ne matches
        // a missing field too, which is what reaches rows stored before logos
        // existed.
        var result = await _jobs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey),
                Builders<BsonDocument>.Filter.Ne(GreenhouseJobFields.CompanyLogo, value)),
            Builders<BsonDocument>.Update.Set(GreenhouseJobFields.CompanyLogo, value),
            cancellationToken: ct);

        return result.ModifiedCount;
    }

    public async Task<long> CloseMissingAsync(
        string boardKey, IReadOnlyCollection<string> seenIds, int emptyResponseGuardThreshold,
        DateTime now, CancellationToken ct)
    {
        var open = await OpenIdsAsync(boardKey, ct);

        var decision = CloseDiff.Compute(open, seenIds, emptyResponseGuardThreshold);

        if (decision.Skipped)
        {
            _log.LogError(
                "Board {Board}: skipping the close diff -- {Reason}. An empty board is not evidence "
                + "that every stored role closed at once.",
                boardKey, decision.SkipReason);
            return 0;
        }

        var missing = decision.Close;
        if (missing.Count == 0) return 0;

        var result = await _jobs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, boardKey),
                Builders<BsonDocument>.Filter.In(GreenhouseJobFields.SourceJobId, missing),
                // Re-checked rather than trusted from the read above: between
                // that query and this write another run could have closed them,
                // and closedAt must record when a job FIRST went, not the last
                // time a run noticed it was gone.
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.ClosedAt, BsonNull.Value)),
            Builders<BsonDocument>.Update.Set(GreenhouseJobFields.ClosedAt, now),
            cancellationToken: ct);

        if (result.ModifiedCount > 0)
            _log.LogInformation("Board {Board}: closed {Count} job(s) no longer listed (kept, not deleted)",
                boardKey, result.ModifiedCount);

        return result.ModifiedCount;
    }

    /// <summary>
    /// The unique index the upsert depends on, plus the lookup index, and the
    /// old Greenhouse-only pair dropped.
    /// </summary>
    /// <remarks>
    /// The uniqueness of (boardKey, sourceJobId) is what makes re-running
    /// idempotent under concurrency rather than only under good manners: two
    /// consumers handling the same board cannot produce two rows for one job.
    /// The old (boardToken, greenhouseJobId) pair goes in 2c
    /// (docs/plans/key-migration.md): every row has carried the new key since
    /// 2a, and the old unique one would refuse the first non-Greenhouse rows.
    /// </remarks>
    public async Task EnsureIndexesAsync(CancellationToken ct)
    {
        await _jobs.Indexes.CreateManyAsync(
        [
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending(GreenhouseJobFields.BoardKey).Ascending(GreenhouseJobFields.SourceJobId),
                new CreateIndexOptions { Unique = true, Name = "uniq_boardkey_job" }),
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending(GreenhouseJobFields.BoardKey).Ascending(GreenhouseJobFields.ClosedAt),
                new CreateIndexOptions { Name = "idx_boardkey_open" }),
        ], ct);

        await LegacyIndexes.DropIfPresentAsync(_jobs, "uniq_board_job", _log, ct);
        await LegacyIndexes.DropIfPresentAsync(_jobs, "idx_board_open", _log, ct);
    }
}
