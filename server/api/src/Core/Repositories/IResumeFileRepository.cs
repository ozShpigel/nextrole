using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

// One résumé file per user, keyed by userId (ResumeFile.Id IS the userId).
public interface IResumeFileRepository
{
    Task<ResumeFile?> GetAsync(Guid userId, CancellationToken ct = default);
    Task<ResumeFile> UpsertAsync(Guid userId, ResumeFile file, CancellationToken ct = default);
}
