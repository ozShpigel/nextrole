using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using Microsoft.Extensions.Logging.Abstractions;

namespace ArchitectureTests;

/// <summary>
/// Scoring driven by the reader scrolling, and the guards between a scroll
/// gesture and the bill.
/// </summary>
/// <remarks>
/// <para>
/// The board shows the whole retrieved band and scores into it as the reader
/// reaches each card. That ties spend to attention, which is the point — but it
/// also means <b>the client now names what to spend money on</b>, so none of
/// these ids are trusted: the count is capped per request, already-scored ids
/// are dropped, overlapping requests cannot pay twice for one posting, and
/// today's budget is claimed before any Claude call.
/// </para>
/// <para>
/// Measured cost is ~$0.0104 per job, so the ceiling is what separates a
/// cheap gesture from an expensive one.
/// </para>
/// </remarks>
public class ScoreByIdsTests
{
    private static readonly Guid User = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static (PoolScanService Scan, RecordingPool Pool, CountingQuota Quota) Build(
        int budgetRemaining = 1000, params string[] alreadyScored)
    {
        // One trace both fakes append to, so "claimed before the call" is an
        // observed order rather than a flag the fake sets for itself.
        var trace = new List<string>();
        var pool = new RecordingPool { Trace = trace };
        var quota = new CountingQuota(budgetRemaining) { Trace = trace };
        var scan = new PoolScanService(
            new UnusedProfile(), pool, new ScoresKnowing(alreadyScored), new CountingMatcher(),
            new NoSnapshots(), quota, NullLogger<PoolScanService>.Instance);
        return (scan, pool, quota);
    }

    [Fact]
    public async Task Scores_exactly_the_ids_it_was_given()
    {
        var (scan, pool, _) = Build();

        var result = await scan.ScoreByIdsAsync(User, ["a", "b", "c"]);

        Assert.Equal(["a", "b", "c"], pool.LastRequestedIds!.Order());
        Assert.Equal(3, result.Candidates);
    }

    [Fact]
    public async Task An_already_scored_id_is_never_paid_for_twice()
    {
        // The board can ask again for a card whose score landed between render
        // and scroll, so the server decides this, not the client.
        var (scan, pool, quota) = Build(1000, "b");

        await scan.ScoreByIdsAsync(User, ["a", "b"]);

        Assert.Equal(["a"], pool.LastRequestedIds!);
        Assert.Equal(1, quota.Claimed);
    }

    [Fact]
    public async Task Asking_only_for_already_scored_ids_spends_nothing()
    {
        var (scan, pool, quota) = Build(1000, "a", "b");

        var result = await scan.ScoreByIdsAsync(User, ["a", "b"]);

        Assert.Null(pool.LastRequestedIds);
        Assert.Equal(0, quota.Claimed);
        Assert.Equal(0, result.Scored);
    }

    [Fact]
    public async Task A_request_is_capped_however_many_ids_it_carries()
    {
        // The request shape is bounded so one call cannot hand over the whole
        // band. Not the spend bound — that is the daily budget — but it stops
        // a single request becoming a scan.
        var (scan, pool, _) = Build();
        var many = Enumerable.Range(0, 50).Select(i => $"job-{i}").ToArray();

        await scan.ScoreByIdsAsync(User, many);

        Assert.Equal(PoolScanService.MaxIdsPerRequest, pool.LastRequestedIds!.Count);
    }

    [Fact]
    public async Task Duplicate_ids_in_one_request_are_collapsed()
    {
        var (scan, pool, quota) = Build();

        await scan.ScoreByIdsAsync(User, ["a", "a", "a", "b"]);

        Assert.Equal(["a", "b"], pool.LastRequestedIds!.Order());
        Assert.Equal(2, quota.Claimed);
    }

