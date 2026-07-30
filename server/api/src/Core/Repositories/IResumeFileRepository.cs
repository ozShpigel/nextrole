using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IResumeFileRepository
{
    Task<ResumeFile?> GetAsync(CancellationToken ct = default);
    Task<ResumeFile> UpsertAsync(ResumeFile file, CancellationToken ct = default);
}
