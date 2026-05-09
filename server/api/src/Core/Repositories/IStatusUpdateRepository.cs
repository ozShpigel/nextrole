using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IStatusUpdateRepository
{
    Task<StatusUpdate> CreateAsync(StatusUpdate statusUpdate, CancellationToken ct = default);
    Task<List<StatusUpdate>> GetByApplicationIdAsync(Guid applicationId, CancellationToken ct = default);
}
