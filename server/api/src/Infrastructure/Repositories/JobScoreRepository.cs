using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class JobScoreRepository : IJobScoreRepository
{
    private readonly UserScopedCollection<JobScore> _scores;

    public JobScoreRepository(UserScopedCollection<JobScore> scores) => _scores = scores;

    public async Task<HashSet<string>> GetAllScoredJobIdsAsync(Guid userId, CancellationToken ct = default)
    {
        var found = await _scores.FindAll(userId).Project(s => s.JobId).ToListAsync(ct);
        return found.ToHashSet();
    }

    public async Task<HashSet<string>> GetScoredJobIdsAsync(
        Guid userId, IEnumerable<string> jobIds, CancellationToken ct = default)
    {
        var ids = jobIds.ToList();
        if (ids.Count == 0) return new HashSet<string>();
        var found = await _scores
            .Find(userId, Builders<JobScore>.Filter.In(s => s.JobId, ids))
            .Project(s => s.JobId)
            .ToListAsync(ct);
        return found.ToHashSet();
    }

    public async Task<List<JobScore>> GetScoredAsync(
        Guid userId, int? minScore, IReadOnlyList<string> verdicts, CancellationToken ct = default)
    {
        var f = Builders<JobScore>.Filter;
        var clauses = new List<FilterDefinition<JobScore>> { f.Ne(s => s.Score, null) };

        if (minScore is { } floor) clauses.Add(f.Gte(s => s.Score, floor));
        if (verdicts.Count > 0) clauses.Add(f.In(s => s.Verdict, verdicts));

        return await _scores.Find(userId, f.And(clauses)).ToListAsync(ct);
    }

    public async Task<List<JobScore>> GetByJobIdsAsync(
        Guid userId, IEnumerable<string> jobIds, CancellationToken ct = default)
    {
        var ids = jobIds.ToList();
        if (ids.Count == 0) return new List<JobScore>();
        return await _scores
            .Find(userId, Builders<JobScore>.Filter.In(s => s.JobId, ids))
            .ToListAsync(ct);
    }

    public Task UpsertManyAsync(Guid userId, IReadOnlyList<JobScore> scores, CancellationToken ct = default) =>
        _scores.UpsertManyAsync(
            userId,
            scores.Select(s =>
            {
                var owned = s with { UserId = userId, Id = JobScore.KeyFor(userId, s.JobId) };
                return ((FilterDefinition<JobScore>)Builders<JobScore>.Filter.Eq(x => x.JobId, owned.JobId), owned);
            }),
            ct);
}
