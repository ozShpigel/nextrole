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
/// </summary>
public static class ApplicationIndexInitializer
{
    private const string UniqueCompanyTitleIndex = "uniq_company_jobtitle_ci";

    // Matches ApplicationRepository.ExistsAsync — strength 2 = case-insensitive,
    // accent-sensitive — so the index treats dedup keys the same way the lookup does.
    private static readonly Collation CaseInsensitive = new("en", strength: CollationStrength.Secondary);

    public static async Task EnsureIndexesAsync(
        IMongoCollection<Application> applications,
        IMongoCollection<Interview> interviews,
        IMongoCollection<Note> notes,
        IMongoCollection<StatusUpdate> statusUpdates,
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
    }

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
