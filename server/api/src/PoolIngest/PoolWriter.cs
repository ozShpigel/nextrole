using ApplicationTracker.Core.Matching;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.PoolIngest;

/// <summary>
/// The pool's write side: fold a scrape in, and age out what stopped appearing.
/// </summary>
/// <remarks>
/// Shared state, so nothing here is user-scoped and it deliberately does not go
/// through <c>UserScopedCollection</c> — there is no user to scope to. The pool
/// document holds only what is true for everyone.
///
/// Three promises from `docs/job-pool.md` live in this file:
/// a listing is one row across runs (<see cref="PoolKey"/>), its facts are read
/// exactly once on entry, and an absent listing is marked inactive and
/// **never deleted**.
/// </remarks>
public sealed class PoolWriter
{
    private readonly IMongoCollection<BsonDocument> _jobs;
    private readonly ILogger<PoolWriter> _log;

    public PoolWriter(IMongoCollection<BsonDocument> jobs, ILogger<PoolWriter> log)
    {
        _jobs = jobs;
        _log = log;
    }

    /// <summary>Which of these pool keys the collection already holds.</summary>
    public async Task<HashSet<string>> ExistingKeysAsync(IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        if (keys.Count == 0) return [];

        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.In("pool_key", keys.Select(k => (BsonValue)k)))
            .Project(Builders<BsonDocument>.Projection.Include("pool_key"))
            .ToListAsync(ct);

