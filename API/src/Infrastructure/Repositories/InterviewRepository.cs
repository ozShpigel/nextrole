using ApplicationTracker.Core.Models;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class InterviewRepository : IInterviewRepository
{
    private readonly IMongoCollection<Interview> _interviews;

    public InterviewRepository(IMongoCollection<Interview> interviews) => _interviews = interviews;

    public async Task<Interview> CreateAsync(Interview interview, CancellationToken ct = default)
    {
        await _interviews.InsertOneAsync(interview, cancellationToken: ct);
        return interview;
    }

    public async Task<Interview?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        return await _interviews.Find(i => i.Id == id).FirstOrDefaultAsync(ct);
    }

    public async Task<List<Interview>> GetByApplicationIdAsync(Guid applicationId, CancellationToken ct = default)
    {
        return await _interviews.Find(i => i.ApplicationId == applicationId)
            .SortBy(i => i.ScheduledAt)
            .ToListAsync(ct);
    }

    public async Task<List<Interview>> GetUpcomingAsync(int count = 5, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        return await _interviews.Find(i => !i.Completed && i.ScheduledAt >= now)
            .SortBy(i => i.ScheduledAt)
            .Limit(count)
            .ToListAsync(ct);
    }

    public async Task<Interview> UpdateAsync(Interview interview, CancellationToken ct = default)
    {
        await _interviews.ReplaceOneAsync(i => i.Id == interview.Id, interview, cancellationToken: ct);
        return interview;
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        await _interviews.DeleteOneAsync(i => i.Id == id, ct);
    }
}
