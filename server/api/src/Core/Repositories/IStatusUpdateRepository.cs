using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IStatusUpdateRepository
{
    Task<StatusUpdate> CreateAsync(Guid userId, StatusUpdate statusUpdate, CancellationToken ct = default);
    Task<List<StatusUpdate>> GetByApplicationIdAsync(Guid userId, Guid applicationId, CancellationToken ct = default);
}
