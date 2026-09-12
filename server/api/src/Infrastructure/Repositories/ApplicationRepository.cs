using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class ApplicationRepository : IApplicationRepository
{
    private readonly IMongoClient _mongoClient;
    private readonly UserScopedCollection<Application> _applications;
    private readonly UserScopedCollection<Interview> _interviews;
    private readonly UserScopedCollection<Note> _notes;
    private readonly UserScopedCollection<StatusUpdate> _statusUpdates;
    private readonly UserScopedCollection<ResumePack> _resumePacks;

    private static readonly Collation CaseInsensitive = new("en", strength: CollationStrength.Secondary);

    public ApplicationRepository(
        IMongoClient mongoClient,
        UserScopedCollection<Application> applications,
        UserScopedCollection<Interview> interviews,
        UserScopedCollection<Note> notes,
        UserScopedCollection<StatusUpdate> statusUpdates,
        UserScopedCollection<ResumePack> resumePacks)
    {
        _mongoClient = mongoClient;
        _applications = applications;
        _interviews = interviews;
        _notes = notes;
        _statusUpdates = statusUpdates;
        _resumePacks = resumePacks;
    }

    public async Task<(Application Application, bool Created)> CreateAsync(Guid userId, Application app, CancellationToken ct = default)
    {
        var owned = app with { UserId = userId };
        try
        {
            await _applications.InsertOneAsync(userId, owned, ct);
            return (owned, true);
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            var filter = Builders<Application>.Filter.And(
                Builders<Application>.Filter.Eq(a => a.Company, owned.Company),
                Builders<Application>.Filter.Eq(a => a.JobTitle, owned.JobTitle));
            var existing = await _applications
                .Find(userId, filter, new FindOptions { Collation = CaseInsensitive })
                .FirstOrDefaultAsync(ct);

            // A withdrawn/rejected application is a closed chapter, not "still in
            // progress" — a fresh Add for the same (Company, JobTitle) should reopen
            // it with the new job content, not silently hand back the closed record
            // untouched (previously "Add" looked like a no-op: saved_to_tracker flipped
            // client-side, but the tracker kept showing the old closed card).
            if (existing is { Status: ApplicationStatus.Withdrawn or ApplicationStatus.Rejected })
            {
                var revived = owned with { Id = existing.Id };
                await _applications.ReplaceOneAsync(userId, a => a.Id == existing.Id, revived, ct: ct);
                return (revived, true);
            }

            // A concurrent save already inserted this (Company, JobTitle) and it is
            // still active — the unique index rejected ours. Return the winner
            // instead of bubbling an error so the caller stays idempotent.
            return (existing ?? owned, false);
        }
    }

    public async Task<Application?> GetByIdAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        return await _applications.Find(userId, a => a.Id == id).FirstOrDefaultAsync(ct);
    }

    public async Task<List<Application>> GetAllAsync(Guid userId, CancellationToken ct = default)
    {
        return await _applications.FindAll(userId)
            .SortByDescending(a => a.CreatedAt)
            .ToListAsync(ct);
    }

    public async Task<List<ApplicationListItem>> GetAllListItemsAsync(Guid userId, CancellationToken ct = default)
    {
        var projection = Builders<Application>.Projection
            .Include(a => a.Id)
            .Include(a => a.JobTitle)
            .Include(a => a.Company)
            .Include(a => a.Status)
            .Include(a => a.MatchScore)
            .Include(a => a.MatchVerdict)
            .Include(a => a.JobUrl)
            .Include(a => a.CompanyLogo)
            .Include(a => a.CreatedAt)
            .Include(a => a.UpdatedAt)
            .Include(a => a.AppliedAt);

        var items = await _applications.FindAll(userId)
            .SortByDescending(a => a.CreatedAt)
            .Project<ApplicationListItem>(projection)
            .ToListAsync(ct);

        // Enrich with the soonest upcoming interview per application (one extra
        // query over the small set of future, not-completed interviews).
        var now = DateTime.UtcNow;
        var upcoming = await _interviews
            .Find(userId, i => i.ScheduledAt >= now && !i.Completed)
            .ToListAsync(ct);
        if (upcoming.Count > 0)
        {
            var nextByApp = upcoming
                .GroupBy(i => i.ApplicationId)
                .ToDictionary(g => g.Key, g => g.OrderBy(i => i.ScheduledAt).First());

            items = items
                .Select(it => nextByApp.TryGetValue(it.Id, out var next)
                    ? it with { NextInterviewAt = next.ScheduledAt, NextInterviewEndsAt = next.EndsAt, NextInterviewer = next.Interviewer }
                    : it)
                .ToList();
        }

        return await EnrichWithPackStatusAsync(userId, items, ct);
    }

    // Cheap second query over the small resumePacks collection — same shape
    // as the upcoming-interview enrichment above.
    private async Task<List<ApplicationListItem>> EnrichWithPackStatusAsync(Guid userId, List<ApplicationListItem> items, CancellationToken ct)
    {
        var appIds = items.Select(it => it.Id).ToList();
        var packs = await _resumePacks
            .Find(userId, p => appIds.Contains(p.ApplicationId))
            .Project(p => new { p.ApplicationId, p.GeneratedAt })
            .ToListAsync(ct);
        if (packs.Count == 0) return items;

        var packByApp = packs.ToDictionary(p => p.ApplicationId, p => p.GeneratedAt);
        return items
            .Select(it => packByApp.TryGetValue(it.Id, out var generatedAt)
                ? it with { HasPack = true, PackGeneratedAt = generatedAt }
                : it)
            .ToList();
    }

    public async Task<List<Application>> GetByIdsAsync(Guid userId, IEnumerable<Guid> ids, CancellationToken ct = default)
    {
        var filter = Builders<Application>.Filter.In(a => a.Id, ids);
        return await _applications.Find(userId, filter).ToListAsync(ct);
    }

    public async Task<Application> UpdateAsync(Guid userId, Application app, CancellationToken ct = default)
    {
        var owned = app with { UserId = userId };
        await _applications.ReplaceOneAsync(userId, a => a.Id == owned.Id, owned, ct: ct);
        return owned;
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        using var session = await _mongoClient.StartSessionAsync(cancellationToken: ct);
        session.StartTransaction();
        try
        {
            await _interviews.DeleteManyAsync(session, userId, i => i.ApplicationId == id, ct);
            await _notes.DeleteManyAsync(session, userId, n => n.ApplicationId == id, ct);
            await _statusUpdates.DeleteManyAsync(session, userId, s => s.ApplicationId == id, ct);
            await _resumePacks.DeleteManyAsync(session, userId, p => p.ApplicationId == id, ct);
            await _applications.DeleteOneAsync(session, userId, a => a.Id == id, ct);
            await session.CommitTransactionAsync(ct);
        }
        catch
        {
            await session.AbortTransactionAsync(ct);
            throw;
        }
    }

    public async Task<List<ApplicationSummary>> GetAllSummariesAsync(Guid userId, CancellationToken ct = default)
    {
        var projection = Builders<Application>.Projection
            .Include(a => a.Id)
            .Include(a => a.Status)
            .Include(a => a.MatchScore);

        return await _applications.FindAll(userId)
            .Project<ApplicationSummary>(projection)
            .ToListAsync(ct);
    }

    public async Task<bool> ExistsAsync(Guid userId, string company, string jobTitle, CancellationToken ct = default)
    {
        var filter = Builders<Application>.Filter.And(
            Builders<Application>.Filter.Eq(a => a.Company, company),
            Builders<Application>.Filter.Eq(a => a.JobTitle, jobTitle));
        return await _applications.Find(userId, filter, new FindOptions { Collation = CaseInsensitive }).AnyAsync(ct);
    }
}
