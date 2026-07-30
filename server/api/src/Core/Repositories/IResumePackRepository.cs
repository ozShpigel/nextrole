using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IResumePackRepository
{
    Task<ResumePack?> GetByApplicationIdAsync(Guid applicationId, CancellationToken ct = default);
    Task<ResumePack> UpsertAsync(ResumePack pack, CancellationToken ct = default);
}
