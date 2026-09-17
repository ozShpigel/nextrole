using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;

namespace ArchitectureTests;

/// <summary>
/// The Matches list: this user's scored pool jobs, filtered and ranked.
/// </summary>
/// <remarks>
/// Ported with the endpoint from the scraper in Phase 1b of
/// docs/scraper-slimming.md. Three collections meet here and which one leads
/// matters: a score is an opinion about one candidate, so <c>jobScores</c>
/// decides eligibility. A pool job with no row for this user has never been
/// scored for them and must not appear — before scoring moved off ingest, the
/// list read a shared <c>score</c> field, and everyone saw everyone's verdicts.
/// </remarks>
public class PoolBrowseServiceTests
{
    private static readonly Guid User = Guid.Parse("11111111-1111-1111-1111-111111111111");

    // ── Fakes ───────────────────────────────────────────────────────────────

    private sealed class FakeScores : IJobScoreRepository
    {
        public List<JobScore> Rows = [];
        public (int? MinScore, IReadOnlyList<string> Verdicts)? LastQuery;

        public Task<List<JobScore>> GetScoredAsync(
            Guid userId, int? minScore, IReadOnlyList<string> verdicts, CancellationToken ct = default)
        {
            LastQuery = (minScore, verdicts);
            var q = Rows.Where(r => r.Score is not null);
            if (minScore is { } f) q = q.Where(r => r.Score >= f);
            if (verdicts.Count > 0) q = q.Where(r => verdicts.Contains(r.Verdict));
            return Task.FromResult(q.ToList());
        }

        public Task<HashSet<string>> GetAllScoredJobIdsAsync(Guid u, CancellationToken ct = default) =>
            Task.FromResult(Rows.Select(r => r.JobId).ToHashSet());
        public Task<HashSet<string>> GetScoredJobIdsAsync(Guid u, IEnumerable<string> ids, CancellationToken ct = default) =>
            Task.FromResult(Rows.Select(r => r.JobId).ToHashSet());
        public Task<List<JobScore>> GetByJobIdsAsync(Guid u, IEnumerable<string> ids, CancellationToken ct = default) =>
            Task.FromResult(Rows.Where(r => ids.Contains(r.JobId)).ToList());
        public Task UpsertManyAsync(Guid u, IReadOnlyList<JobScore> s, CancellationToken ct = default) => Task.CompletedTask;
        public Task<bool> TryConsumePackAsync(Guid u, int limit, CancellationToken ct = default) => Task.FromResult(true);
        public Task<int> PacksUsedTodayAsync(Guid u, CancellationToken ct = default) => Task.FromResult(0);
    }

    private sealed class FakePool : IPoolJobRepository
    {
        public List<PoolJobListItem> Rows = [];
        public IReadOnlyCollection<string>? LastIds;

        public Task<List<PoolJobListItem>> BrowseAsync(
            IReadOnlyCollection<string> jobIds, PoolBrowseQuery query, CancellationToken ct = default)
        {
            LastIds = jobIds;
            return Task.FromResult(Rows.Where(r => jobIds.Contains(r.Id)).ToList());
        }

        public Task<List<PoolJob>> FindCandidatesAsync(CandidateFilter f, IReadOnlyCollection<string> x, int n, CancellationToken ct = default) =>
            Task.FromResult(new List<PoolJob>());
        public Task<List<PoolJob>> GetByIdsAsync(IEnumerable<string> ids, CancellationToken ct = default) =>
            Task.FromResult(new List<PoolJob>());
        public Task<long> CountActiveAsync(CancellationToken ct = default) => Task.FromResult(0L);
        public Task<List<string>> FindIdsByJobUrlAsync(string url, CancellationToken ct = default) =>
            Task.FromResult(new List<string>());
        public Task<string?> FindCompanyLogoAsync(string company, CancellationToken ct = default) =>
            Task.FromResult<string?>(null);
    }

    private sealed class FakeState : IPoolJobStateRepository
    {
        public Dictionary<string, PoolJobState> Rows = [];