    [Fact]
    public async Task The_daily_budget_is_claimed_before_the_model_is_called()
    {
        // The pack rule: a request that fails still spent the money, so the
        // claim cannot come after the call.
        var (scan, pool, quota) = Build();

        await scan.ScoreByIdsAsync(User, ["a", "b"]);

        // The order is the assertion. A budget claimed after the postings are
        // loaded would still read as "claimed", and would still be wrong.
        Assert.Equal(["quota:claim", "pool:read"], quota.Trace.Take(2));
        Assert.Equal(2, quota.Claimed);
    }

    [Fact]
    public async Task An_exhausted_budget_scores_nothing_and_says_so()
    {
        var (scan, pool, _) = Build(budgetRemaining: 0);

        var result = await scan.ScoreByIdsAsync(User, ["a", "b"]);

        Assert.Null(pool.LastRequestedIds);
        Assert.Equal(0, result.Scored);
        Assert.True(result.BudgetExhausted);
    }

    [Fact]
    public async Task A_partial_budget_scores_what_it_can_and_flags_the_rest()
    {
        // Better than dropping the batch: near the ceiling, two of five cards
        // get real scores instead of five staying permanently blank.
        var (scan, pool, _) = Build(budgetRemaining: 2);

        var result = await scan.ScoreByIdsAsync(User, ["a", "b", "c", "d", "e"]);

        Assert.Equal(2, pool.LastRequestedIds!.Count);
        Assert.True(result.BudgetExhausted);
    }

    [Fact]
    public async Task Nothing_is_requested_for_an_empty_or_blank_id_list()
    {
        var (scan, pool, quota) = Build();

        await scan.ScoreByIdsAsync(User, []);
        await scan.ScoreByIdsAsync(User, ["", "   "]);

        Assert.Null(pool.LastRequestedIds);
        Assert.Equal(0, quota.Claimed);
    }

    [Fact]
    public async Task An_id_that_is_not_a_live_posting_is_simply_not_found()
    {
        // The board may hold an id for a posting that closed a moment ago.
        // That is not an error, and must not fail the whole batch.
        var pool = new RecordingPool { ReturnNothing = true };
        var scan = new PoolScanService(
            new UnusedProfile(), pool, new ScoresKnowing(), new CountingMatcher(),
            new NoSnapshots(), new CountingQuota(1000), NullLogger<PoolScanService>.Instance);

        var result = await scan.ScoreByIdsAsync(User, ["gone"]);

        Assert.Equal(0, result.Scored);
    }

    [Fact]
    public async Task Overlapping_requests_do_not_both_pay_for_the_same_posting()
    {
        // This path deliberately does NOT take the one-scan-per-user gate --
        // several scroll batches are expected in flight. The in-flight id set
        // is what stops the double charge, and it has to be per-job: both
        // requests read "not scored yet" before either writes.
        var pool = new RecordingPool { HoldUntilReleased = true };
        var quota = new CountingQuota(1000);
        var scan = new PoolScanService(
            new UnusedProfile(), pool, new ScoresKnowing(), new CountingMatcher(),
            new NoSnapshots(), quota, NullLogger<PoolScanService>.Instance);

        var first = scan.ScoreByIdsAsync(User, ["a", "b"]);
        await pool.Entered.Task;                       // first request is inside, holding "a" and "b"

        var second = await scan.ScoreByIdsAsync(User, ["b", "c"]);

        pool.Release();
        await first;

        // "b" was in flight, so the second request left it alone.
        Assert.Equal(["c"], pool.SecondRequestedIds!);
        Assert.Equal(3, quota.Claimed);                 // a, b, then c -- never b twice
        Assert.Equal(1, second.Candidates);
    }

    // ---- the parse, paid once --------------------------------------------

    [Fact]
    public async Task Parses_made_while_scoring_are_stored_for_the_next_user()
    {
        // The ingest leaves the parse to the first scorer; storing it is what
        // keeps it a once-per-posting cost rather than once per user.
        var (scan, pool, _) = Build();

        await scan.ScoreByIdsAsync(User, ["a", "b"]);

        Assert.Equal(["a", "b"], pool.SavedParses!.Keys.Order());
        Assert.Equal("v-test", pool.SavedParseVersion);
    }

