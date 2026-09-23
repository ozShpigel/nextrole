using ApplicationTracker.Core.Greenhouse;
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
    /// Content hashes already stored for this board, by Greenhouse job id.
    /// </summary>
    /// <remarks>
    /// Drives the skip: an unchanged hash costs neither an embedding nor a
    /// write. On a stable board this is the difference between re-embedding
    /// every posting daily and embedding nothing at all.
    /// </remarks>
    public async Task<Dictionary<long, string>> StoredHashesAsync(string boardToken, CancellationToken ct)
    {
        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardToken, boardToken))
            .Project(Builders<BsonDocument>.Projection
                .Include(GreenhouseJobFields.GreenhouseJobId).Include(GreenhouseJobFields.ContentHash))
            .ToListAsync(ct);

        var result = new Dictionary<long, string>(docs.Count);
        foreach (var doc in docs)
        {
            if (!doc.TryGetValue(GreenhouseJobFields.GreenhouseJobId, out var id) || !id.IsNumeric) continue;
            result[id.ToInt64()] = doc.TryGetValue(GreenhouseJobFields.ContentHash, out var h) && h.IsString ? h.AsString : "";
        }

        return result;
    }

    /// <summary>Greenhouse job ids this board currently has open (no closedAt).</summary>
    public async Task<HashSet<long>> OpenIdsAsync(string boardToken, CancellationToken ct)
    {
        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardToken, boardToken),
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.ClosedAt, BsonNull.Value)))
            .Project(Builders<BsonDocument>.Projection.Include(GreenhouseJobFields.GreenhouseJobId))
            .ToListAsync(ct);

        return [.. docs
            .Where(d => d.TryGetValue(GreenhouseJobFields.GreenhouseJobId, out var v) && v.IsNumeric)
            .Select(d => d[GreenhouseJobFields.GreenhouseJobId].ToInt64())];
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
    /// The upsert key is (boardToken, greenhouseJobId), backed by a unique
    /// index, so re-running is idempotent by construction rather than by the
    /// caller remembering to check first.
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
                    Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardToken, job.BoardToken),
                    Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.GreenhouseJobId, job.GreenhouseJobId)),
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
        doc.Add(GreenhouseJobFields.Source, "greenhouse");
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
        string boardToken, IReadOnlyCollection<long> ids, string runId, DateTime now, CancellationToken ct)
    {
        if (ids.Count == 0) return 0;

        var result = await _jobs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardToken, boardToken),
                Builders<BsonDocument>.Filter.In(GreenhouseJobFields.GreenhouseJobId, ids.Select(i => (BsonValue)i))),
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
    public async Task<long> SaveIngestAiAsync(
        string boardToken,
        IReadOnlyDictionary<long, BsonDocument> facts,
        IReadOnlyDictionary<long, BsonDocument> parsed,
        string? parseVersion,
        DateTime now,
        CancellationToken ct)
    {
        var ids = facts.Keys.Union(parsed.Keys).ToList();
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

            if (parsed.TryGetValue(id, out var p))
            {
                set.Add(GreenhouseJobFields.Parsed, p);
                set.Add(GreenhouseJobFields.ParsedAt, now);
                set.Add(GreenhouseJobFields.ParsedWith,
                    parseVersion is null ? BsonNull.Value : new BsonString(parseVersion));
            }

            writes.Add(new UpdateOneModel<BsonDocument>(
                Builders<BsonDocument>.Filter.And(
                    Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardToken, boardToken),
                    Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.GreenhouseJobId, id)),
                new BsonDocument
                {
                    { "$set", set },
                    { "$inc", new BsonDocument { { GreenhouseJobFields.ExtractAttempts, 1 } } },
                }));
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
    /// <see cref="CompanyHandler"/>: a throw on fetch never reaches this
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
        string boardToken, int limit, CancellationToken ct)
    {
        // extract_attempts: 0 means nothing has read this posting yet -- the
        // value the initial write sets, and the only thing that distinguishes
        // "never attempted" from "attempted, unchanged since". Open postings
        // only: a closed one is not scored, so reading it would be spend with
        // no consumer.
        var filter = Builders<BsonDocument>.Filter.And(
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardToken, boardToken),
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.ClosedAt, BsonNull.Value),
            Builders<BsonDocument>.Filter.Lte(GreenhouseJobFields.ExtractAttempts, 0));

        var docs = await _jobs
            .Find(filter)
            .Project(Builders<BsonDocument>.Projection
                .Include(GreenhouseJobFields.GreenhouseJobId)
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
            if (!d.TryGetValue(GreenhouseJobFields.GreenhouseJobId, out var id) || !id.IsNumeric) continue;

            // No content, nothing to read. Skipping rather than sending an
            // empty posting to Claude: the call would cost money and return
            // facts about nothing.
            var content = Str(d, GreenhouseJobFields.Content);
            if (string.IsNullOrWhiteSpace(content)) continue;

            result.Add(new StoredJobContent(
                id.ToInt64(),
                Str(d, GreenhouseJobFields.Title) ?? "",
                Str(d, GreenhouseJobFields.Company) ?? "",
                Str(d, GreenhouseJobFields.Location),
                content));
        }

        return result;
    }

    private static string? Str(BsonDocument d, string field) =>
        d.TryGetValue(field, out var v) && v.IsString ? v.AsString : null;

    public async Task<long> CloseMissingAsync(
        string boardToken, IReadOnlyCollection<long> seenIds, int emptyResponseGuardThreshold,
        DateTime now, CancellationToken ct)
    {
        var open = await OpenIdsAsync(boardToken, ct);

        var decision = CloseDiff.Compute(open, seenIds, emptyResponseGuardThreshold);

        if (decision.Skipped)
        {
            _log.LogError(
                "Board {Board}: skipping the close diff -- {Reason}. An empty board is not evidence "
                + "that every stored role closed at once.",
                boardToken, decision.SkipReason);
            return 0;
        }

        var missing = decision.Close;
        if (missing.Count == 0) return 0;

        var result = await _jobs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardToken, boardToken),
                Builders<BsonDocument>.Filter.In(GreenhouseJobFields.GreenhouseJobId, missing.Select(i => (BsonValue)i)),
                // Re-checked rather than trusted from the read above: between
                // that query and this write another run could have closed them,
                // and closedAt must record when a job FIRST went, not the last
                // time a run noticed it was gone.
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.ClosedAt, BsonNull.Value)),
            Builders<BsonDocument>.Update.Set(GreenhouseJobFields.ClosedAt, now),
            cancellationToken: ct);

        if (result.ModifiedCount > 0)
            _log.LogInformation("Board {Board}: closed {Count} job(s) no longer listed (kept, not deleted)",
                boardToken, result.ModifiedCount);

        return result.ModifiedCount;
    }

    /// <summary>
    /// The unique index the upsert depends on, plus the lookup indexes.
    /// </summary>
    /// <remarks>
    /// The uniqueness of (boardToken, greenhouseJobId) is what makes re-running
    /// idempotent under concurrency rather than only under good manners: two
    /// consumers handling the same company cannot produce two rows for one job.
    /// </remarks>
    public async Task EnsureIndexesAsync(CancellationToken ct)
    {
        await _jobs.Indexes.CreateManyAsync(
        [
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending(GreenhouseJobFields.BoardToken).Ascending(GreenhouseJobFields.GreenhouseJobId),
                new CreateIndexOptions { Unique = true, Name = "uniq_board_job" }),
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending(GreenhouseJobFields.BoardToken).Ascending(GreenhouseJobFields.ClosedAt),
                new CreateIndexOptions { Name = "idx_board_open" }),
        ], ct);
    }
}
