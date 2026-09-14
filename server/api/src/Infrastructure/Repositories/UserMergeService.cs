using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

/// <summary>
/// Moves an anonymous account's documents onto the account a Google sign-in
/// proved, and retires the anonymous userId (docs/auth.md, Phase 1.6).
/// </summary>
/// <remarks>
/// No transaction, deliberately. Every step is idempotent by construction —
/// once a step runs, nothing matches the source user any more, so a re-run is a
/// no-op and a half-finished merge is completed rather than corrected. That
/// beats a transaction here because an interrupted transaction unwinds while
/// this resumes, and the realistic failure is a killed process rather than a
/// logical error. It also works identically on a standalone Mongo, so the
/// failure path can be tested outside production.
/// </remarks>
public sealed class UserMergeService
{
    private readonly IMongoDatabase _tracker;
    private readonly IMongoDatabase _profileDb;
    private readonly ILogger<UserMergeService> _log;

    public UserMergeService(IMongoDatabase tracker, IMongoDatabase profileDb, ILogger<UserMergeService> log)
    {
        _tracker = tracker;
        _profileDb = profileDb;
        _log = log;
    }

    // ---- The classification -------------------------------------------------
    //
    // Hand-maintained, and it has to be: only shape (a) is derivable by
    // reflection over IUserOwned, and two of these collections are written by
    // the Python service where no C# test can see them. A collection missing
    // here is data orphaned silently, so MergeAsync ends with a post-condition
    // pass that re-checks every one of them by field AND by _id prefix.

    /// <summary>Plain <c>UserId</c> field. A field update is enough.</summary>
    /// <remarks>
    /// matchSnapshots belongs here and is safe: its _id is a SHA-256 of content
    /// only, with no userId in it, so an update cannot collide.
    /// </remarks>
    public static readonly string[] FieldOwned =
    [
        "applications", "interviews", "notes", "statusUpdates",
        "messages", "matchSnapshots", "resumePacks", "mockInterviewSessions",
    ];

    /// <summary>
    /// <c>_id</c> is <c>"{userId}:{suffix}"</c>, so the userId sits inside an
    /// IMMUTABLE primary key and a field update is NOT enough.
    /// </summary>
    /// <remarks>
    /// Getting this wrong does not look like a failure. JobScore's own comment
    /// says the _id exists "so an upsert cannot create two rows for the same
    /// pair" — leave it stale and the next upsert, which computes the key from
    /// the NEW userId, inserts a second row. poolJobState is worse: its bulk
    /// reads go through the UserId field while its writes upsert on _id, so a
    /// stale row keeps answering queries after a later write has superseded it,
    /// and a job can read as dismissed after being un-dismissed.
    /// </remarks>
    public static readonly string[] CompositeKeyed = ["jobScores", "poolJobState"];

    /// <summary>Scraper-owned, and the field is <c>user_id</c>, not <c>UserId</c>.</summary>
    public const string SnakeCaseOwned = "search_criteria";

    /// <summary>
    /// One document per user, keyed <c>_id = userId</c>. Both sides may hold
    /// one, and only one can survive.
    /// </summary>
    public static readonly (string Collection, bool InProfileDb)[] Singletons =
    [
        ("profile", true),
        ("resumeFile", true),
        ("interviewInsights", false),
    ];

    /// <summary>
    /// Deliberately NOT merged: a daily rate limit, not user data. Merging it
    /// would let someone reset their allowance by signing in.
    /// </summary>
    public static readonly string[] NotMerged = ["userQuotas"];

    private const string Journal = "userMerges";

