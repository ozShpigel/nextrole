using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface ITrackedEmailRepository
{
    // Upsert on (UserId, GmailMessageId) — the mailbot's overlapping sync
    // windows and re-sync's full-history walk both re-see the same email; this
    // keeps re-processing idempotent instead of piling up duplicate rows.
    Task<TrackedEmail> UpsertAsync(Guid userId, TrackedEmail email, CancellationToken ct = default);
    Task<List<TrackedEmail>> GetAllAsync(Guid userId, CancellationToken ct = default);
    // Projection-only — lets the mailbot skip already-processed mail before
    // spending a Claude call on it, without pulling every full document over
    // the wire.
    Task<HashSet<string>> GetGmailMessageIdsAsync(Guid userId, CancellationToken ct = default);
    Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default);
    Task MarkReadAsync(Guid userId, Guid id, CancellationToken ct = default);
}
