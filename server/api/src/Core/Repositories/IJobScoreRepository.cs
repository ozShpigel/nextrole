using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IJobScoreRepository
{
    // Every pool job this user has had scored. Read in full because it is
    // the exclusion set for the next scan, and a user has at most a few hundred.
    Task<HashSet<string>> GetAllScoredJobIdsAsync(Guid userId, CancellationToken ct = default);

    // Which of these pool job ids this user has already had scored — the set
    // that must NOT be scored again. Projection only: the scan asks this about
    // a few hundred candidate ids per visit.
    Task<HashSet<string>> GetScoredJobIdsAsync(Guid userId, IEnumerable<string> jobIds, CancellationToken ct = default);
    Task<List<JobScore>> GetByJobIdsAsync(Guid userId, IEnumerable<string> jobIds, CancellationToken ct = default);

    /// <summary>
    /// This user's rows that carry an actual score, optionally narrowed by a
    /// floor and a verdict set. The Matches list starts here, because a pool
    /// job with no row has never been scored for them and must not appear.
    /// </summary>
    /// <remarks>
    /// Rows where scoring failed carry an Error and a null Score. They exist so
    /// the job is not re-scored on every visit, and they are excluded here —
    /// a job nobody could score is not a match.
    /// </remarks>
    Task<List<JobScore>> GetScoredAsync(
        Guid userId, int? minScore, IReadOnlyList<string> verdicts, CancellationToken ct = default);
    // Upsert by (userId, jobId) so a re-scan can never double-insert.
    Task UpsertManyAsync(Guid userId, IReadOnlyList<JobScore> scores, CancellationToken ct = default);
}

public interface IUserQuotaRepository
{
    /// <summary>
    /// Atomically claims one of today's pack allowance. Returns false when the
    /// user has already used <paramref name="dailyLimit"/> today.
    /// </summary>
    Task<bool> TryConsumePackAsync(Guid userId, int dailyLimit, CancellationToken ct = default);
    // For surfacing "n of 3 left" without consuming one.
    Task<int> PacksUsedTodayAsync(Guid userId, CancellationToken ct = default);
}
