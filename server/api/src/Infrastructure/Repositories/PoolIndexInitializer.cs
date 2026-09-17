using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

/// <summary>
/// The shared pool's indexes: identity, presence, and retention.
/// </summary>
/// <remarks>
/// Ported from the scraper's <c>app/indexes.py</c> in Phase 3b of
/// docs/scraper-slimming.md. It runs here rather than in <c>PoolIngest</c>
/// because the API is always up, while the ingest runs for ten minutes a day —
/// and the indexes must exist before either writes.
///
/// Not user-scoped: the pool is shared, so these take a raw collection handle
/// the way <see cref="ApplicationIndexInitializer"/> does. Index creation is
/// one of the two jobs that legitimately span users.
/// </remarks>
public static class PoolIndexInitializer
{
    // ── What is deliberately NOT ported ─────────────────────────────────────
    //
    // `_migrate_pool_job_flags` moved saved_to_tracker/dismissed off the shared
    // pool document into poolJobState, back when one user's dismiss hid a
    // posting for everybody. It is not here because it is finished: measured
    // against production, 42 documents carry a legacy flag and all 42 already
    // have their poolJobState row, so every startup re-upserted the same rows
    // and logged a warning about a migration with nothing left to do.
    //
    // It also attributed those rows to the orphaned-legacy-data user, which on
    // a Cookie deployment is an id nothing reads. Leaving it out loses nothing
    // and stops 42 writes per boot. The source fields stay on the documents, as
    // they always did, so this is still reversible.

    // Retention applies to the criteria-driven path only. An expired POOL
    // listing is marked inactive and never deleted, so pool jobs must not be
    // deletion candidates — and a comment saying so is not a mechanism.
    //
    // Expressed as a POSITIVE marker on the documents that DO expire, because a
    // partial index filter cannot say "field is absent": Mongo allows only
    // $exists:true, $eq, $type, comparisons and $and/$or/$in there, and rejects
    // the $not that "$exists: false" desugars to.
    private const string LegacyTtlIndex = "ttl_discovered_at_45d";
    private const string TtlIndex = "ttl_discovered_at_60d_managed";
    private const int TtlSeconds = 60 * 24 * 3600;

    private const string PoolKeyIndex = "uniq_pool_key";
    private const string PoolActiveIndex = "idx_pool_active";
    private const string PoolStateIndex = "idx_userid_jobid";

    private static readonly BsonDocument TtlPartialFilter = new("ttl_managed", true);

    /// <summary>The pool is unprotected from the retention TTL. Not recoverable in-process.</summary>
    public sealed class TtlRebuildFailedException(string message, Exception? inner = null)
        : Exception(message, inner);

    public static async Task EnsureAsync(
        IMongoCollection<BsonDocument> jobs,
        IMongoCollection<BsonDocument> poolState,
        ILogger logger,
        CancellationToken ct = default)
    {
        await BackfillTtlManagedAsync(jobs, logger, ct);
        await EnsureTtlIndexAsync(jobs, logger, ct);
        await EnsurePoolIndexesAsync(jobs, poolState, logger, ct);
    }

    /// <summary>
    /// Rows written before <c>ttl_managed</c> existed are all criteria-driven,
    /// so they keep expiring. Idempotent; a second run matches nothing.
    /// </summary>
    private static async Task BackfillTtlManagedAsync(
        IMongoCollection<BsonDocument> jobs, ILogger logger, CancellationToken ct)
    {
        try
        {
            var result = await jobs.UpdateManyAsync(
                Builders<BsonDocument>.Filter.And(
                    Builders<BsonDocument>.Filter.Exists("ttl_managed", false),
                    Builders<BsonDocument>.Filter.Exists("pool_key", false)),
                Builders<BsonDocument>.Update.Set("ttl_managed", true),
                cancellationToken: ct);

            if (result.ModifiedCount > 0)
                logger.LogInformation("TTL backfill: marked {Count} pre-existing job(s) as retention-managed",
                    result.ModifiedCount);
        }
        catch (Exception e)
        {
            // Fail-safe, not fail-dangerous: rows without ttl_managed do not
            // match the partial filter, so they stop expiring rather than being
            // deleted. Loud, because retention has silently stopped for them.
            logger.LogError(e, "TTL backfill failed — retention has stopped for un-stamped jobs");
        }
    }

