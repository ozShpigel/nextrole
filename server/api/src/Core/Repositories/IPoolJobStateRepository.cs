using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

/// <summary>
/// Per-user state over the shared job pool: saved, dismissed, viewed.
/// </summary>
/// <remarks>
/// User-scoped, unlike <see cref="IPoolJobRepository"/>: the pool document says
/// what a posting is, this says what one person has done about it. Every method
/// therefore takes the userId, and the implementation reaches Mongo through
/// <c>UserScopedCollection</c>, which has no overload that omits it.
///
/// That structural guarantee is the point of moving this off the scraper, where
/// scoping was a convention each query had to remember — and where one query
/// already did not (`orchestrator.py` looked a document up by id alone).
/// </remarks>
public interface IPoolJobStateRepository
{
    /// <summary>Has this user already added this job to their tracker?</summary>
    Task<bool> IsSavedAsync(Guid userId, string jobId, CancellationToken ct = default);

    Task MarkSavedAsync(Guid userId, string jobId, CancellationToken ct = default);

    Task MarkDismissedAsync(Guid userId, string jobId, CancellationToken ct = default);

    /// <summary>
    /// Record the FIRST time this user opened the job's detail panel. Later
    /// calls must not move the timestamp, so the client may call it on every
    /// selection without guarding.
    /// </summary>
    Task MarkViewedAsync(Guid userId, string jobId, CancellationToken ct = default);

    /// <summary>
    /// Reverse of <see cref="MarkSavedAsync"/> for these jobs, for this user
    /// only — other users who saved the same posting keep their own row.
    /// Returns how many rows changed.
    /// </summary>
    Task<long> ClearSavedAsync(Guid userId, IReadOnlyCollection<string> jobIds, CancellationToken ct = default);

    /// <summary>
    /// State for the jobs asked about, keyed by jobId. A job this user has
    /// never touched has no row and is simply absent from the result.
    /// </summary>
    Task<Dictionary<string, PoolJobState>> StateForAsync(
        Guid userId, IReadOnlyCollection<string> jobIds, CancellationToken ct = default);
}
