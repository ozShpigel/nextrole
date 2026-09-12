using System.Text.Json;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Core.Matching;

public interface IPoolScanService
{
    Task<PoolScanResult> ScanAsync(Guid userId, CancellationToken ct = default);
}

/// <summary>
/// What happens when a user opens the match tab: narrow the shared pool to a
/// plausible handful, score only the ones this user has never had scored, and
/// keep the results.
/// </summary>
/// <remarks>
/// Nothing is scored at ingest any more, so this is the only thing that spends
/// an Evaluator call on a pool job — and it spends it once per (user, job).
///
/// "Only what is new" is decided by the absence of a jobScores row rather than
/// by a last-visited timestamp. It is the same answer for the common case and
/// a better one for the rest: it also picks up a job that started matching
/// after a profile edit, and it cannot double-charge if two tabs scan at once.
/// </remarks>
public sealed class PoolScanService : IPoolScanService
{
    // The pre-filter is expected to leave tens of jobs, not hundreds. The cap
    // is what stops a first-ever scan (or a profile edit that widens the
    // filter) turning into an unbounded scoring bill in one request; the
    // remainder is picked up by the next visit.
    public const int MaxCandidatesPerScan = 50;
    // Matches the Evaluator's batch size elsewhere in the codebase.
    private const int ScoreBatchSize = 5;

    private static readonly JsonSerializerOptions CamelCase = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly IProfileProvider _profiles;
    private readonly IPoolJobRepository _pool;
    private readonly IJobScoreRepository _scores;
    private readonly IJobMatchService _matcher;
    private readonly ILogger<PoolScanService> _logger;

    public PoolScanService(
        IProfileProvider profiles,
        IPoolJobRepository pool,
        IJobScoreRepository scores,
        IJobMatchService matcher,
        ILogger<PoolScanService> logger)
    {
        _profiles = profiles;
        _pool = pool;
        _scores = scores;
        _matcher = matcher;
        _logger = logger;
    }

    public async Task<PoolScanResult> ScanAsync(Guid userId, CancellationToken ct = default)
    {
        var profileDoc = await _profiles.GetProfileDocumentAsync(userId, ct);
        var structured = profileDoc.Structured;

        // No profile, nothing to score against. Returning empty rather than
        // scoring the pool against a blank profile: that would burn calls to
        // produce meaningless scores, and this is the state every visitor is
        // in before they upload a CV.
        if (structured.Experience.Length == 0 && structured.Skills.Length == 0)
        {
            _logger.LogInformation("Pool scan for {UserId}: no profile yet, nothing scored", userId);
            return new PoolScanResult { ProfileMissing = true, PoolSize = await _pool.CountActiveAsync(ct) };
        }

        var filter = CandidateFilter.FromProfile(structured);

        // Everything already scored for this user is excluded IN the query, so
        // each scan returns work that has not been done. Post-filtering instead
        // would hand back the same capped first page every time and a backlog
        // could never drain.
        var alreadyScored = await _scores.GetAllScoredJobIdsAsync(userId, ct);

        // One over the cap: the extra row is never scored, it only answers
        // "is there more after this page", so Capped can never promise a
        // "score more" that would find nothing to do.
        var fetched = await _pool.FindCandidatesAsync(filter, alreadyScored, MaxCandidatesPerScan + 1, ct);
        var more = fetched.Count > MaxCandidatesPerScan;
        var toScore = more ? fetched.Take(MaxCandidatesPerScan).ToList() : fetched;
        var poolSize = await _pool.CountActiveAsync(ct);

        _logger.LogInformation(
            "Pool scan for {UserId}: {Pool} active, {New} new candidate(s) to score, {Done} already scored, more={More}",
            userId, poolSize, toScore.Count, alreadyScored.Count, more);

        var scored = 0;
        foreach (var batch in Chunk(toScore, ScoreBatchSize))
        {
            ct.ThrowIfCancellationRequested();
            scored += await ScoreBatchAsync(userId, batch, ct);
        }

        return new PoolScanResult
        {
            PoolSize = poolSize,
            Candidates = toScore.Count,
            Scored = scored,
            AlreadyScored = alreadyScored.Count,
            Capped = more,
        };
    }

    private async Task<int> ScoreBatchAsync(Guid userId, List<PoolJob> batch, CancellationToken ct)
    {
        var request = new MatchBatchRequest
        {
            Jobs = batch.Select(j => new MatchBatchItem
            {
                Id = j.Id,
                JobDescription = j.Description ?? "",
                Title = j.Title,
                Company = j.Company,
                Location = j.Location,
                DatePosted = j.DatePosted,
                // Already loaded for the candidate filter; scoring needs the
                // same facts to ground the rationale against the profile.
                MustHaveTech = j.MustHaveTech,
                NiceToHaveTech = j.NiceToHaveTech,
            }).ToList(),
        };

        try
        {
            var response = await _matcher.AnalyzeMatchBatchAsync(userId, request, ct);
            var byId = response.Results.ToDictionary(r => r.Id, r => r.Response);

            var rows = batch.Select(j => byId.TryGetValue(j.Id, out var r)
                ? new JobScore
                {
                    JobId = j.Id,
                    Score = r.OverallScore,
                    Verdict = r.Verdict,
                    ShouldApply = r.Recommendation?.ShouldApply,
                    MatchAnalysis = JsonSerializer.Serialize(r, CamelCase),
                }
                // A job the model did not return a result for still gets a row,
                // carrying the reason. Without it the next visit would re-send
                // the same job and be billed for it again, every time.
                : new JobScore { JobId = j.Id, Error = "no result returned for this job" }).ToList();

            await _scores.UpsertManyAsync(userId, rows, ct);
            return rows.Count(r => r.Score is not null);
        }
        catch (Exception ex)
        {
            // One failed batch must not abandon the scan. The rows record the
            // failure so the jobs are not retried on every single visit.
            _logger.LogError(ex, "Pool scan: scoring a batch of {Count} failed for {UserId}", batch.Count, userId);
            await _scores.UpsertManyAsync(
                userId,
                batch.Select(j => new JobScore { JobId = j.Id, Error = ex.GetType().Name }).ToList(),
                ct);
            return 0;
        }
    }

    private static IEnumerable<List<T>> Chunk<T>(List<T> items, int size)
    {
        for (var i = 0; i < items.Count; i += size)
            yield return items.GetRange(i, Math.Min(size, items.Count - i));
    }
}

public sealed record PoolScanResult
{
    public long PoolSize { get; init; }
    // New candidates this scan took on (already-scored ones never appear).
    public int Candidates { get; init; }
    public int Scored { get; init; }
    // Running total for this user, not a per-scan number.
    public int AlreadyScored { get; init; }
    // The pre-filter returned more than one page could take: the rest is
    // waiting and will be picked up by the next scan. Only ever true when
    // there genuinely is more, so a caller can drive a "score more" control
    // off it without offering a no-op.
    public bool Capped { get; init; }
    public bool ProfileMissing { get; init; }
}
