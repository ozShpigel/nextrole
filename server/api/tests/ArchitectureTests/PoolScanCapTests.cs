using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using ApplicationTracker.Infrastructure.Greenhouse;
using ApplicationTracker.Infrastructure.Repositories;
using Microsoft.Extensions.Logging.Abstractions;

namespace ArchitectureTests;

/// <summary>
/// The scan's spend cap comes from the source, not from the scan.
/// </summary>
/// <remarks>
/// <para>
/// The two sources are capped for different reasons and the numbers do not
/// reconcile: the pool's Mongo filter returns everything that survived it, in
/// no order of fit, so its cap is only a spend ceiling (50); Greenhouse returns
/// a vector-ranked list, so its cap is the depth at which the ranking stops
/// paying for itself (10, measured: similarity correlates +0.65 with the
/// eventual score overall but -0.15 within the top ten, and the two best
/// postings of 29 sat at ranks 7 and 10).
/// </para>
/// <para>
/// This needs a check because the failure is silent and expensive in one
/// direction. A refactor that moves the number back into
/// <c>PoolScanService</c> leaves the ranked source scoring 50 candidates per
/// scan: ten batches, twenty Claude calls, for the one handful of jobs the
/// vector already put on top. Nothing errors, no test fails on the score
/// itself, and the bill is the only symptom.
/// </para>
/// </remarks>
public class PoolScanCapTests
{
    private static readonly Guid User = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public async Task Scan_asks_the_source_for_its_own_cap()
    {
        // Deliberately neither 50 nor 5: a scan that carried its own number
        // would still pass against either real value.
        var pool = new CapOnlyPool(cap: 7);
        var scan = ScanServiceOver(pool);

        await scan.ScanAsync(User);

        // One over the cap -- the extra row only answers "is there more", and
        // is never scored.
        Assert.Equal(8, pool.LastLimit);
    }

    [Fact]
    public async Task Scan_scores_only_what_the_default_board_shows()
    {
        // Paying Claude to score a posting the 30-day default hides is spend
        // nobody sees; an older one is scored only if the reader widens the
        // window and reaches its card.
        var pool = new CapOnlyPool(cap: 7);

        await ScanServiceOver(pool).ScanAsync(User);

        Assert.Equal(PoolBrowseQuery.DefaultDaysBack, pool.LastMaxAgeDays);
        Assert.Equal(30, PoolBrowseQuery.DefaultDaysBack);
    }

    [Fact]
    public void The_band_filter_carries_no_age_window()
    {
        // The band shares the scan's search; with a window here, "Any" could
        // never bring an older posting back.
        Assert.Null(CandidateFilter.FromProfile(new StructuredProfile()).MaxAgeDays);
    }

    [Fact]
    public void The_two_sources_disagree_on_purpose()
    {
        Assert.Equal(50, new PoolJobRepository(jobs: null!).MaxCandidatesPerScan);
        Assert.Equal(10, GreenhouseJobRepository.DefaultMaxCandidatesPerScan);
    }

    [Fact]
    public void A_configured_cap_of_zero_or_less_falls_back_to_the_default()
    {
        // Configuration.GetValue yields 0 for an env var set to empty, and a
        // cap of 0 would score nothing while reporting a clean scan.
        foreach (var bad in new[] { 0, -1 })
            Assert.Equal(
                GreenhouseJobRepository.DefaultMaxCandidatesPerScan,
                new GreenhouseJobRepository(
                    null!, null!, NullLogger<GreenhouseJobRepository>.Instance, bad)
                    .MaxCandidatesPerScan);
    }

    private static PoolScanService ScanServiceOver(IPoolJobRepository pool) =>
        new(new ProfileWithSkills(), pool, new NoScores(), new UncallableMatcher(),
            new NoSnapshots(), new UnlimitedQuota(), NullLogger<PoolScanService>.Instance);

    // Fakes ------------------------------------------------------------------

    /// <summary>Records the limit it was asked for and returns nothing.</summary>
    /// <remarks>
    /// Returning no candidates ends the scan before any batch, so the matcher
    /// below is never called and the assertion is about the limit alone.
    /// </remarks>
    private sealed class CapOnlyPool(int cap) : IPoolJobRepository
    {
        public int? LastLimit;
        public int? LastMaxAgeDays;