    public async Task<MergeOutcome> MergeAsync(Guid from, Guid to, CancellationToken ct = default)
    {
        if (from == to) return MergeOutcome.NothingToDo;

        // 1. Fast path. The common case is a visitor who signed in before
        //    doing anything, and it short-circuits the repeat attempt too once
        //    a merge has already drained the source.
        if (!await HasAnythingAsync(from, ct)) return MergeOutcome.NothingToDo;

        // 2. Claim the merge. Same atomic-claim shape as TryLinkAsync: one
        //    winner per source user, the loser reads rather than races.
        var journal = _tracker.GetCollection<BsonDocument>(Journal);
        var claimed = await TryClaimAsync(journal, from, to, ct);
        if (!claimed)
        {
            var existing = await journal.Find(new BsonDocument("_id", from.ToString())).FirstOrDefaultAsync(ct);
            if (existing?.GetValue("CompletedAt", BsonNull.Value) != BsonNull.Value)
                return MergeOutcome.AlreadyDone;
            // In flight elsewhere. Continuing is safe: every operation below is
            // idempotent, so both callers converge on the same result.
            _log.LogInformation("Merge of {From} already in flight; proceeding idempotently", from);
        }

        var counts = new Dictionary<string, long>();

        // 3. Shape (a).
        foreach (var name in FieldOwned)
            counts[name] = await MoveByFieldAsync(_tracker, name, "UserId", from.ToString(), to.ToString(), ct);

        // 4. Shape (c).
        counts[SnakeCaseOwned] =
            await MoveByFieldAsync(_tracker, SnakeCaseOwned, "user_id", from.ToString(), to.ToString(), ct);

        foreach (var name in CompositeKeyed)
            counts[name] = await RekeyAsync(name, from, to, ct);

        // 5. Shape (b). The signed-in account keeps its own; the anonymous one
        //    is parked in place rather than deleted, and reported so the user
        //    is told rather than left to discover it.
        var parked = new List<string>();
        foreach (var (name, inProfileDb) in Singletons)
        {
            var db = inProfileDb ? _profileDb : _tracker;
            if (await MoveSingletonAsync(db, name, from, to, ct) is false) parked.Add(name);
        }

        // 6. Sessions. Repointing rather than deleting is what keeps the user's
        //    other devices signed in — impossible before sessions, when the
        //    cookie described itself.
        counts["sessions"] = await MoveByFieldAsync(
            _tracker, "sessions", "UserId", from.ToString(), to.ToString(), ct);

        // 7. Verify. The classification above is hand-maintained, so this is
        //    what actually stands behind it: a test asserting each collection is
        //    "handled" would have passed while jobScores was handled the wrong
        //    way. Checks by field AND by _id prefix, because the wrong way
        //    leaves the field correct and the key stale.
        var leaks = await FindLeaksAsync(from, ct);
        if (leaks.Count > 0)
        {
            _log.LogError(
                "Merge {From} -> {To} left references behind in: {Leaks}. The collection "
                + "classification in UserMergeService is wrong for these.", from, to, string.Join(", ", leaks));
            throw new InvalidOperationException(
                $"Merge left documents referencing the retired user in: {string.Join(", ", leaks)}");
        }

        await journal.UpdateOneAsync(
            new BsonDocument("_id", from.ToString()),
            new BsonDocument("$set", new BsonDocument
            {
                { "CompletedAt", DateTime.UtcNow },
                { "Counts", new BsonDocument(counts.ToDictionary(k => k.Key, v => (BsonValue)v.Value)) },
                { "ParkedSingletons", new BsonArray(parked) },
            }),
            cancellationToken: ct);

        _log.LogInformation(
            "Merged {From} -> {To}: {Total} documents, parked {Parked}",
            from, to, counts.Values.Sum(), parked.Count == 0 ? "nothing" : string.Join(", ", parked));

        return new MergeOutcome(true, parked, counts);
    }

    // ---- Steps --------------------------------------------------------------

    private async Task<bool> HasAnythingAsync(Guid userId, CancellationToken ct)
    {
        var id = userId.ToString();
        foreach (var name in FieldOwned.Concat(CompositeKeyed))
        {
            if (await _tracker.GetCollection<BsonDocument>(name)
                    .CountDocumentsAsync(new BsonDocument("UserId", id), new CountOptions { Limit = 1 }, ct) > 0)
                return true;
        }
        if (await _tracker.GetCollection<BsonDocument>(SnakeCaseOwned)
                .CountDocumentsAsync(new BsonDocument("user_id", id), new CountOptions { Limit = 1 }, ct) > 0)
            return true;

        foreach (var (name, inProfileDb) in Singletons)
        {
            var db = inProfileDb ? _profileDb : _tracker;
            if (await db.GetCollection<BsonDocument>(name)
                    .CountDocumentsAsync(new BsonDocument("_id", id), new CountOptions { Limit = 1 }, ct) > 0)
                return true;
        }
        return false;
    }

