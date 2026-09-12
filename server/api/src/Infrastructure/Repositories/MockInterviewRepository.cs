using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class MockInterviewRepository : IMockInterviewRepository
{
    private readonly UserScopedCollection<MockInterviewSession> _sessions;

    public MockInterviewRepository(UserScopedCollection<MockInterviewSession> sessions) => _sessions = sessions;

    public async Task<MockInterviewSession> CreateAsync(Guid userId, MockInterviewSession session, CancellationToken ct = default)
    {
        var owned = session with { UserId = userId };
        await _sessions.InsertOneAsync(userId, owned, ct);
        return owned;
    }

    public async Task<MockInterviewSession?> GetByIdAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        return await _sessions.Find(userId, s => s.Id == id).FirstOrDefaultAsync(ct);
    }

    public async Task<List<MockInterviewSession>> GetAllAsync(Guid userId, CancellationToken ct = default)
    {
        return await _sessions.FindAll(userId)
            .SortByDescending(s => s.CreatedAt)
            .ToListAsync(ct);
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        await _sessions.DeleteOneAsync(userId, s => s.Id == id, ct);
    }
}
