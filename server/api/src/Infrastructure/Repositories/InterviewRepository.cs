using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class InterviewRepository : IInterviewRepository
{
    private readonly UserScopedCollection<Interview> _interviews;

    public InterviewRepository(UserScopedCollection<Interview> interviews) => _interviews = interviews;

    public async Task<Interview> CreateAsync(Guid userId, Interview interview, CancellationToken ct = default)
    {
        var owned = interview with { UserId = userId };
        await _interviews.InsertOneAsync(userId, owned, ct);
        return owned;
    }

    public async Task<Interview?> GetByIdAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        return await _interviews.Find(userId, i => i.Id == id).FirstOrDefaultAsync(ct);
    }

    public async Task<List<Interview>> GetByApplicationIdAsync(Guid userId, Guid applicationId, CancellationToken ct = default)
    {
        return await _interviews.Find(userId, i => i.ApplicationId == applicationId)
            .SortBy(i => i.ScheduledAt)
            .ToListAsync(ct);
    }

    public async Task<List<Interview>> GetUpcomingAsync(Guid userId, int count = 5, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        return await _interviews.Find(userId, i => !i.Completed && i.ScheduledAt >= now)
            .SortBy(i => i.ScheduledAt)
            .Limit(count)
            .ToListAsync(ct);
    }

    public async Task<List<Interview>> GetRetrosAsync(Guid userId, CancellationToken ct = default)
    {
        return await _interviews.Find(userId, i => i.Completed && i.RetroRating != null)
            .SortByDescending(i => i.ScheduledAt)
            .ToListAsync(ct);
    }

    public async Task<Interview> UpdateAsync(Guid userId, Interview interview, CancellationToken ct = default)
    {
        var owned = interview with { UserId = userId };
        await _interviews.ReplaceOneAsync(userId, i => i.Id == owned.Id, owned, ct: ct);
        return owned;
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        await _interviews.DeleteOneAsync(userId, i => i.Id == id, ct);
    }
}
