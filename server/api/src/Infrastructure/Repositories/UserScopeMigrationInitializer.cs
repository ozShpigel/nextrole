using MongoDB.Bson;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

/// <summary>
/// Moves pre-multi-user documents onto a real owner. Nothing is deleted.
/// </summary>
/// <remarks>
/// Two shapes need migrating:
///
/// 1. Collections that gained a UserId field — every document written before
///    multi-user has none, and would otherwise deserialize as Guid.Empty and
///    belong to nobody. They are stamped with the legacy owner.
///
/// 2. Documents that WERE fixed singletons and are now keyed by _id = userId:
///    the profile (a field `id` of "default"), resumeFile and interviewInsights
///    (_id of "current"). _id is immutable, so these are re-inserted under the
///    new key and the old document removed — copy first, delete second, so a
///    crash in between leaves the data intact rather than lost.
///
/// The legacy owner is whoever this instance already served: its configured
/// fixed user on the private deployment, the demo persona on the public one.
/// Idempotent — a second run finds nothing to do.
/// </remarks>
public static class UserScopeMigrationInitializer
{
    private const string LegacyProfileDocId = "default";
    private const string LegacySingletonId = "current";

    private static readonly string[] ScopedCollections =
    {
        "applications", "interviews", "notes", "statusUpdates",
        "messages", "matchSnapshots", "resumePacks", "mockInterviewSessions",
    };

    // Mongo can genuinely be a few seconds behind the API at boot (container
    // start order, an Atlas failover), so a connection-level failure is retried
    // rather than treated as fatal on the first try.
    private const int MaxAttempts = 5;
    private static readonly TimeSpan FirstRetryDelay = TimeSpan.FromSeconds(1);

    /// <summary>
    /// Runs the migration, retrying transient connection failures. Throws if it
    /// still cannot complete.
    /// </summary>
    /// <remarks>
    /// Deliberately fatal. Every other bad state in the identity path throws at
    /// startup (Fixed mode with no FixedUserId, an invalid IDENTITY_MODE), and
    /// this is the one that decides who owns existing data -- an API that could
    /// not migrate should not serve requests. Crashing hands the problem to the
    /// orchestrator, which restarts; continuing would serve users a view of the
    /// database that does not match what is in it.
    ///
    /// Only connection-level failures are retried. A deterministic failure (a
    /// duplicate key, a schema surprise) fails immediately: retrying cannot fix
    /// it, and the sooner it is visible the better.
    /// </remarks>
    public static async Task MigrateOrThrowAsync(
        IMongoClient client,
        string trackerDatabaseName,
        string profileDatabaseName,
        Guid legacyOwnerUserId,
        ILogger logger,
        CancellationToken ct = default)
    {
        var delay = FirstRetryDelay;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await MigrateAsync(client, trackerDatabaseName, profileDatabaseName, legacyOwnerUserId, logger, ct);
                return;
            }
            catch (Exception ex) when (IsTransient(ex) && attempt < MaxAttempts)
            {
                logger.LogWarning(ex,
                    "User-scope migration attempt {Attempt}/{Max} could not reach Mongo; retrying in {Delay}",
                    attempt, MaxAttempts, delay);
                await Task.Delay(delay, ct);
                delay += delay;
            }
        }
    }

    private static bool IsTransient(Exception ex) => ex switch
    {
        MongoConnectionException => true,
        MongoNotPrimaryException => true,
        MongoNodeIsRecoveringException => true,
        // Server selection gives up as a plain TimeoutException.
        TimeoutException => true,
        MongoException m => m.HasErrorLabel("TransientTransactionError"),
        _ => false,
    };

    public static async Task MigrateAsync(
        IMongoClient client,
        string trackerDatabaseName,
        string profileDatabaseName,
        Guid legacyOwnerUserId,
        ILogger logger,
        CancellationToken ct = default)
    {
        var owner = legacyOwnerUserId.ToString();
        var tracker = client.GetDatabase(trackerDatabaseName);
        var profileDb = client.GetDatabase(profileDatabaseName);

        foreach (var name in ScopedCollections)
        {
            var col = tracker.GetCollection<BsonDocument>(name);
            var result = await col.UpdateManyAsync(
                Builders<BsonDocument>.Filter.Exists("UserId", false),
                Builders<BsonDocument>.Update.Set("UserId", owner),
                cancellationToken: ct);
            if (result.ModifiedCount > 0)
                logger.LogWarning(
                    "User-scope migration: stamped {Count} unowned document(s) in {Collection} with user {UserId}",
                    result.ModifiedCount, name, owner);
        }

        await RekeyAsync(profileDb.GetCollection<BsonDocument>("profile"), "id", LegacyProfileDocId, owner, logger, ct);
        await RekeyAsync(profileDb.GetCollection<BsonDocument>("resumeFile"), "_id", LegacySingletonId, owner, logger, ct);
        await RekeyAsync(tracker.GetCollection<BsonDocument>("interviewInsights"), "_id", LegacySingletonId, owner, logger, ct);
    }

    // Copies the old singleton document to _id = owner, then drops the old one.
    // No-op when the old document is gone (already migrated, or a fresh DB) or
    // when a document already sits under the new key — never overwrite live
    // per-user data with a stale singleton.
    private static async Task RekeyAsync(
        IMongoCollection<BsonDocument> collection,
        string legacyKeyField,
        string legacyKeyValue,
        string owner,
        ILogger logger,
        CancellationToken ct)
    {
        var name = collection.CollectionNamespace.CollectionName;
        var legacy = await collection
            .Find(Builders<BsonDocument>.Filter.Eq(legacyKeyField, legacyKeyValue))
            .FirstOrDefaultAsync(ct);
        if (legacy is null) return;

        var alreadyMigrated = await collection
            .Find(Builders<BsonDocument>.Filter.Eq("_id", owner))
            .AnyAsync(ct);
        if (alreadyMigrated)
        {
            logger.LogWarning(
                "User-scope migration: {Collection} already has a document for {UserId}; leaving the legacy {Field}={Value} row in place rather than overwriting it",
                name, owner, legacyKeyField, legacyKeyValue);
            return;
        }

        var migrated = (BsonDocument)legacy.DeepClone();
        migrated["_id"] = owner;
        // The profile document carried its key in a plain `id` field alongside
        // an ObjectId _id; that field has no meaning now the _id is the userId.
        migrated.Remove("id");

        await collection.InsertOneAsync(migrated, cancellationToken: ct);
        await collection.DeleteOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", legacy["_id"]), ct);

        logger.LogWarning(
            "User-scope migration: re-keyed the {Collection} singleton ({Field}={Value}) onto user {UserId}",
            name, legacyKeyField, legacyKeyValue, owner);
    }
}
