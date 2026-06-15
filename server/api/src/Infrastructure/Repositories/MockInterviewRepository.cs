using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class MockInterviewRepository : IMockInterviewRepository
{
    private readonly IMongoCollection<MockInterviewSession> _sessions;

    public MockInterviewRepository(IMongoCollection<MockInterviewSession> sessions) => _sessions = sessions;

    public async Task<MockInterviewSession> CreateAsync(MockInterviewSession session, CancellationToken ct = default)
    {
        await _sessions.InsertOneAsync(session, cancellationToken: ct);
        return session;
    }

    public async Task<MockInterviewSession?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        return await _sessions.Find(s => s.Id == id).FirstOrDefaultAsync(ct);
    }

    public async Task<List<MockInterviewSession>> GetAllAsync(CancellationToken ct = default)
    {
        return await _sessions.Find(FilterDefinition<MockInterviewSession>.Empty)
            .SortByDescending(s => s.CreatedAt)
            .ToListAsync(ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        await _sessions.DeleteOneAsync(s => s.Id == id, ct);
    }
}