        public Task<Dictionary<string, PoolJobState>> StateForAsync(
            Guid u, IReadOnlyCollection<string> ids, CancellationToken ct = default) =>
            Task.FromResult(Rows.Where(kv => ids.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value));

        public Task<bool> IsSavedAsync(Guid u, string j, CancellationToken ct = default) => Task.FromResult(false);
        public Task MarkSavedAsync(Guid u, string j, CancellationToken ct = default) => Task.CompletedTask;
        public Task MarkDismissedAsync(Guid u, string j, CancellationToken ct = default) => Task.CompletedTask;
        public Task MarkViewedAsync(Guid u, string j, CancellationToken ct = default) => Task.CompletedTask;
        public Task<long> ClearSavedAsync(Guid u, IReadOnlyCollection<string> ids, CancellationToken ct = default) => Task.FromResult(0L);
    }

    private static JobScore Score(string jobId, int? score, string verdict = "YES", string? analysis = null) =>
        new() { Id = JobScore.KeyFor(User, jobId), UserId = User, JobId = jobId, Score = score, Verdict = verdict, MatchAnalysis = analysis };

    private static PoolJobListItem Job(string id) => new() { Id = id, Title = $"Job {id}", Company = "Acme" };

    private static (PoolBrowseService Svc, FakeScores S, FakePool P, FakeState T) Build()
    {
        var s = new FakeScores(); var p = new FakePool(); var t = new FakeState();
        return (new PoolBrowseService(s, p, t), s, p, t);
    }

    // ── Eligibility comes from the user's own rows ──────────────────────────

    [Fact]
    public async Task A_pool_job_this_user_has_no_score_for_never_appears()
    {
        var (svc, s, p, _) = Build();
        s.Rows = [Score("a", 90)];
        p.Rows = [Job("a"), Job("b")];   // "b" is in the pool, unscored for them

        var result = await svc.BrowseAsync(User, new PoolBrowseQuery());

        Assert.Equal(["a"], result.Jobs.Select(j => j.Id));
        Assert.DoesNotContain("b", p.LastIds!);   // never even asked about
    }

    [Fact]
    public async Task No_scores_means_an_empty_page_not_the_whole_pool()
    {
        var (svc, _, p, _) = Build();
        p.Rows = [Job("a"), Job("b")];

        var result = await svc.BrowseAsync(User, new PoolBrowseQuery());

        Assert.Empty(result.Jobs);
        Assert.Equal(0, result.Total);
        Assert.Null(p.LastIds);   // short-circuits before touching the pool
    }

    // ── Ranking ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Jobs_come_back_best_match_first()
    {
        var (svc, s, p, _) = Build();
        s.Rows = [Score("low", 40), Score("high", 95), Score("mid", 70)];
        p.Rows = [Job("low"), Job("high"), Job("mid")];

        var result = await svc.BrowseAsync(User, new PoolBrowseQuery());

        Assert.Equal(["high", "mid", "low"], result.Jobs.Select(j => j.Id));
    }

    // ── Per-user state ──────────────────────────────────────────────────────

    [Fact]
    public async Task Dismissed_jobs_are_hidden_by_default_and_shown_on_request()
    {
        var (svc, s, p, t) = Build();
        s.Rows = [Score("a", 90), Score("b", 80)];
        p.Rows = [Job("a"), Job("b")];
        t.Rows["b"] = new PoolJobState { UserId = User, JobId = "b", Dismissed = true };

        var hidden = await svc.BrowseAsync(User, new PoolBrowseQuery());
        Assert.Equal(["a"], hidden.Jobs.Select(j => j.Id));

        var shown = await svc.BrowseAsync(User, new PoolBrowseQuery { IncludeDismissed = true });
        Assert.Equal(["a", "b"], shown.Jobs.Select(j => j.Id).OrderBy(x => x));
        Assert.True(shown.Jobs.Single(j => j.Id == "b").Dismissed);
    }

