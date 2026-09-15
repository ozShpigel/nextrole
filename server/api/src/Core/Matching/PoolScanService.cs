using System.Collections.Concurrent;
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
/// after a profile edit, and a scan cut short still keeps every row it paid for.
///
/// On its own that does NOT stop two overlapping scans paying twice for the
/// same job: the exclusion set is read before any batch has written, so both
/// read it identically and take the same candidates. The per-user gate at the
/// top of ScanAsync is what prevents that.
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
    // Batches run concurrently. One batch is an Analyst call and an Evaluator
    // call back to back, measured at ~80s over 51 real batches — so ten of them
    // in sequence is thirteen minutes, which no synchronous HTTP request
    // survives (nginx's default proxy_read_timeout is 60s, and the browser gave
    // up long before the work did). Five at a time puts a full scan at roughly
    // two rounds. The scraper's own ingest path has had the same guardrail
    // since it was batching: MAX_CONCURRENT_SCORE_BATCHES.
    private const int MaxConcurrentBatches = 5;

    private static readonly JsonSerializerOptions CamelCase = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    // One scan per user at a time -- see ScanAsync. Static because the service
    // is registered Scoped, so a per-instance field would gate nothing.
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> ScanGates = new();

    private readonly IProfileProvider _profiles;
    private readonly IPoolJobRepository _pool;
    private readonly IJobScoreRepository _scores;
    private readonly IJobMatchService _matcher;
    private readonly IMatchSnapshotRepository _snapshots;
    private readonly ILogger<PoolScanService> _logger;

    public PoolScanService(
        IProfileProvider profiles,
        IPoolJobRepository pool,
        IJobScoreRepository scores,
        IJobMatchService matcher,
        IMatchSnapshotRepository snapshots,
        ILogger<PoolScanService> logger)
    {
        _profiles = profiles;
        _pool = pool;
        _scores = scores;
        _matcher = matcher;
        _snapshots = snapshots;
        _logger = logger;
    }

    public async Task<PoolScanResult> ScanAsync(Guid userId, CancellationToken ct = default)
    {
        // The exclusion set below is read once, before any batch has written its
        // rows, so two scans for one user that overlap -- two tabs, or a refresh
        // part-way through a scan that runs for minutes -- read an identical set,
        // take the same candidates, and pay Claude twice for them. The stored
        // rows still come out right (JobScore's _id is deterministic, so the
        // second write overwrites the first); the spend does not.
        //
        // WaitAsync(0) rather than queueing: a scan is minutes long, and holding
        // the second request open behind it would hit nginx's proxy_read_timeout.
        // The caller is told a scan is running and can read the rows it writes.
        //
        // Per-process, which matches the deployment (one API container per
        // instance). A multi-instance deployment would need the claim to live in
        // Mongo instead, the way UserQuotaRepository claims a pack allowance.
        // Gates are kept once created rather than removed when idle: a
        // SemaphoreSlim per user ever seen is small, and removing one safely
        // would need a second lock to close the create/dispose race.
        var gate = ScanGates.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
        if (!await gate.WaitAsync(0, ct))
        {
            _logger.LogInformation(
                "Pool scan for {UserId}: one is already running, not starting a second", userId);
            return new PoolScanResult
            {
                ScanInProgress = true,
                PoolSize = await _pool.CountActiveAsync(ct),
            };
        }

        try
        {
            return await ScanCoreAsync(userId, ct);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<PoolScanResult> ScanCoreAsync(Guid userId, CancellationToken ct)
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

        var batches = Chunk(toScore, ScoreBatchSize).ToList();
        var perBatch = new int[batches.Count];
        using var gate = new SemaphoreSlim(MaxConcurrentBatches);
        await Task.WhenAll(batches.Select(async (batch, i) =>
        {
            await gate.WaitAsync(ct);
            try
            {
                // Each batch upserts its own rows as it finishes, so a scan cut
                // short still keeps what it paid for.
                perBatch[i] = await ScoreBatchAsync(userId, batch, ct);
            }
            finally
            {
                gate.Release();
            }
        }));
        var scored = perBatch.Sum();

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
                // The ingest's parse when there is one. Null falls through to
                // an inline Analyst call for that job only — today's behaviour,
                // so a cache miss is never worse than no cache.
                Parsed = j.Parsed,
            }).ToList(),
        };

        try
        {
            var response = await _matcher.AnalyzeMatchBatchAsync(userId, request, ct);
            var byId = response.Results.ToDictionary(r => r.Id, r => r.Response);

            // Persist the batch's raw call text ONCE, content-addressed, before
            // building the rows. matchSnapshots was written only from the Add
            // path, so a job that was scored and never added — 98% of them —
            // had no debugging trail outside the copy embedded in every
            // jobScores row. Keying by content hash means the five rows of a
            // batch collapse to one stored document instead of five copies of
            // the same text.
            //
            // Best-effort: a snapshot is a debugging artifact and must never
            // cost a scan the scores it already paid for.
            var first = response.Results.Count > 0 ? response.Results[0].Response : null;
            if (first is not null)
            {
                try
                {
                    await _snapshots.UpsertAsync(
                        userId, first.AnalystSnapshotInput, first.AnalystSnapshotOutput,
                        first.EvaluatorSnapshotInput, first.EvaluatorSnapshotOutput, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Pool scan: storing the batch snapshot failed for {UserId}", userId);
                }
            }

            var rows = batch.Select(j => byId.TryGetValue(j.Id, out var r)
                ? new JobScore
                {
                    JobId = j.Id,
                    Score = r.OverallScore,
                    Verdict = r.Verdict,
                    ShouldApply = r.Recommendation?.ShouldApply,
                    MatchAnalysis = JsonSerializer.Serialize(WithoutSnapshots(r), CamelCase),
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

    /// <summary>
    /// The response minus the four raw Claude call transcripts.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Those four fields were 88% of this collection by size, and stored 4.7x
    /// over: every row in a batch carried its own copy of the SAME shared
    /// request and response text, and the Evaluator's request embeds the full
    /// 27,595-character system prompt. Measured on the live collection, a
    /// jobScores row averaged 135 KB, of which roughly 119 KB was transcript.
    /// </para>
    /// <para>
    /// They are debugging artifacts and nothing renders them — the client
    /// declares the fields on its Application type and never reads them. They
    /// now go to matchSnapshots, which is content-addressed (so a batch stores
    /// one copy, not five) and TTL'd at 90 days. Retention is therefore no
    /// longer permanent, which is the point: permanent retention of debugging
    /// artifacts is how this collection got to 88%.
    /// </para>
    /// <para>
    /// Import Job has done exactly this since it shipped (main.py strips the
    /// same four keys before storing analysis_json and passes the transcripts
    /// separately) — the scan was the path that never caught up.
    /// </para>
    /// </remarks>
    private static MatchResponse WithoutSnapshots(MatchResponse r) => r with
    {
        AnalystSnapshotInput = null,
        AnalystSnapshotOutput = null,
        EvaluatorSnapshotInput = null,
        EvaluatorSnapshotOutput = null,
    };

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
    // A scan for this user was already running, so this request scored nothing
    // rather than paying a second time for the same jobs. Not an error: the
    // scan in flight is writing rows the caller can read.
    public bool ScanInProgress { get; init; }
}