    private static async Task<bool> TryClaimAsync(
        IMongoCollection<BsonDocument> journal, Guid from, Guid to, CancellationToken ct)
    {
        try
        {
            await journal.InsertOneAsync(new BsonDocument
            {
                { "_id", from.ToString() },
                { "ToUserId", to.ToString() },
                { "StartedAt", DateTime.UtcNow },
                { "CompletedAt", BsonNull.Value },
            }, cancellationToken: ct);
            return true;
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            return false;
        }
    }

    // Idempotent by construction: after this runs nothing matches `from`.
    private static async Task<long> MoveByFieldAsync(
        IMongoDatabase db, string collection, string field, string from, string to, CancellationToken ct)
    {
        var result = await db.GetCollection<BsonDocument>(collection).UpdateManyAsync(
            new BsonDocument(field, from),
            new BsonDocument("$set", new BsonDocument(field, to)),
            cancellationToken: ct);
        return result.ModifiedCount;
    }

    /// <summary>
    /// Rebuilds <c>_id</c> for a composite-keyed collection. <c>_id</c> is
    /// immutable, so each row is re-inserted under the new key and the old one
    /// deleted — and a target row may already exist for the same suffix.
    /// </summary>
    private async Task<long> RekeyAsync(string collection, Guid from, Guid to, CancellationToken ct)
    {
        var col = _tracker.GetCollection<BsonDocument>(collection);
        var prefix = from + ":";
        long moved = 0;

        using var cursor = await col.Find(new BsonDocument("_id",
            new BsonDocument("$regex", "^" + Regex(prefix)))).ToCursorAsync(ct);

        while (await cursor.MoveNextAsync(ct))
        {
            foreach (var doc in cursor.Current)
            {
                var oldId = doc["_id"].AsString;
                var suffix = oldId[prefix.Length..];
                var newId = $"{to}:{suffix}";

                var existing = await col.Find(new BsonDocument("_id", newId)).FirstOrDefaultAsync(ct);

                var merged = existing is null
                    ? Reown(doc, newId, to)
                    : Combine(collection, existing, doc);

                await col.ReplaceOneAsync(new BsonDocument("_id", newId), merged,
                    new ReplaceOptions { IsUpsert = true }, ct);
                await col.DeleteOneAsync(new BsonDocument("_id", oldId), ct);
                moved++;
            }
        }
        return moved;
    }

    public static BsonDocument Reown(BsonDocument doc, string newId, Guid to)
    {
        var copy = (BsonDocument)doc.DeepClone();
        copy["_id"] = newId;
        copy["UserId"] = to.ToString();
        return copy;
    }

    /// <summary>Both sides hold a row for the same job.</summary>
    public static BsonDocument Combine(string collection, BsonDocument target, BsonDocument source) =>
        collection switch
        {
            // Union of what the same human did in two sessions. Safe because
            // the two flags are independent and both can already be true at
            // once — clear_saved sets SavedToTracker false without touching
            // Dismissed — so this reaches no state ordinary use cannot.
            "poolJobState" => CombinePoolState(target, source),

            // A score is a point-in-time opinion computed against a profile.
            // The newer one reflects the more recent profile; keeping the older
            // would serve a stale verdict, and rescoring costs a Claude call.
            "jobScores" => Newer(target, source, "ScoredAt"),

            _ => target,
        };

    public static BsonDocument CombinePoolState(BsonDocument target, BsonDocument source)
    {
        var merged = (BsonDocument)target.DeepClone();
        foreach (var flag in new[] { "SavedToTracker", "Dismissed" })
        {
            var either = Truthy(target, flag) || Truthy(source, flag);
            merged[flag] = either;
        }
        if (Time(source, "UpdatedAt") > Time(target, "UpdatedAt"))
            merged["UpdatedAt"] = source["UpdatedAt"];
        return merged;
    }

