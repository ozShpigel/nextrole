using ApplicationTracker.Core.Models;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class ApplicationRepository : IApplicationRepository
{
    private readonly IMongoCollection<Application> _applications;
    private readonly IMongoCollection<Interview> _interviews;
    private readonly IMongoCollection<Note> _notes;
    private readonly IMongoCollection<StatusUpdate> _statusUpdates;

    public ApplicationRepository(
        IMongoCollection<Application> applications,
        IMongoCollection<Interview> interviews,
        IMongoCollection<Note> notes,
        IMongoCollection<StatusUpdate> statusUpdates)
    {
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

    public async Task<Application> UpdateAsync(Application app, CancellationToken ct = default)
    {
        await _applications.ReplaceOneAsync(a => a.Id == app.Id, app, cancellationToken: ct);
        return app;
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        await _interviews.DeleteManyAsync(i => i.ApplicationId == id, ct);
        await _notes.DeleteManyAsync(n => n.ApplicationId == id, ct);
        await _statusUpdates.DeleteManyAsync(s => s.ApplicationId == id, ct);
        await _applications.DeleteOneAsync(a => a.Id == id, ct);
    }

    public async Task<bool> ExistsAsync(string company, string jobTitle, CancellationToken ct = default)
    {
        var companyLower = company.ToLowerInvariant();
        var titleLower = jobTitle.ToLowerInvariant();
        return await _applications.Find(a =>
            a.Company.ToLower() == companyLower && a.JobTitle.ToLower() == titleLower)
            .AnyAsync(ct);
    }
}
