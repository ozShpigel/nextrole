using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface ITrackedEmailRepository
{
    // Upsert on GmailMessageId — the mailbot's overlapping sync windows and
    // re-sync's full-history walk both re-see the same email; this keeps
    // re-processing idempotent instead of piling up duplicate rows.
    Task<TrackedEmail> UpsertAsync(TrackedEmail email, CancellationToken ct = default);
    Task<List<TrackedEmail>> GetAllAsync(CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task MarkReadAsync(Guid id, CancellationToken ct = default);
}