    public static BsonDocument Newer(BsonDocument target, BsonDocument source, string field) =>
        Time(source, field) > Time(target, field)
            ? Reown(source, target["_id"].AsString, Guid.Parse(target["UserId"].AsString))
            : target;

    private static bool Truthy(BsonDocument d, string f) =>
        d.TryGetValue(f, out var v) && v.IsBoolean && v.AsBoolean;

    private static DateTime Time(BsonDocument d, string f) =>
        d.TryGetValue(f, out var v) && v.IsValidDateTime ? v.ToUniversalTime() : DateTime.MinValue;

    /// <returns>true when the document moved; false when it was parked.</returns>
    private async Task<bool> MoveSingletonAsync(
        IMongoDatabase db, string collection, Guid from, Guid to, CancellationToken ct)
    {
        var col = db.GetCollection<BsonDocument>(collection);
        var source = await col.Find(new BsonDocument("_id", from.ToString())).FirstOrDefaultAsync(ct);
        if (source is null) return true;   // nothing to move, nothing parked

        var targetExists = await col
            .CountDocumentsAsync(new BsonDocument("_id", to.ToString()), new CountOptions { Limit = 1 }, ct) > 0;

        if (targetExists)
        {
            // Conflict. The signed-in account keeps its own, and the anonymous
            // document stays exactly where it is — parked under a userId
            // nobody can reach, rather than deleted. The caller reports it so
            // the user is told rather than left to notice.
            return false;
        }

        // _id is immutable: copy first, delete second. A crash in between
        // leaves the data intact rather than lost — the same ordering
        // UserScopeMigrationInitializer uses.
        var copy = (BsonDocument)source.DeepClone();
        copy["_id"] = to.ToString();
        await col.InsertOneAsync(copy, cancellationToken: ct);
        await col.DeleteOneAsync(new BsonDocument("_id", from.ToString()), ct);
        return true;
    }

    /// <summary>
    /// Anything still naming the retired user, by field or by key prefix.
    /// </summary>
    public async Task<List<string>> FindLeaksAsync(Guid from, CancellationToken ct = default)
    {
        var id = from.ToString();
        var prefixed = new BsonDocument("_id", new BsonDocument("$regex", "^" + Regex(id + ":")));
        var leaks = new List<string>();

        foreach (var name in FieldOwned.Concat(CompositeKeyed).Append("sessions"))
        {
            var col = _tracker.GetCollection<BsonDocument>(name);
            if (await col.CountDocumentsAsync(new BsonDocument("UserId", id), new CountOptions { Limit = 1 }, ct) > 0)
                leaks.Add($"{name}(UserId)");
            if (await col.CountDocumentsAsync(prefixed, new CountOptions { Limit = 1 }, ct) > 0)
                leaks.Add($"{name}(_id)");
        }

        if (await _tracker.GetCollection<BsonDocument>(SnakeCaseOwned)
                .CountDocumentsAsync(new BsonDocument("user_id", id), new CountOptions { Limit = 1 }, ct) > 0)
            leaks.Add($"{SnakeCaseOwned}(user_id)");

        return leaks;
    }

    private static string Regex(string literal) =>
        System.Text.RegularExpressions.Regex.Escape(literal);
}

/// <param name="Merged">False when there was nothing to move.</param>
/// <param name="ParkedSingletons">
/// Collections whose anonymous document could not move because the signed-in
/// account already had one. Left in place, and surfaced to the user — a parked
/// document nobody is told about is silent loss with extra steps.
/// </param>
public sealed record MergeOutcome(
    bool Merged,
    IReadOnlyList<string> ParkedSingletons,
    IReadOnlyDictionary<string, long> Counts)
{
    public static readonly MergeOutcome NothingToDo =
        new(false, [], new Dictionary<string, long>());

    public static readonly MergeOutcome AlreadyDone =
        new(false, [], new Dictionary<string, long>());
}
