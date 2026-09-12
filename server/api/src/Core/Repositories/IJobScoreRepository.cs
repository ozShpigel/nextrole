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