    [Fact]
    public async Task Nothing_older_than_Matches_shows_is_scored()
    {
        // "Any" stops at four months. The ids come from the client, so the
        // server refuses the older one rather than trusting the board; a
        // posting of unknown age is shown, so it is scored.
        var (scan, pool, _) = Build();
        pool.PostedAtById["old"] = DateTime.UtcNow.AddDays(-(PoolBrowseQuery.MaxAgeDays + 10));
        pool.PostedAtById["fresh"] = DateTime.UtcNow.AddDays(-10);

        var result = await scan.ScoreByIdsAsync(User, ["old", "fresh", "unknown"]);

        Assert.Equal(2, result.Scored);
        Assert.Equal(["fresh", "unknown"], pool.SavedParses!.Keys.Order());
    }

    [Fact]
    public async Task A_failed_parse_save_never_costs_the_scores()
    {
        var (scan, pool, _) = Build();
        pool.SaveParsesThrows = true;

        var result = await scan.ScoreByIdsAsync(User, ["a", "b"]);

        Assert.Equal(2, result.Scored);
    }

    // Fakes ------------------------------------------------------------------

    private sealed class RecordingPool : IPoolJobRepository
    {
        public List<string>? LastRequestedIds;
        public List<string>? SecondRequestedIds;
        public List<string> Trace = [];
        public bool ReturnNothing;
        public Dictionary<string, DateTime?> PostedAtById = [];
        public bool HoldUntilReleased;
        public readonly TaskCompletionSource Entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _calls;

        public void Release() => _gate.TrySetResult();

        public int MaxCandidatesPerScan => 10;

        public async Task<List<PoolJob>> GetByIdsAsync(IEnumerable<string> jobIds, CancellationToken ct = default)
        {
            var ids = jobIds.ToList();
            lock (Trace) Trace.Add("pool:read");
            if (Interlocked.Increment(ref _calls) == 1) LastRequestedIds = ids;
            else SecondRequestedIds = ids;

            if (HoldUntilReleased && _calls == 1)
            {
                Entered.TrySetResult();
                await _gate.Task;
            }

            return ReturnNothing
                ? []
                : [.. ids.Select(id => new PoolJob
                {
                    Id = id, Title = "T", Company = "C", Description = "D",
                    PostedAt = PostedAtById.GetValueOrDefault(id),
                })];
        }

