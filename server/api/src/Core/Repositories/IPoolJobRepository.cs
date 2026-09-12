using ApplicationTracker.Core.Matching;

namespace ApplicationTracker.Core.Repositories;

// The shared job pool, read-only from the API's side. Deliberately NOT
// user-scoped and deliberately not an IUserOwned collection: the pool is
// common to everyone (docs/job-pool.md), and per-user opinion about a pool job
// lives in jobScores instead.
public interface IPoolJobRepository
{
    /// <summary>
    /// Active pool jobs that pass the cheap pre-filter and are NOT in
    /// <paramref name="excludeJobIds"/>, newest first.
    /// </summary>
    /// <remarks>
    /// The exclusion is part of the query, not a post-filter: the scan is
    /// capped, so without it every scan would return the same first page of
    /// already-scored jobs and a backlog could never drain.
    /// </remarks>
    Task<List<PoolJob>> FindCandidatesAsync(
        CandidateFilter filter, IReadOnlyCollection<string> excludeJobIds, int limit, CancellationToken ct = default);

    Task<List<PoolJob>> GetByIdsAsync(IEnumerable<string> jobIds, CancellationToken ct = default);

    /// <summary>Total active jobs in the pool — the denominator for "n of m considered".</summary>
    Task<long> CountActiveAsync(CancellationToken ct = default);
}
