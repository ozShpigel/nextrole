using ApplicationTracker.Core.Models;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

/// <summary>
/// One-shot startup routine that enforces the per-user uniqueness invariants at
/// the data layer, and indexes the fields every scoped query now filters on.
/// </summary>
/// <remarks>
/// Uniqueness is per user everywhere: (UserId, Company, JobTitle) for
/// applications and (UserId, GmailMessageId) for messages. The pre-multi-user
/// single-field unique indexes are dropped by name first — leaving one would
/// stop a second user from ever tracking a job someone else already tracked,
/// which is not a duplicate at all.
///
/// Must run AFTER UserScopeMigrationInitializer: a unique index that includes
/// UserId cannot be built while legacy documents still have no UserId (they
/// would all collide on the same empty value).
/// </remarks>
public static class ApplicationIndexInitializer
{
    // Pre-multi-user index names, dropped if still present.
    private const string LegacyUniqueCompanyTitleIndex = "uniq_company_jobtitle_ci";
    private const string LegacyUniqueGmailMessageIdIndex = "uniq_gmailmessageid";
    private const string LegacyApplicationIdIndex = "idx_applicationid";

    private const string UniqueUserCompanyTitleIndex = "uniq_user_company_jobtitle_ci";
    private const string UniqueUserGmailMessageIdIndex = "uniq_user_gmailmessageid";

    // Matches ApplicationRepository.ExistsAsync — strength 2 = case-insensitive,
    // accent-sensitive — so the index treats dedup keys the same way the lookup does.
    private static readonly Collation CaseInsensitive = new("en", strength: CollationStrength.Secondary);

    private const string UserIdIndex = "idx_userid";
    private const string UserApplicationIdIndex = "idx_userid_applicationid";
    private const string SnapshotTtlIndex = "ttl_createdat_90d";
    private static readonly TimeSpan SnapshotTtl = TimeSpan.FromDays(90);