    [Fact]
    public async Task Saved_jobs_stay_visible_by_default()
    {
        // "Already in my tracker" is not the same signal as "not interested".
        var (svc, s, p, t) = Build();
        s.Rows = [Score("a", 90)];
        p.Rows = [Job("a")];
        t.Rows["a"] = new PoolJobState { UserId = User, JobId = "a", SavedToTracker = true };

        var shown = await svc.BrowseAsync(User, new PoolBrowseQuery());
        Assert.Single(shown.Jobs);
        Assert.True(shown.Jobs[0].SavedToTracker);

        var hidden = await svc.BrowseAsync(User, new PoolBrowseQuery { IncludeSaved = false });
        Assert.Empty(hidden.Jobs);
    }

    // ── The merge ───────────────────────────────────────────────────────────

    [Fact]
    public async Task The_verdict_and_analysis_come_from_this_users_row()
    {
        var (svc, s, p, _) = Build();
        s.Rows = [Score("a", 91, "STRONG_YES", """{"overallScore":91}""")];
        p.Rows = [Job("a")];

        var job = (await svc.BrowseAsync(User, new PoolBrowseQuery())).Jobs.Single();

        Assert.Equal(91, job.Score);
        Assert.Equal("STRONG_YES", job.Verdict);
        Assert.NotNull(job.MatchAnalysis);
        Assert.Equal(91, job.MatchAnalysis!.Value.GetProperty("overallScore").GetInt32());
    }

    [Fact]
    public async Task Unparseable_stored_analysis_does_not_take_the_list_down()
    {
        // A row written under an older shape must cost its own analysis, not
        // everyone else's page.
        var (svc, s, p, _) = Build();
        s.Rows = [Score("a", 90, "YES", "not json at all"), Score("b", 80, "YES", """{"overallScore":80}""")];
        p.Rows = [Job("a"), Job("b")];

        var result = await svc.BrowseAsync(User, new PoolBrowseQuery());

        Assert.Equal(2, result.Jobs.Count);
        Assert.Null(result.Jobs.Single(j => j.Id == "a").MatchAnalysis);
        Assert.NotNull(result.Jobs.Single(j => j.Id == "b").MatchAnalysis);
    }

    // ── Paging ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Total_counts_every_match_while_jobs_carries_one_page()
    {
        var (svc, s, p, _) = Build();
        s.Rows = [.. Enumerable.Range(0, 5).Select(i => Score($"j{i}", 100 - i))];
        p.Rows = [.. Enumerable.Range(0, 5).Select(i => Job($"j{i}"))];

        var result = await svc.BrowseAsync(User, new PoolBrowseQuery { Limit = 2, Offset = 1 });

        Assert.Equal(5, result.Total);
        Assert.Equal(["j1", "j2"], result.Jobs.Select(j => j.Id));
        Assert.Equal(2, result.Limit);
        Assert.Equal(1, result.Offset);
    }

    [Fact]
    public async Task A_hostile_limit_is_clamped_rather_than_honoured()
    {
        var (svc, s, p, _) = Build();
        s.Rows = [Score("a", 90)];
        p.Rows = [Job("a")];

        var huge = await svc.BrowseAsync(User, new PoolBrowseQuery { Limit = 100_000, Offset = -5 });
        Assert.Equal(PoolBrowseQuery.MaxLimit, huge.Limit);
        Assert.Equal(0, huge.Offset);

        var zero = await svc.BrowseAsync(User, new PoolBrowseQuery { Limit = 0 });
        Assert.Equal(1, zero.Limit);
    }

    // ── Filters reach the right layer ───────────────────────────────────────

    [Fact]
    public async Task Score_and_verdict_filter_the_users_rows_not_the_pool()
    {
        // They are per-user values, so filtering them against the shared pool
        // document would be filtering on a field that is permanently null.
        var (svc, s, p, _) = Build();
        s.Rows = [Score("a", 90, "STRONG_YES"), Score("b", 40, "NO")];
        p.Rows = [Job("a"), Job("b")];

        var result = await svc.BrowseAsync(
            User, new PoolBrowseQuery { MinScore = 70, Verdicts = ["STRONG_YES"] });

        Assert.Equal(70, s.LastQuery!.Value.MinScore);
        Assert.Equal(["STRONG_YES"], s.LastQuery!.Value.Verdicts);
        Assert.Equal(["a"], result.Jobs.Select(j => j.Id));
    }
}
