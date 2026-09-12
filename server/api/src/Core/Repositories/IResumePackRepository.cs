using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IResumePackRepository
{
    Task<ResumePack?> GetByApplicationIdAsync(Guid userId, Guid applicationId, CancellationToken ct = default);
    Task<ResumePack> UpsertAsync(Guid userId, ResumePack pack, CancellationToken ct = default);
}