    public static async Task EnsureIndexesAsync(
        IMongoCollection<Application> applications,
        IMongoCollection<Interview> interviews,
        IMongoCollection<Note> notes,
        IMongoCollection<StatusUpdate> statusUpdates,
        IMongoCollection<TrackedEmail> messages,
        IMongoCollection<MatchSnapshot> matchSnapshots,
        IMongoCollection<ResumePack> resumePacks,
        IMongoCollection<MockInterviewSession> mockInterviewSessions,
        ILogger logger,
        CancellationToken ct = default)
    {
        await DropIfExistsAsync(applications, LegacyUniqueCompanyTitleIndex, logger, ct);
        await DropIfExistsAsync(messages, LegacyUniqueGmailMessageIdIndex, logger, ct);
        await DropIfExistsAsync(interviews, LegacyApplicationIdIndex, logger, ct);
        await DropIfExistsAsync(notes, LegacyApplicationIdIndex, logger, ct);
        await DropIfExistsAsync(statusUpdates, LegacyApplicationIdIndex, logger, ct);

        // Must clear existing duplicates first — a unique index build fails if any remain.
        await RemoveDuplicatesAsync(applications, interviews, notes, statusUpdates, logger, ct);

        var keys = Builders<Application>.IndexKeys
            .Ascending(a => a.UserId)
            .Ascending(a => a.Company)
            .Ascending(a => a.JobTitle);
        await applications.Indexes.CreateOneAsync(
            new CreateIndexModel<Application>(keys, new CreateIndexOptions
            {
                Name = UniqueUserCompanyTitleIndex,
                Unique = true,
                Collation = CaseInsensitive,
            }),
            cancellationToken: ct);
        logger.LogInformation(
            "Ensured unique index {Index} on applications(UserId, Company, JobTitle)", UniqueUserCompanyTitleIndex);

        // Every scoped list query filters on UserId alone; the detail fan-out
        // filters on (UserId, ApplicationId). One compound index serves both,
        // since a prefix of a compound index is usable on its own.
        await CreateCompoundAsync(interviews, i => i.UserId, i => i.ApplicationId, ct);
        await CreateCompoundAsync(notes, n => n.UserId, n => n.ApplicationId, ct);
        await CreateCompoundAsync(statusUpdates, s => s.UserId, s => s.ApplicationId, ct);
        await CreateCompoundAsync(resumePacks, p => p.UserId, p => p.ApplicationId, ct);
        logger.LogInformation(
            "Ensured index {Index} on interviews/notes/statusUpdates/resumePacks(UserId, ApplicationId)", UserApplicationIdIndex);

        // applications needs its own plain UserId index: the unique index above
        // is prefixed by UserId but carries a collation, and a plain string
        // equality query (no collation) cannot use a collation index -- a
        // UserId-only list query would fall back to a collection scan.
        await CreateUserIdAsync(applications, a => a.UserId, ct);
        await CreateUserIdAsync(mockInterviewSessions, s => s.UserId, ct);
        await CreateUserIdAsync(matchSnapshots, s => s.UserId, ct);
        logger.LogInformation("Ensured index {Index} on applications/mockInterviewSessions/matchSnapshots(UserId)", UserIdIndex);

        // (UserId, GmailMessageId) — not the Mongo _id — is the real dedupe key
        // in TrackedEmailRepository, and its upsert is a find-then-replace, i.e.
        // a genuine check-then-act race without a unique index behind it. Clear
        // pre-existing dupes first, same as applications.
        await RemoveDuplicateMessagesAsync(messages, logger, ct);
        await messages.Indexes.CreateOneAsync(
            new CreateIndexModel<TrackedEmail>(
                Builders<TrackedEmail>.IndexKeys.Ascending(m => m.UserId).Ascending(m => m.GmailMessageId),
                new CreateIndexOptions { Name = UniqueUserGmailMessageIdIndex, Unique = true }),
            cancellationToken: ct);
        logger.LogInformation(
            "Ensured unique index {Index} on messages(UserId, GmailMessageId)", UniqueUserGmailMessageIdIndex);

        // matchSnapshots is content-addressed (see MatchSnapshot) — a document
        // can outlive every application that ever referenced it (e.g. all of
        // them deleted) with nothing to clean it up. Nothing in this codebase
        // currently reads SnapshotId back for display, so there is no live read
        // path a TTL could break; 90 days bounds growth the same way the
        // scraper's own discovered_jobs TTL does (60 days — longer here since
        // these came from tracked, not just discovered, jobs).
        await matchSnapshots.Indexes.CreateOneAsync(
            new CreateIndexModel<MatchSnapshot>(Builders<MatchSnapshot>.IndexKeys.Ascending(s => s.CreatedAt),
                new CreateIndexOptions { Name = SnapshotTtlIndex, ExpireAfter = SnapshotTtl }),
            cancellationToken: ct);
        logger.LogInformation(
            "Ensured TTL index {Index} on matchSnapshots(CreatedAt), expires after {Days}d", SnapshotTtlIndex, SnapshotTtl.TotalDays);
    }

    private static Task CreateCompoundAsync<T>(
        IMongoCollection<T> collection,
        System.Linq.Expressions.Expression<Func<T, object?>> first,
        System.Linq.Expressions.Expression<Func<T, object?>> second,
        CancellationToken ct) =>
        collection.Indexes.CreateOneAsync(
            new CreateIndexModel<T>(Builders<T>.IndexKeys.Ascending(first).Ascending(second),
                new CreateIndexOptions { Name = UserApplicationIdIndex }),
            cancellationToken: ct);

    private static Task CreateUserIdAsync<T>(
        IMongoCollection<T> collection,
        System.Linq.Expressions.Expression<Func<T, object?>> field,
        CancellationToken ct) =>
        collection.Indexes.CreateOneAsync(
            new CreateIndexModel<T>(Builders<T>.IndexKeys.Ascending(field),
                new CreateIndexOptions { Name = UserIdIndex }),
            cancellationToken: ct);

