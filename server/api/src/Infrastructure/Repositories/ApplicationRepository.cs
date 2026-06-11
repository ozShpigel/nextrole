using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class ApplicationRepository : IApplicationRepository
{
    private readonly IMongoClient _mongoClient;
    private readonly IMongoCollection<Application> _applications;
    private readonly IMongoCollection<Interview> _interviews;
    private readonly IMongoCollection<Note> _notes;
    private readonly IMongoCollection<StatusUpdate> _statusUpdates;

    private static readonly Collation CaseInsensitive = new("en", strength: CollationStrength.Secondary);

    public ApplicationRepository(
        IMongoClient mongoClient,
        IMongoCollection<Application> applications,
        IMongoCollection<Interview> interviews,
        IMongoCollection<Note> notes,
        IMongoCollection<StatusUpdate> statusUpdates)
    {
        _mongoClient = mongoClient;
        _applications = applications;
        _interviews = interviews;
        _notes = notes;
        _statusUpdates = statusUpdates;
    }

    public async Task<Application> CreateAsync(Application app, CancellationToken ct = default)
    {
        await _applications.InsertOneAsync(app, cancellationToken: ct);
        return app;
    }

    public async Task<Application?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        return await _applications.Find(a => a.Id == id).FirstOrDefaultAsync(ct);
    }

    public async Task<List<Application>> GetAllAsync(CancellationToken ct = default)
    {
        return await _applications.Find(FilterDefinition<Application>.Empty)
            .SortByDescending(a => a.CreatedAt)
            .ToListAsync(ct);
    }

    public async Task<List<ApplicationListItem>> GetAllListItemsAsync(CancellationToken ct = default)
    {
        var projection = Builders<Application>.Projection
            .Include(a => a.Id)
            .Include(a => a.JobTitle)
            .Include(a => a.Company)
            .Include(a => a.Status)
            .Include(a => a.MatchScore)
            .Include(a => a.MatchVerdict)
            .Include(a => a.CreatedAt)
            .Include(a => a.UpdatedAt);

        return await _applications.Find(FilterDefinition<Application>.Empty)
            .SortByDescending(a => a.CreatedAt)
            .Project<ApplicationListItem>(projection)
            .ToListAsync(ct);
    }

    public async Task<List<Application>> GetByIdsAsync(IEnumerable<Guid> ids, CancellationToken ct = default)
    {
        var filter = Builders<Application>.Filter.In(a => a.Id, ids);
        return await _applications.Find(filter).ToListAsync(ct);
    }

    public async Task<Application> UpdateAsync(Application app, CancellationToken ct = default)
    {
        await _applications.ReplaceOneAsync(a => a.Id == app.Id, app, cancellationToken: ct);
        return app;
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        using var session = await _mongoClient.StartSessionAsync(cancellationToken: ct);
        session.StartTransaction();
        try
        {
            await _interviews.DeleteManyAsync(session, i => i.ApplicationId == id, cancellationToken: ct);
            await _notes.DeleteManyAsync(session, n => n.ApplicationId == id, cancellationToken: ct);
            await _statusUpdates.DeleteManyAsync(session, s => s.ApplicationId == id, cancellationToken: ct);
            await _applications.DeleteOneAsync(session, a => a.Id == id, cancellationToken: ct);
            await session.CommitTransactionAsync(ct);
        }
        catch
        {
            await session.AbortTransactionAsync(ct);
            throw;
        }
    }

    public async Task<List<ApplicationSummary>> GetAllSummariesAsync(CancellationToken ct = default)
    {
        var projection = Builders<Application>.Projection
            .Include(a => a.Id)
            .Include(a => a.Status)
            .Include(a => a.MatchScore);

        return await _applications.Find(FilterDefinition<Application>.Empty)
            .Project<ApplicationSummary>(projection)
            .ToListAsync(ct);
    }

    public async Task<bool> ExistsAsync(string company, string jobTitle, CancellationToken ct = default)
    {
        var filter = Builders<Application>.Filter.And(
            Builders<Application>.Filter.Eq(a => a.Company, company),
            Builders<Application>.Filter.Eq(a => a.JobTitle, jobTitle));
        var options = new FindOptions { Collation = CaseInsensitive };
        return await _applications.Find(filter, options).AnyAsync(ct);
    }
}
