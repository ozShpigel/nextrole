using ApplicationTracker.Core.Models;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

/// <summary>
/// One-shot startup routine that enforces the (Company, JobTitle) uniqueness
/// invariant at the data layer. Without this, the scraper's dedup is a
/// check-then-act race: concurrent scoring of the same posting (which can reach
/// the tracker under several distinct job_urls) all pass the pre-scoring
/// existence check before any sibling is saved, producing duplicate rows.
/// Also ensures ApplicationId lookup indexes (interviews/notes/statusUpdates,
/// previously unindexed collection scans) and the GmailMessageId uniqueness
/// invariant on messages (same check-then-act race as above, since GmailMessageId
/// isn't the collection's _id).
/// </summary>
public static class ApplicationIndexInitializer
{
    private const string UniqueCompanyTitleIndex = "uniq_company_jobtitle_ci";

    // Matches ApplicationRepository.ExistsAsync — strength 2 = case-insensitive,
    // accent-sensitive — so the index treats dedup keys the same way the lookup does.
    private static readonly Collation CaseInsensitive = new("en", strength: CollationStrength.Secondary);

    private const string ApplicationIdIndex = "idx_applicationid";
    private const string UniqueGmailMessageIdIndex = "uniq_gmailmessageid";
    private const string SnapshotTtlIndex = "ttl_createdat_90d";
    private static readonly TimeSpan SnapshotTtl = TimeSpan.FromDays(90);

    public static async Task EnsureIndexesAsync(
        IMongoCollection<Application> applications,
        IMongoCollection<Interview> interviews,
        IMongoCollection<Note> notes,
        IMongoCollection<StatusUpdate> statusUpdates,
        IMongoCollection<TrackedEmail> messages,
        IMongoCollection<MatchSnapshot> matchSnapshots,
        ILogger logger,
        CancellationToken ct = default)
    {
        // Must clear existing duplicates first — a unique index build fails if any remain.
        await RemoveDuplicatesAsync(applications, interviews, notes, statusUpdates, logger, ct);

        var keys = Builders<Application>.IndexKeys
            .Ascending(a => a.Company)
            .Ascending(a => a.JobTitle);
        var model = new CreateIndexModel<Application>(keys, new CreateIndexOptions
        {
            Name = UniqueCompanyTitleIndex,
            Unique = true,
            Collation = CaseInsensitive,
        });

        await applications.Indexes.CreateOneAsync(model, cancellationToken: ct);
        logger.LogInformation(
            "Ensured unique index {Index} on applications(Company, JobTitle)", UniqueCompanyTitleIndex);

        // Every application-detail read fans out into these three collections,
        // each filtered by ApplicationId — was an unindexed collection scan.
        // Non-unique: genuinely one-to-many, unlike resumePacks below.
        await interviews.Indexes.CreateOneAsync(
            new CreateIndexModel<Interview>(Builders<Interview>.IndexKeys.Ascending(i => i.ApplicationId),
                new CreateIndexOptions { Name = ApplicationIdIndex }),
            cancellationToken: ct);
        await notes.Indexes.CreateOneAsync(
            new CreateIndexModel<Note>(Builders<Note>.IndexKeys.Ascending(n => n.ApplicationId),
                new CreateIndexOptions { Name = ApplicationIdIndex }),
            cancellationToken: ct);
        await statusUpdates.Indexes.CreateOneAsync(
            new CreateIndexModel<StatusUpdate>(Builders<StatusUpdate>.IndexKeys.Ascending(s => s.ApplicationId),
                new CreateIndexOptions { Name = ApplicationIdIndex }),
            cancellationToken: ct);
        logger.LogInformation(
            "Ensured index {Index} on interviews/notes/statusUpdates(ApplicationId)", ApplicationIdIndex);

        // NOTE: resumePacks has no ApplicationId index here on purpose — ResumePack.ApplicationId
        // is annotated [BsonId], i.e. it IS the collection's _id, which Mongo already
        // uniquely indexes by default. A second index on the same field would be redundant.

        // GmailMessageId (not the Mongo _id) is TrackedEmailRepository's real
        // dedupe key, but its upsert is a find-then-replace — a genuine
        // check-then-act race without a unique index backing it, unlike the
        // resumePacks case above. Clear pre-existing dupes first, same as applications.
        await RemoveDuplicateMessagesAsync(messages, logger, ct);
        await messages.Indexes.CreateOneAsync(
            new CreateIndexModel<TrackedEmail>(Builders<TrackedEmail>.IndexKeys.Ascending(m => m.GmailMessageId),
                new CreateIndexOptions { Name = UniqueGmailMessageIdIndex, Unique = true }),
            cancellationToken: ct);
        logger.LogInformation(
            "Ensured unique index {Index} on messages(GmailMessageId)", UniqueGmailMessageIdIndex);

        // matchSnapshots is content-addressed (see MatchSnapshot) — a
        // document can outlive every application that ever referenced it
        // (e.g. all of them deleted) with nothing to clean it up. Nothing in
        // this codebase currently reads SnapshotId back for display, so
        // there's no live read path a TTL could break; 90 days bounds growth
        // the same way the scraper's own discovered_jobs TTL does (60 days —
        // longer here since these came from tracked, not just discovered, jobs).
        await matchSnapshots.Indexes.CreateOneAsync(
            new CreateIndexModel<MatchSnapshot>(Builders<MatchSnapshot>.IndexKeys.Ascending(s => s.CreatedAt),
                new CreateIndexOptions { Name = SnapshotTtlIndex, ExpireAfter = SnapshotTtl }),
            cancellationToken: ct);
        logger.LogInformation(
            "Ensured TTL index {Index} on matchSnapshots(CreatedAt), expires after {Days}d", SnapshotTtlIndex, SnapshotTtl.TotalDays);
    }

    private static async Task RemoveDuplicateMessagesAsync(
        IMongoCollection<TrackedEmail> messages, ILogger logger, CancellationToken ct)
    {
        var all = await messages
            .Find(FilterDefinition<TrackedEmail>.Empty)
            .Project(m => new MessageDedupKey(m.Id, m.GmailMessageId, m.CreatedAt))
            .ToListAsync(ct);

        // Keep the earliest-created row per GmailMessageId — mirrors the applications dedup below.
        var dupeIds = all
            .GroupBy(m => m.GmailMessageId)
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

    private sealed record MessageDedupKey(Guid Id, string GmailMessageId, DateTime CreatedAt);

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
            .Project(a => new DedupKey(a.Id, a.Company, a.JobTitle, a.CreatedAt))
            .ToListAsync(ct);

        // Keep the earliest-created row per (company, title); everything newer is a duplicate.
        var dupeIds = all
            .GroupBy(a => (
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

    private sealed record DedupKey(Guid Id, string Company, string JobTitle, DateTime CreatedAt);
}
