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

    /// <summary>
    /// Every pool job id sharing this posting URL.
    /// </summary>
    /// <remarks>
    /// Plural on purpose: <c>job_url</c> carries no unique index, so a posting
    /// re-scraped under a second <c>pool_key</c> can legitimately have more than
    /// one document. Un-saving has to clear the state on all of them or the
    /// posting stays hidden from Matches after its application is deleted.
    /// </remarks>
    Task<List<string>> FindIdsByJobUrlAsync(string jobUrl, CancellationToken ct = default);

    /// <summary>
    /// Any logo recorded for this company on another posting, newest first.
    /// </summary>
    /// <remarks>
    /// A company's logo does not change between postings, so a job whose own
    /// scrape missed one borrows it rather than saving a permanently blank
    /// tracker row. Case-insensitive exact match on the company name.
    /// </remarks>
    Task<string?> FindCompanyLogoAsync(string company, CancellationToken ct = default);
}
