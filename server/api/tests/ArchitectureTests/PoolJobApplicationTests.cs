using System.Text.Json;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;

namespace ArchitectureTests;

/// <summary>
/// Adding a pool job to the tracker must carry THIS user's score with it.
/// </summary>
/// <remarks>
/// Ported from the scraper's <c>tests/test_save_job_score.py</c> when the save
/// moved into the API (Phase 1 of docs/scraper-slimming.md). The bug they pin
/// is worth restating, because the code that caused it was deleted and the
/// reasoning would go with it otherwise.
///
/// Scoring moved off ingest when the pool became shared, so
/// <c>discovered_jobs.score</c>/<c>.verdict</c>/<c>.match_analysis</c> are
/// permanently null on every job either ingest path writes. The save kept
/// reading them, so every "Add" from Matches created an application with no
/// score, no verdict and no analysis — the user saw 92/STRONG_YES on the card,
/// clicked Add, and the tracked row had nothing. Silent, because a null score
/// renders as an absent section rather than an error.
///
/// One assertion from the original is deliberately NOT ported: that the
/// jobScores lookup filters on UserId. On the scraper that was a query a
/// reviewer had to check. Here the lookup goes through
/// <c>UserScopedCollection</c>, which has no overload that omits the userId —
/// the test became a compile error, which is the better version of it.
/// </remarks>
public class PoolJobApplicationTests
{
    private static readonly Guid User = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private const string Analysis = """{"overallScore":91,"verdict":"STRONG_YES"}""";

    private static PoolJob Job() => new()
    {
        Id = "job-1",
        Title = "Backend Engineer",
        Company = "Acme",
        Description = "Build things.",
        JobUrl = "https://example.test/jobs/1",
    };

    private static JobScore Score() => new()
    {
        Id = JobScore.KeyFor(User, "job-1"),
        UserId = User,
        JobId = "job-1",
        Score = 91,
        Verdict = "STRONG_YES",
        MatchAnalysis = Analysis,
    };

    [Fact]
    public void The_score_comes_from_this_users_jobScores_row()
    {
        var app = PoolJobApplication.ToApplication(User, Job(), Score(), null);

        // The whole point: the pool document carries none of these.
        Assert.Equal(91, app.MatchScore);
        Assert.Equal("STRONG_YES", app.MatchVerdict);
    }

    [Fact]
    public void The_analysis_is_passed_through_not_re_encoded()
    {
        // JobScore.MatchAnalysis is already a JSON string, unlike the BSON
        // document the pool used to hold. Serializing it again would store a
        // quoted blob the client cannot parse.
        var app = PoolJobApplication.ToApplication(User, Job(), Score(), null);

        Assert.Equal(Analysis, app.MatchAnalysis);
        using var parsed = JsonDocument.Parse(app.MatchAnalysis!);
        Assert.Equal(91, parsed.RootElement.GetProperty("overallScore").GetInt32());
    }

    [Fact]
    public void An_unscored_job_still_saves()
    {
        // Add is reachable from a listing that only shows scored jobs, so this
        // is the unusual path — but losing the add would be worse than saving
        // it bare.
        var app = PoolJobApplication.ToApplication(User, Job(), null, null);

        Assert.Null(app.MatchScore);
        Assert.Null(app.MatchVerdict);
        Assert.Null(app.MatchAnalysis);
        Assert.Equal("Backend Engineer", app.JobTitle);
        Assert.Equal(ApplicationStatus.DecidedToApply, app.Status);
    }

    [Fact]
    public void The_application_is_stamped_with_the_saving_user()
    {
        // UserScopedCollection refuses a write whose document is owned by
        // someone else, so an unstamped application would fail loudly at the
        // repository rather than land unreadable — but only if it is stamped
        // here, which is the one place that can.
        var app = PoolJobApplication.ToApplication(User, Job(), Score(), null);

        Assert.Equal(User, app.UserId);
    }

    [Fact]
    public void A_missing_logo_falls_back_and_a_present_one_wins()
    {
        var withOwn = Job() with { CompanyLogo = "https://cdn.test/own.png" };
        Assert.Equal(
            "https://cdn.test/own.png",
            PoolJobApplication.ToApplication(User, withOwn, Score(), "https://cdn.test/other.png").CompanyLogo);

        Assert.Equal(
            "https://cdn.test/other.png",
            PoolJobApplication.ToApplication(User, Job(), Score(), "https://cdn.test/other.png").CompanyLogo);

        Assert.Null(PoolJobApplication.ToApplication(User, Job(), Score(), null).CompanyLogo);
    }

    [Fact]
    public void Enrichment_is_serialized_only_when_present()
    {
        // Nothing produces these any more (the scrapers were deleted), but
        // documents from the criteria era still carry them and still forward.
        var bare = PoolJobApplication.ToApplication(User, Job(), Score(), null);
        Assert.Null(bare.CompanyNews);
        Assert.Null(bare.GlassdoorData);

        var enriched = Job() with
        {
            CompanyNews = [new CompanyNewsItem { Title = "Acme raises a round" }],
            GlassdoorData = new GlassdoorData { ReviewCount = 15 },
        };
        var app = PoolJobApplication.ToApplication(User, enriched, Score(), null);

        Assert.Contains("Acme raises a round", app.CompanyNews);
        Assert.Contains("15", app.GlassdoorData);
    }
}
