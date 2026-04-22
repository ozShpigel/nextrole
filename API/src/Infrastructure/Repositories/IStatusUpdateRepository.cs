using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Infrastructure.Repositories;

public interface IStatusUpdateRepository
{
    Task<StatusUpdate> CreateAsync(StatusUpdate statusUpdate, CancellationToken ct = default);
    Task<List<StatusUpdate>> GetByApplicationIdAsync(Guid applicationId, CancellationToken ct = default);
}
