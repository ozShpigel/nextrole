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

    /// <summary>
    /// How many candidates one scan may pay to score, from THIS source.
    /// </summary>
    /// <remarks>
    /// On the source rather than on the scan because the right number follows
    /// from how <see cref="FindCandidatesAsync"/> chooses what it returns, and
    /// the two implementations choose differently: a Mongo field filter hands
    /// back everything that survived it, unranked, so the cap is only a spend
    /// ceiling and wants to be generous; a vector search hands back a ranked
    /// list, where the useful answer is the top few and the tail is noise the
    /// scan would pay Claude to reject.
    ///
    /// Keeping it here means the source switch moves the cap with it. A single
    /// value shared by both would be right for at most one of them, and wrong
    /// silently -- an over-generous cap on the ranked source shows up as a
    /// scoring bill, not as an error.
    /// </remarks>
    int MaxCandidatesPerScan { get; }

    Task<List<PoolJob>> GetByIdsAsync(IEnumerable<string> jobIds, CancellationToken ct = default);

    /// <summary>Total active jobs in the pool — the denominator for "n of m considered".</summary>
    Task<long> CountActiveAsync(CancellationToken ct = default);

    /// <summary>
    /// The Matches page's filtered read over a candidate id set.
    /// </summary>
    /// <remarks>
    /// Takes the ids rather than finding them, because eligibility is decided
    /// by this user's <c>jobScores</c> rows — a pool job with no row has never
    /// been scored for them and must not appear. The caller narrows first and
    /// this applies the posting-level filters to what is left.
    /// </remarks>
    Task<List<PoolJobListItem>> BrowseAsync(
        IReadOnlyCollection<string> jobIds, PoolBrowseQuery query, CancellationToken ct = default);

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

    /// <summary>
    /// Store parses made while scoring, so the next user to score the posting
    /// reuses them. Never replaces a parse already stored.
    /// </summary>
    /// <remarks>
    /// A no-op by default: only a source whose ingest leaves the parse to the
    /// first scorer needs it (Greenhouse, with ParseAtIngest off). The LinkedIn
    /// pool parses at ingest and keeps this default.
    /// </remarks>
    Task<int> SaveParsesAsync(
        IReadOnlyDictionary<string, ParsedJob> parses, string? parseVersion, CancellationToken ct = default) =>
        Task.FromResult(0);
}