        public int MaxCandidatesPerScan => cap;

        public Task<List<PoolJob>> FindCandidatesAsync(
            CandidateFilter f, IReadOnlyCollection<string> exclude, int limit, CancellationToken ct = default)
        {
            LastLimit = limit;
            LastMaxAgeDays = f.MaxAgeDays;
            return Task.FromResult(new List<PoolJob>());
        }

        public Task<long> CountActiveAsync(CancellationToken ct = default) => Task.FromResult(0L);

        public Task<List<PoolJob>> GetByIdsAsync(IEnumerable<string> ids, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<List<PoolJobListItem>> BrowseAsync(
            IReadOnlyCollection<string> ids, PoolBrowseQuery q, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<List<string>> FindIdsByJobUrlAsync(string url, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<string?> FindCompanyLogoAsync(string company, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    /// <summary>A profile the scan will not refuse: non-empty skills.</summary>
    private sealed class ProfileWithSkills : IProfileProvider
    {
        private static readonly StructuredProfile Profile = new()
        {
            Location = "Tel Aviv, Israel",
            Seniority = "Senior Backend Engineer",
            Skills = [new SkillGroup { Category = "Backend", Items = ["C#"] }],
        };

        public Task<ProfileDocument> GetProfileDocumentAsync(Guid u, CancellationToken ct = default) =>
            Task.FromResult(new ProfileDocument { Structured = Profile });

        public Task<string> GetProfileAsync(Guid u, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task UpsertProfileAsync(Guid u, StructuredProfile p, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<IReadOnlyList<ProfileHistoryEntry>> GetHistoryAsync(
            Guid u, string f, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task RestoreHistoryAsync(Guid u, string f, int i, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<InterviewPrepDocument> GetInterviewPrepAsync(Guid u, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task UpsertInterviewPrepAsync(
            Guid u, string? hr, string? tech, string? work, string? personal,
            IReadOnlyList<QaEntry>? qa, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<IReadOnlyList<ProfileHistoryEntry>> GetInterviewPrepHistoryAsync(
            Guid u, string f, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task RestoreInterviewPrepHistoryAsync(
            Guid u, string f, int i, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task SetPresentationCuesAsync(
            Guid u, string f, IReadOnlyList<string> cues, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private sealed class NoScores : IJobScoreRepository
    {
        public Task<HashSet<string>> GetAllScoredJobIdsAsync(Guid u, CancellationToken ct = default) =>
            Task.FromResult(new HashSet<string>());

        public Task<List<JobScore>> GetScoredAsync(
            Guid u, int? min, IReadOnlyList<string> verdicts, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<HashSet<string>> GetScoredJobIdsAsync(
            Guid u, IEnumerable<string> ids, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<List<JobScore>> GetByJobIdsAsync(
            Guid u, IEnumerable<string> ids, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task UpsertManyAsync(Guid u, IReadOnlyList<JobScore> s, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<bool> TryConsumePackAsync(Guid u, int limit, CancellationToken ct = default) =>
            throw new NotSupportedException();
        public Task<int> PacksUsedTodayAsync(Guid u, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    /// <summary>Throws if called: no candidate survives, so nothing is scored.</summary>
    private sealed class UncallableMatcher : IJobMatchService
    {
        private const string Never = "The scan must not spend a Claude call on an empty candidate set.";

        public Task<MatchResponse> AnalyzeMatchAsync(
            Guid u, MatchRequest r, CancellationToken ct = default) =>
            throw new NotSupportedException(Never);
        public Task<MatchBatchResponse> AnalyzeMatchBatchAsync(
            Guid u, MatchBatchRequest r, CancellationToken ct = default) =>
            throw new NotSupportedException(Never);
    }

    /// <summary>Never the constraint under test here.</summary>
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
        public Task<string?> UpsertAsync(
            Guid u, string? ai, string? ao, string? ei, string? eo, CancellationToken ct = default) =>
            Task.FromResult<string?>(null);
    }
}
