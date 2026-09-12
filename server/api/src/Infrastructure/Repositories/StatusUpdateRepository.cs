using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class StatusUpdateRepository : IStatusUpdateRepository
{
    private readonly UserScopedCollection<StatusUpdate> _statusUpdates;

    public StatusUpdateRepository(UserScopedCollection<StatusUpdate> statusUpdates) => _statusUpdates = statusUpdates;

    public async Task<StatusUpdate> CreateAsync(Guid userId, StatusUpdate statusUpdate, CancellationToken ct = default)
    {
        var owned = statusUpdate with { UserId = userId };
        await _statusUpdates.InsertOneAsync(userId, owned, ct);
        return owned;
    }

    public async Task<List<StatusUpdate>> GetByApplicationIdAsync(Guid userId, Guid applicationId, CancellationToken ct = default)
    {
        return await _statusUpdates.Find(userId, s => s.ApplicationId == applicationId)
            .SortBy(s => s.Timestamp)
            .ToListAsync(ct);
    }
}
