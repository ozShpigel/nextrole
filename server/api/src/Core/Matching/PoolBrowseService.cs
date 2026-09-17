using System.Text.Json;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;

namespace ApplicationTracker.Core.Matching;

public interface IPoolBrowseService
{
    Task<PoolBrowseResult> BrowseAsync(Guid userId, PoolBrowseQuery query, CancellationToken ct = default);
}

/// <summary>
/// The Matches page's data source: this user's scored pool jobs, filtered and
/// ranked.
/// </summary>
/// <remarks>
/// Three collections, and which one leads matters. A score is an opinion about
/// one candidate, so <c>jobScores</c> decides eligibility: a pool job with no
/// row for this user has never been scored for them and must not appear. The
/// pool document then says what the posting is, and <c>poolJobState</c> says
/// what this user has done about it.
///
/// The join is done here rather than in a <c>$lookup</c> because the sort key
/// lives in the joined collection. A user has at most a few hundred scored
/// jobs, so loading their rows and merging in memory is both simpler and
/// cheaper than a pipeline that would have to sort after the lookup anyway.
///
/// Defaults exclude triaged-out and dismissed jobs. Saved jobs stay visible,
/// because "already in my tracker" is not the same signal as "not interested".
/// </remarks>
public sealed class PoolBrowseService : IPoolBrowseService
{
    private readonly IJobScoreRepository _scores;
    private readonly IPoolJobRepository _pool;
    private readonly IPoolJobStateRepository _state;

    public PoolBrowseService(
        IJobScoreRepository scores, IPoolJobRepository pool, IPoolJobStateRepository state)
    {
        _scores = scores;
        _pool = pool;
        _state = state;
    }

    public async Task<PoolBrowseResult> BrowseAsync(
        Guid userId, PoolBrowseQuery query, CancellationToken ct = default)
    {
        query = query.Clamped();
        var empty = new PoolBrowseResult { Limit = query.Limit, Offset = query.Offset };

        // 1. This user's scores decide which pool jobs are eligible at all.
        var scored = (await _scores.GetScoredAsync(userId, query.MinScore, query.Verdicts, ct))
            .ToDictionary(s => s.JobId);
        if (scored.Count == 0) return empty;

        // 2. Saved/dismissed are per-user, so they are applied to this user's
        //    own rows rather than to the shared pool document — which also
        //    keeps the id list handed to Mongo smaller.
        var state = await _state.StateForAsync(userId, scored.Keys, ct);
        var eligible = scored.Keys.Where(jobId =>
        {
            if (!state.TryGetValue(jobId, out var st)) return true;
            if (!query.IncludeDismissed && st.Dismissed == true) return false;
            if (!query.IncludeSaved && st.SavedToTracker == true) return false;
            return true;
        }).ToList();
        if (eligible.Count == 0) return empty;

        // 3. The posting-level filters, against what survived.
        var jobs = await _pool.BrowseAsync(eligible, query, ct);

        // 4. Merge this user's half back in, under the names the client reads.
        var merged = jobs.Select(job =>
        {
            var score = scored.GetValueOrDefault(job.Id);
            var st = state.GetValueOrDefault(job.Id);
            return job with
            {
                Score = score?.Score,
                Verdict = score?.Verdict,
                ShouldApply = score?.ShouldApply,
                MatchAnalysis = ParseAnalysis(score?.MatchAnalysis),
                SavedToTracker = st?.SavedToTracker == true,
                Dismissed = st?.Dismissed == true,
            };
        })
        // Best match first. The sort key is the user's score, which is why this
        // cannot be done in the pool query.
        .OrderByDescending(j => j.Score ?? 0)
        .ToList();

        return new PoolBrowseResult
        {
            Jobs = merged.Skip(query.Offset).Take(query.Limit).ToList(),
            Total = merged.Count,
            Limit = query.Limit,
            Offset = query.Offset,
        };
    }

    /// <summary>
    /// JobScore.MatchAnalysis is stored JSON text; the client expects an
    /// object. Unparseable text yields null rather than throwing — a score row
    /// written by an older shape must not take the whole list down with it.
    /// </summary>
    private static JsonElement? ParseAnalysis(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonDocument.Parse(json).RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