        public Task<List<PoolJob>> FindCandidatesAsync(
            CandidateFilter f, IReadOnlyCollection<string> x, int limit, CancellationToken ct = default) =>
            throw new NotSupportedException("ScoreByIdsAsync must not retrieve -- it was given the ids.");
        public Task<long> CountActiveAsync(CancellationToken ct = default) => Task.FromResult(0L);
        public Task<List<PoolJobListItem>> BrowseAsync(
            IReadOnlyCollection<string> ids, PoolBrowseQuery q, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<List<string>> FindIdsByJobUrlAsync(string url, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<string?> FindCompanyLogoAsync(string company, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public IReadOnlyDictionary<string, ParsedJob>? SavedParses;
        public string? SavedParseVersion;
        public bool SaveParsesThrows;

        public Task<int> SaveParsesAsync(
            IReadOnlyDictionary<string, ParsedJob> parses, string? parseVersion, CancellationToken ct = default)
        {
            if (SaveParsesThrows) throw new InvalidOperationException("store down");
            SavedParses = parses;
            SavedParseVersion = parseVersion;
            return Task.FromResult(parses.Count);
        }
    }

    private sealed class CountingQuota(int remaining) : IUserQuotaRepository
    {
        public int Claimed;
        public List<string> Trace = [];

        public Task<int> TryConsumeScoreBudgetAsync(Guid u, int jobs, int limit, CancellationToken ct = default)
        {
            lock (Trace) Trace.Add("quota:claim");
            var grant = Math.Max(0, Math.Min(jobs, remaining - Claimed));
            Claimed += grant;
            return Task.FromResult(grant);
        }

        public Task<int> ScoresUsedTodayAsync(Guid u, CancellationToken ct = default) => Task.FromResult(Claimed);
        public Task<bool> TryConsumePackAsync(Guid u, int l, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> PacksUsedTodayAsync(Guid u, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class ScoresKnowing(params string[] scored) : IJobScoreRepository
    {
        private readonly HashSet<string> _scored = [.. scored];

        public Task<HashSet<string>> GetScoredJobIdsAsync(Guid u, IEnumerable<string> ids, CancellationToken ct = default) =>
            Task.FromResult(ids.Where(_scored.Contains).ToHashSet());

        public Task UpsertManyAsync(Guid u, IReadOnlyList<JobScore> s, CancellationToken ct = default) =>
            Task.CompletedTask;

        public Task<HashSet<string>> GetAllScoredJobIdsAsync(Guid u, CancellationToken ct = default) =>
            throw new NotSupportedException("ScoreByIdsAsync must ask only about the ids it was given.");
        public Task<List<JobScore>> GetScoredAsync(Guid u, int? min, IReadOnlyList<string> v, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<List<JobScore>> GetByJobIdsAsync(Guid u, IEnumerable<string> ids, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    /// <summary>Returns a score for every job it is handed.</summary>
    private sealed class CountingMatcher : IJobMatchService
    {
        public Task<MatchBatchResponse> AnalyzeMatchBatchAsync(
            Guid u, MatchBatchRequest r, CancellationToken ct = default) =>
            Task.FromResult(new MatchBatchResponse
            {
                Results = [.. r.Jobs.Select(j => new MatchBatchResult
                {
                    Id = j.Id,
                    Response = new MatchResponse { OverallScore = 50, Verdict = "MAYBE" },
                })],
                // As JobMatchService does: a parse for every job that came
                // without one.
                NewParses = r.Jobs.Where(j => j.Parsed is null)
                    .ToDictionary(j => j.Id, j => new ParsedJob { JobTitle = j.Title ?? "" }),
                ParseVersion = "v-test",
            });

        public Task<MatchResponse> AnalyzeMatchAsync(Guid u, MatchRequest r, CancellationToken ct = default) =>
            throw new NotSupportedException("The scroll path scores in batches.");
    }

    private sealed class NoSnapshots : IMatchSnapshotRepository
    {
        public Task<string?> UpsertAsync(Guid u, string? a, string? b, string? c, string? d, CancellationToken ct = default) =>
            Task.FromResult<string?>(null);
    }

    /// <summary>ScoreByIdsAsync is given its postings; it must not need a profile.</summary>
    private sealed class UnusedProfile : IProfileProvider
    {
        public Task<ProfileDocument> GetProfileDocumentAsync(Guid u, CancellationToken ct = default) =>
            throw new NotSupportedException("ScoreByIdsAsync must not read the profile.");
        public Task<string> GetProfileAsync(Guid u, CancellationToken ct = default) => throw new NotSupportedException();
        public Task UpsertProfileAsync(Guid u, StructuredProfile p, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ProfileHistoryEntry>> GetHistoryAsync(Guid u, string f, CancellationToken ct = default) => throw new NotSupportedException();
        public Task RestoreHistoryAsync(Guid u, string f, int i, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<InterviewPrepDocument> GetInterviewPrepAsync(Guid u, CancellationToken ct = default) => throw new NotSupportedException();
        public Task UpsertInterviewPrepAsync(Guid u, string? a, string? b, string? c, string? d, IReadOnlyList<QaEntry>? e, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ProfileHistoryEntry>> GetInterviewPrepHistoryAsync(Guid u, string f, CancellationToken ct = default) => throw new NotSupportedException();
        public Task RestoreInterviewPrepHistoryAsync(Guid u, string f, int i, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SetPresentationCuesAsync(Guid u, string f, IReadOnlyList<string> cues, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