    private static async Task DropIfExistsAsync<T>(
        IMongoCollection<T> collection, string indexName, ILogger logger, CancellationToken ct)
    {
        try
        {
            await collection.Indexes.DropOneAsync(indexName, ct);
            logger.LogInformation(
                "Dropped pre-multi-user index {Index} on {Collection}",
                indexName, collection.CollectionNamespace.CollectionName);
        }
        catch (MongoCommandException ex) when (ex.Code == 27 || ex.CodeName == "IndexNotFound")
        {
            // Already gone: a fresh database, or a previous startup dropped it.
        }
    }

    private static async Task RemoveDuplicateMessagesAsync(
        IMongoCollection<TrackedEmail> messages, ILogger logger, CancellationToken ct)
    {
        var all = await messages
            .Find(FilterDefinition<TrackedEmail>.Empty)
            .Project(m => new MessageDedupKey(m.Id, m.UserId, m.GmailMessageId, m.CreatedAt))
            .ToListAsync(ct);

        // Keep the earliest-created row per (user, GmailMessageId) — mirrors the
        // applications dedup below. Grouping by user matters: the same Gmail id
        // arriving for two users is not a duplicate.
        var dupeIds = all
            .GroupBy(m => (m.UserId, m.GmailMessageId))
            .Where(g => g.Count() > 1)
            .SelectMany(g => g.OrderBy(m => m.CreatedAt).Skip(1))
            .Select(m => m.Id)
            .ToList();

        if (dupeIds.Count == 0)
        {
            logger.LogInformation("No duplicate messages to remove");
            return;
        }

        logger.LogWarning(
            "Removing {Count} duplicate message(s) before creating unique index", dupeIds.Count);
        await messages.DeleteManyAsync(Builders<TrackedEmail>.Filter.In(m => m.Id, dupeIds), ct);
    }

    private sealed record MessageDedupKey(Guid Id, Guid UserId, string GmailMessageId, DateTime CreatedAt);

    private static async Task RemoveDuplicatesAsync(
        IMongoCollection<Application> applications,
        IMongoCollection<Interview> interviews,
        IMongoCollection<Note> notes,
        IMongoCollection<StatusUpdate> statusUpdates,
        ILogger logger,
        CancellationToken ct)
    {
        var all = await applications
            .Find(FilterDefinition<Application>.Empty)
            .Project(a => new DedupKey(a.Id, a.UserId, a.Company, a.JobTitle, a.CreatedAt))
            .ToListAsync(ct);

        // Keep the earliest-created row per (user, company, title); everything
        // newer is a duplicate. Two users tracking the same job are not.
        var dupeIds = all
            .GroupBy(a => (
                a.UserId,
                (a.Company ?? string.Empty).Trim().ToLowerInvariant(),
                (a.JobTitle ?? string.Empty).Trim().ToLowerInvariant()))
            .Where(g => g.Count() > 1)
            .SelectMany(g => g.OrderBy(a => a.CreatedAt).Skip(1))
            .Select(a => a.Id)
            .ToList();

        if (dupeIds.Count == 0)
        {
            logger.LogInformation("No duplicate applications to remove");
            return;
        }

        logger.LogWarning(
            "Removing {Count} duplicate application(s) before creating unique index", dupeIds.Count);

        await interviews.DeleteManyAsync(Builders<Interview>.Filter.In(i => i.ApplicationId, dupeIds), ct);
        await notes.DeleteManyAsync(Builders<Note>.Filter.In(n => n.ApplicationId, dupeIds), ct);
        await statusUpdates.DeleteManyAsync(Builders<StatusUpdate>.Filter.In(s => s.ApplicationId, dupeIds), ct);
        await applications.DeleteManyAsync(Builders<Application>.Filter.In(a => a.Id, dupeIds), ct);
    }

    private sealed record DedupKey(Guid Id, Guid UserId, string Company, string JobTitle, DateTime CreatedAt);
}
