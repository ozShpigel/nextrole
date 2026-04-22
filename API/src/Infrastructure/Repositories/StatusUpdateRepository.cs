using ApplicationTracker.Core.Models;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class StatusUpdateRepository : IStatusUpdateRepository
{
    private readonly IMongoCollection<StatusUpdate> _statusUpdates;

    public StatusUpdateRepository(IMongoCollection<StatusUpdate> statusUpdates) => _statusUpdates = statusUpdates;

    public async Task<StatusUpdate> CreateAsync(StatusUpdate statusUpdate, CancellationToken ct = default)
    {
        await _statusUpdates.InsertOneAsync(statusUpdate, cancellationToken: ct);
        return statusUpdate;
    }

    public async Task<List<StatusUpdate>> GetByApplicationIdAsync(Guid applicationId, CancellationToken ct = default)
    {
        return await _statusUpdates.Find(s => s.ApplicationId == applicationId)
            .SortBy(s => s.Timestamp)
            .ToListAsync(ct);
    }
}