    /// <summary>
    /// Retention: purge criteria-driven jobs after 60 days so the M0 tier never
    /// fills up. Pool jobs opt out.
    /// </summary>
    /// <remarks>
    /// **This one is fatal.** Every other ensure here is best-effort, because a
    /// missing index costs guarantees and speed. That does not transfer to a
    /// TTL index, which DELETES ROWS: while the old unfiltered index is in
    /// place, every shared-pool job is a deletion candidate and "expired
    /// listings are marked inactive, never deleted" is quietly false.
    ///
    /// **It also refuses to start on a drifted expiry** (issue #68). Atlas
    /// `readWrite` does not include `collMod`, so a changed TTL value silently
    /// never applies: the index keeps the old expiry and an ERROR line is the
    /// only trace, while pool documents expire on a schedule nobody chose. The
    /// old code logged and carried on, which made an unappliable change
    /// indistinguishable from an applied one.
    ///
    /// Today desired and actual agree at 60 days, so this changes nothing. It
    /// becomes loud the first time someone edits the constant without the
    /// privilege to apply it — which is exactly when it should.
    /// </remarks>
    private static async Task EnsureTtlIndexAsync(
        IMongoCollection<BsonDocument> jobs, ILogger logger, CancellationToken ct)
    {
        List<BsonDocument> indexes;
        try
        {
            indexes = await (await jobs.Indexes.ListAsync(ct)).ToListAsync(ct);
        }
        catch (Exception e)
        {
            throw new TtlRebuildFailedException("Could not read discovered_jobs indexes", e);
        }

        var existing = indexes.FirstOrDefault(i => i.GetValue("name", "").AsString == TtlIndex);

        if (existing is not null)
        {
            if (!IsPoolExemptTtl(existing))
                // Going down the "already correct" path here would return having
                // done nothing while the old unfiltered index carried on deleting
                // pool jobs — the exact state this exists to prevent. Checking the
                // shape rather than the name is what makes the guarantee real.
                throw new TtlRebuildFailedException(
                    $"Index {TtlIndex} exists with an unexpected shape ({existing}); "
                    + "refusing to assume the pool is protected");

            var actual = existing.GetValue("expireAfterSeconds", BsonNull.Value);
            if (actual.IsNumeric && actual.ToInt32() == TtlSeconds)
                return;   // Correct already. Do not ask for a privilege to change nothing.

            try
            {
                await jobs.Database.RunCommandAsync<BsonDocument>(new BsonDocument
                {
                    { "collMod", jobs.CollectionNamespace.CollectionName },
                    { "index", new BsonDocument { { "name", TtlIndex }, { "expireAfterSeconds", TtlSeconds } } },
                }, cancellationToken: ct);

                logger.LogWarning("TTL expiry changed to {Days} days", TtlSeconds / 86400);
            }
            catch (Exception e)
            {
                throw new TtlRebuildFailedException(
                    $"The TTL expiry should be {TtlSeconds}s but the index has {actual}, and it could "
                    + "not be changed. Atlas readWrite does not include collMod (issue #68), so this "
                    + "change cannot apply and pool documents would expire on a schedule nobody chose. "
                    + "Grant dbAdmin, change the index by hand, or revert the constant.", e);
            }
            return;
        }

        // Create the new one FIRST and drop the old one only once that
        // succeeded: dropping first left the collection with no retention at
        // all when the create then failed.
        try
        {
            await jobs.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("discovered_at"),
                new CreateIndexOptions<BsonDocument>
                {
                    Name = TtlIndex,
                    ExpireAfter = TimeSpan.FromSeconds(TtlSeconds),
                    PartialFilterExpression = TtlPartialFilter,
                }), cancellationToken: ct);
        }
        catch (Exception e)
        {
            throw new TtlRebuildFailedException(
                $"Could not create the pool-exempt TTL index {TtlIndex}", e);
        }

        if (indexes.Any(i => i.GetValue("name", "").AsString == LegacyTtlIndex))
        {
            try
            {
                await jobs.Indexes.DropOneAsync(LegacyTtlIndex, ct);
                logger.LogWarning(
                    "Replaced unfiltered TTL index {Old} with {New} — shared-pool jobs are no longer deletion candidates",
                    LegacyTtlIndex, TtlIndex);
            }
            catch (Exception e)
            {
                // Both indexes now exist. Mongo applies each independently, so
                // the old one still expires pool jobs — same unprotected state.
                throw new TtlRebuildFailedException(
                    $"Created {TtlIndex} but could not drop the old unfiltered {LegacyTtlIndex}, "
                    + "which still deletes pool jobs", e);
            }
        }
    }

    private static bool IsPoolExemptTtl(BsonDocument spec)
    {
        var key = spec.GetValue("key", new BsonDocument()).AsBsonDocument;
        var onDiscoveredAt = key.ElementCount == 1 && key.Contains("discovered_at");
        var filter = spec.GetValue("partialFilterExpression", new BsonDocument()).AsBsonDocument;
        return onDiscoveredAt
            && spec.Contains("expireAfterSeconds")
            && filter.Equals(TtlPartialFilter);
    }

    /// <summary>
    /// Identity and presence indexes for the shared pool, and the per-user
    /// state collection's lookup index.
    /// </summary>
    /// <remarks>
    /// <c>pool_key</c> unique and PARTIAL, so criteria-era rows — which have no
    /// pool_key — are not all collapsed onto a single null. The pool's dedupe is
    /// a real constraint rather than a hopeful check-then-act, so two concurrent
    /// runs cannot insert the same listing twice.
    ///
    /// Best-effort, unlike the TTL: a missing index costs guarantees and speed,
    /// not deletion. But NOT quiet — without uniq_pool_key the dedupe degrades
    /// to a race and the pool fills with duplicates, which looks like a busy job
    /// market rather than a fault.
    /// </remarks>
    private static async Task EnsurePoolIndexesAsync(
        IMongoCollection<BsonDocument> jobs,
        IMongoCollection<BsonDocument> poolState,
        ILogger logger,
        CancellationToken ct)
    {
        try
        {
            await jobs.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("pool_key"),
                new CreateIndexOptions<BsonDocument>
                {
                    Name = PoolKeyIndex,
                    Unique = true,
                    PartialFilterExpression = new BsonDocument("pool_key",
                        new BsonDocument { { "$exists", true }, { "$type", "string" } }),
                }), cancellationToken: ct);

            await jobs.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("is_active").Descending("last_seen_at"),
                new CreateIndexOptions { Name = PoolActiveIndex }), cancellationToken: ct);

            await poolState.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("UserId").Ascending("JobId"),
                new CreateIndexOptions { Name = PoolStateIndex }), cancellationToken: ct);
        }
        catch (Exception e)
        {
            logger.LogError(e,
                "POOL INDEX ENSURE FAILED — {Index} may be missing; pool dedupe is now best-effort "
                + "and duplicate listings can accumulate silently. Fix and restart.", PoolKeyIndex);
        }
    }
}