        return docs
            .Where(d => d.TryGetValue("pool_key", out var v) && v.IsString)
            .Select(d => d["pool_key"].AsString)
            .ToHashSet();
    }

    /// <summary>
    /// Mark listings this run saw again. Presence evidence, nothing more —
    /// facts are NOT recomputed, which is the whole point of extracting once.
    /// </summary>
    public async Task<long> TouchAsync(IReadOnlyCollection<string> keys, string runId, DateTime now, CancellationToken ct)
    {
        if (keys.Count == 0) return 0;

        var result = await _jobs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.In("pool_key", keys.Select(k => (BsonValue)k)),
            Builders<BsonDocument>.Update
                .Set("is_active", true)
                // Retired by issue #86 and no longer read. Still reset here so
                // the stale values on existing rows clear themselves as those
                // listings are seen again, rather than sitting there looking
                // like they mean something.
                .Set("missed_runs", 0)
                .Set("last_seen_at", now)
                .Set("last_seen_run_id", runId),
            cancellationToken: ct);

        return result.ModifiedCount;
    }

    /// <summary>
    /// Insert listings entering the pool for the first time.
    /// </summary>
    /// <remarks>
    /// Unordered so one duplicate key — a concurrent run, or a pool_key that
    /// collided — costs that document rather than the rest of the batch.
    /// </remarks>
    public async Task<int> InsertAsync(IReadOnlyList<BsonDocument> docs, CancellationToken ct)
    {
        if (docs.Count == 0) return 0;

        try
        {
            await _jobs.InsertManyAsync(docs, new InsertManyOptions { IsOrdered = false }, ct);
            return docs.Count;
        }
        catch (MongoBulkWriteException<BsonDocument> e)
        {
            var duplicates = e.WriteErrors.Count(w => w.Category == ServerErrorCategory.DuplicateKey);
            var inserted = docs.Count - e.WriteErrors.Count;

            if (e.WriteErrors.Count > duplicates)
                _log.LogError(e, "Pool insert: {Failed} of {Total} documents failed for reasons other than a duplicate key",
                    e.WriteErrors.Count - duplicates, docs.Count);
            else
                _log.LogInformation("Pool insert: {Dup} duplicate key(s) skipped", duplicates);

            return inserted;
        }
    }

    /// <summary>
    /// Jobs seen this run that still have no facts and have attempts left.
    /// </summary>
    /// <remarks>
    /// Only jobs seen in THIS run: a listing that has gone from the boards is
    /// not worth spending a call on. Jobs already at the cap are not selected,
    /// so they cost nothing.
    /// </remarks>
    public async Task<List<BsonDocument>> FactlessAsync(
        IReadOnlyCollection<string> seenKeys, int maxAttempts, CancellationToken ct)
    {
        if (seenKeys.Count == 0) return [];

        return await _jobs
            .Find(Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.In("pool_key", seenKeys.Select(k => (BsonValue)k)),
                Builders<BsonDocument>.Filter.Eq("extracted", BsonNull.Value),
                Builders<BsonDocument>.Filter.Lt("extract_attempts", maxAttempts)))
            .Project(Builders<BsonDocument>.Projection
                .Include("id").Include("title").Include("company")
                .Include("location").Include("description").Include("extract_attempts"))
            .ToListAsync(ct);
    }

    /// <summary>
    /// Record one extraction attempt, storing the facts when they arrived.
    /// </summary>
    /// <remarks>
    /// The counter increments whether or not the call succeeded, so a posting
    /// the model consistently cannot read costs three calls in its lifetime
    /// rather than one a day, forever.
    /// </remarks>
    public Task RecordExtractAttemptAsync(string jobId, BsonDocument? facts, DateTime now, CancellationToken ct)
    {
        var update = Builders<BsonDocument>.Update.Inc("extract_attempts", 1);

        if (facts is not null)
            update = update
                .Set("extracted", facts)
                .Set("extracted_at", now)
                .Set("actual_job_level", facts.GetValue("seniority", BsonNull.Value));

        return _jobs.UpdateOneAsync(Builders<BsonDocument>.Filter.Eq("id", jobId), update, cancellationToken: ct);
    }

    /// <summary>
    /// Deactivate listings that have not been seen for long enough.
    /// </summary>
    /// <remarks>
    /// Keyed on <c>last_seen_at</c>, not a run counter (issue #86). The counter
    /// meant "absent for N runs", which equals "absent for N days" only while
    /// the cron fires exactly once a day. It does not survive contact with
    /// anything else: three manual runs in ninety minutes aged 170 listings as
    /// though three days had passed, and at the time of the fix 66 active rows
    /// sat at <c>missed_runs = 2</c> — one run from deactivation — while every
    /// one of them had been seen within the last day.
    ///
    /// Time is what the field always meant. Keying on it makes the rule
    /// cadence-independent, which unblocks three things at once: running the
    /// ingest more often, seeding a single new role without ageing every other
    /// role's listings, and surviving a blocked scrape — LinkedIn returns
    /// nothing roughly four times a year, and under the counter three such days
    /// in a row would have emptied the pool.
    ///
    /// Nothing is deleted, ever. An inactive job keeps its description, its
    /// facts and its history; it only drops out of the default view, and
    /// <see cref="TouchAsync"/> reactivates it if it reappears.
    ///
    /// Scoped to pool jobs (<c>pool_key</c> present) so criteria-era rows are
    /// left alone.
    /// </remarks>
    public async Task<(long Missed, long Deactivated)> AgeOutAsync(
        IReadOnlyCollection<string> seenKeys, int inactiveAfterDays, CancellationToken ct)
    {
        // Reported, not written. The old code incremented a counter on every
        // absent row -- a bulk write over ~150 documents every run to record
        // something a count already answers.
        var missed = await _jobs.CountDocumentsAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Exists("pool_key"),
                Builders<BsonDocument>.Filter.Nin("pool_key", seenKeys.Select(k => (BsonValue)k)),
                Builders<BsonDocument>.Filter.Eq("is_active", true)),
            cancellationToken: ct);

        var cutoff = DateTime.UtcNow.AddDays(-inactiveAfterDays);
        var deactivated = await _jobs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Exists("pool_key"),
                Builders<BsonDocument>.Filter.Eq("is_active", true),
                // Absent OR null would deactivate a row missing the field. Every
                // pool row has last_seen_at (measured: 550 of 550), and a row
                // that somehow lacked it should be left alone rather than
                // expired on the strength of a missing value.
                Builders<BsonDocument>.Filter.Lt("last_seen_at", cutoff)),
            Builders<BsonDocument>.Update
                .Set("is_active", false)
                .Set("inactive_at", DateTime.UtcNow),
            cancellationToken: ct);

        if (deactivated.ModifiedCount > 0)
            _log.LogInformation(
                "{Count} listing(s) last seen before {Cutoff:u} marked inactive (kept, not deleted)",
                deactivated.ModifiedCount, cutoff);

        return (missed, deactivated.ModifiedCount);
    }
}
