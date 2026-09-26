using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using Microsoft.Extensions.Logging.Abstractions;

namespace ArchitectureTests;

/// <summary>
/// The eager scan and scroll scoring must never pay for one posting twice.
/// </summary>
/// <remarks>
/// They overlap on every first visit: the scan scores the top candidates while
/// those very cards are on screen and fire score-jobs. Measured in production
/// before the shared claim: a new user's 6 candidates were each scored twice,
/// scan first and score-by-ids seconds later. Both orders are driven here, with
/// the first call held open so the overlap is certain rather than lucky.
/// </remarks>
public class ScanScrollOverlapTests
{
    [Fact]
    public async Task Scroll_scoring_does_not_repay_what_a_running_scan_is_scoring()
    {
        var user = Guid.NewGuid();   // the in-flight claims are per user, per process
        var matcher = new GatedMatcher();
        var scan = Service(matcher);

        var running = scan.ScanAsync(user);
        await matcher.FirstCallEntered;

        var scroll = await scan.ScoreByIdsAsync(user, ["a", "b"]);
        matcher.Release();
        await running;

        Assert.Equal(0, scroll.Scored);
        Assert.Equal(["a", "b"], matcher.ScoredIds.Order());   // once each, by the scan
    }

    [Fact]
    public async Task A_scan_skips_what_scroll_scoring_is_already_paying_for()
    {
        var user = Guid.NewGuid();
        var matcher = new GatedMatcher();
        var scan = Service(matcher);

        var scrolling = scan.ScoreByIdsAsync(user, ["a"]);
        await matcher.FirstCallEntered;

        await scan.ScanAsync(user);   // candidates a and b; a is in flight
        matcher.Release();
        await scrolling;

        Assert.Equal(["a", "b"], matcher.ScoredIds.Order());   // a by scroll, b by the scan
    }

    private static PoolScanService Service(GatedMatcher matcher) =>
        new(new AProfile(), new TwoCandidates(), new NothingScored(), matcher,
            new NoSnapshots(), new UnlimitedQuota(), NullLogger<PoolScanService>.Instance);

    // Fakes ------------------------------------------------------------------

    /// <summary>Holds its first call open until released; records every id it scores.</summary>
    private sealed class GatedMatcher : IJobMatchService
    {
        private readonly TaskCompletionSource _entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _calls;

        public List<string> ScoredIds { get; } = [];
        public Task FirstCallEntered => _entered.Task;
        public void Release() => _gate.TrySetResult();

        public async Task<MatchBatchResponse> AnalyzeMatchBatchAsync(
            Guid u, MatchBatchRequest r, CancellationToken ct = default)
        {
            lock (ScoredIds) ScoredIds.AddRange(r.Jobs.Select(j => j.Id));
            if (Interlocked.Increment(ref _calls) == 1)
            {
                _entered.TrySetResult();
                await _gate.Task;
            }
            return new MatchBatchResponse
            {
                Results = [.. r.Jobs.Select(j => new MatchBatchResult
                {
                    Id = j.Id,
                    Response = new MatchResponse { OverallScore = 50, Verdict = "MAYBE" },
                })],
            };
        }

        public Task<MatchResponse> AnalyzeMatchAsync(Guid u, MatchRequest r, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private sealed class TwoCandidates : IPoolJobRepository
    {
        private static PoolJob Job(string id) => new() { Id = id, Title = "T", Company = "C", Description = "D" };

        public int MaxCandidatesPerScan => 10;

        public Task<List<PoolJob>> FindCandidatesAsync(
            CandidateFilter f, IReadOnlyCollection<string> exclude, int limit, CancellationToken ct = default) =>
            Task.FromResult<List<PoolJob>>([Job("a"), Job("b")]);
        public Task<List<PoolJob>> GetByIdsAsync(IEnumerable<string> ids, CancellationToken ct = default) =>
            Task.FromResult(ids.Select(Job).ToList());
        public Task<long> CountActiveAsync(CancellationToken ct = default) => Task.FromResult(2L);
        public Task<List<PoolJobListItem>> BrowseAsync(
            IReadOnlyCollection<string> ids, PoolBrowseQuery q, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<List<string>> FindIdsByJobUrlAsync(string url, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<string?> FindCompanyLogoAsync(string company, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private sealed class NothingScored : IJobScoreRepository
    {
        public Task<HashSet<string>> GetAllScoredJobIdsAsync(Guid u, CancellationToken ct = default) =>
            Task.FromResult(new HashSet<string>());
        public Task<HashSet<string>> GetScoredJobIdsAsync(Guid u, IEnumerable<string> ids, CancellationToken ct = default) =>
            Task.FromResult(new HashSet<string>());
        public Task UpsertManyAsync(Guid u, IReadOnlyList<JobScore> s, CancellationToken ct = default) =>
            Task.CompletedTask;
        public Task<List<JobScore>> GetScoredAsync(Guid u, int? min, IReadOnlyList<string> v, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<List<JobScore>> GetByJobIdsAsync(Guid u, IEnumerable<string> ids, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private sealed class AProfile : IProfileProvider
    {
        private static readonly StructuredProfile Profile = new()
        {
            Location = "Tel Aviv, Israel",
            Skills = [new SkillGroup { Category = "Backend", Items = ["C#"] }],
        };

        public Task<ProfileDocument> GetProfileDocumentAsync(Guid u, CancellationToken ct = default) =>
            Task.FromResult(new ProfileDocument { Structured = Profile });
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

    private sealed class UnlimitedQuota : IUserQuotaRepository
    {
        public Task<int> TryConsumeScoreBudgetAsync(Guid u, int jobs, int limit, CancellationToken ct = default) =>
            Task.FromResult(jobs);
        public Task<int> ScoresUsedTodayAsync(Guid u, CancellationToken ct = default) => Task.FromResult(0);
        public Task<bool> TryConsumePackAsync(Guid u, int limit, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<int> PacksUsedTodayAsync(Guid u, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private sealed class NoSnapshots : IMatchSnapshotRepository
    {
        public Task<string?> UpsertAsync(Guid u, string? a, string? b, string? c, string? d, CancellationToken ct = default) =>
            Task.FromResult<string?>(null);
    }
}
