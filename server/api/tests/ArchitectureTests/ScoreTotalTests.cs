using ApplicationTracker.Core.Matching;

namespace ArchitectureTests;

/// <summary>
/// What dropping an unassessable dimension does to the overall score.
/// </summary>
/// <remarks>
/// <para>
/// This arithmetic had no test at all before, because it lived inside
/// <c>JobMatchService.EnforceEvidenceCaps</c>, which is private.
/// <c>PaceEvidenceTests</c> pins the predicate that decides <i>whether</i> a
/// dimension can be assessed and never touched what happens to the total —
/// so the whole suite passed while the scoring rule changed underneath it.
/// </para>
/// <para>
/// The behaviour replaced a fixed cap of 12+7=19 of 35 on Pace &amp; Workload
/// and Long-term Risk. That cap was calibrated when a JD silent on pace could
/// still be paired with Glassdoor review evidence. Nothing supplies that any
/// more — the scraper was deleted and Greenhouse's boards API returns no
/// reviews — so the cap fired on essentially every job and became a permanent
/// tax that compressed every score toward the middle.
/// </para>
/// </remarks>
public class ScoreTotalTests
{
    private static Breakdown With(int? technical, int? execution, int? sustainability) => new()
    {
        TechnicalFit = new TechnicalFitScore { Score = technical },
        EngineeringExecutionFit = new EngineeringExecutionFitScore { Score = execution },
        SustainabilityPaceFit = new SustainabilityPaceFitScore { Score = sustainability },
    };

    [Fact]
    public void The_maxima_still_add_up_to_a_hundred()
    {
        // The renormalisation leans on this: when every dimension is scored the
        // denominator IS 100, so the rescale is a no-op. If a dimension's max
        // ever changes, that identity breaks and every full-evidence score
        // shifts — which is exactly the kind of silent move this pins.
        Assert.Equal(100, ScoreTotal.FullMax);
        Assert.Equal(
            100,
            ScoreTotal.TechnicalFitMax
            + ScoreTotal.EngineeringExecutionFitMax
            + ScoreTotal.SustainabilityPaceFitMax);
    }

    [Theory]
    [InlineData(35, 30, 35, 100)]
    [InlineData(0, 0, 0, 0)]
    [InlineData(8, 26, 28, 62)]     // a real stored score, Deliveroo/Maya
    [InlineData(20, 15, 19, 54)]
    public void A_fully_scored_job_is_the_plain_sum(int t, int e, int s, int expected)
    {
        // The property that matters most: a job with full evidence must score
        // exactly what it scored before this change. Anything else would be a
        // silent repricing of every posting that DOES mention pace.
        Assert.Equal(expected, ScoreTotal.Renormalised(With(t, e, s)));
    }

    [Fact]
    public void Dropping_sustainability_scores_out_of_sixty_five()
    {
        // 30 + 26 = 56 of the 65 that could be assessed -> 86.
        Assert.Equal(86, ScoreTotal.Renormalised(With(30, 26, null)));
    }

    [Fact]
    public void Dropping_a_dimension_beats_being_taxed_for_it_when_the_rest_is_strong()
    {
        // The measured complaint. A posting matching the candidate's stack
        // exactly: 33 of 35 technical, 28 of 30 execution.
        var strong = With(33, 28, null);

        // Old behaviour: the capped dimension contributed a flat 19, so the
        // best reachable score was 33 + 28 + 19 = 80.
        const int underTheOldCap = 33 + 28 + 19;

        // New: scored out of 65, which is what was actually assessable.
        var now = ScoreTotal.Renormalised(strong);

        Assert.Equal(94, now);
        Assert.True(now > underTheOldCap,
            "a job strong on every assessable dimension must not be held down by evidence no source can supply");
    }

    [Fact]
    public void Dropping_a_dimension_also_stops_flattering_a_weak_job()
    {
        // The same change in the other direction, and the reason this is a
        // renormalisation rather than simply deleting the cap: a flat 19 was a
        // floor as well as a ceiling. 10 + 8 = 18 of 65 -> 28, where the old
        // cap would have handed this posting 10 + 8 + 19 = 37.
        var weak = With(10, 8, null);

        Assert.Equal(28, ScoreTotal.Renormalised(weak));
        Assert.True(ScoreTotal.Renormalised(weak) < 10 + 8 + 19);
    }

    [Theory]
    // 1 of 65 = 1.54 -> 2; 2 of 65 = 3.08 -> 3. Half-up, not banker's rounding:
    // Math.Round defaults to ToEven, which would send 32.5 to 32.
    [InlineData(1, 0, 2)]
    [InlineData(2, 0, 3)]
    [InlineData(13, 8, 32)]
    public void Rounding_is_half_up(int t, int e, int expected)
    {
        Assert.Equal(expected, ScoreTotal.Renormalised(With(t, e, null)));
    }

    [Fact]
    public void Any_single_dimension_can_be_the_only_one_scored()
    {
        // Not a scenario today, but the arithmetic must not assume which
        // dimension went missing.
        Assert.Equal(100, ScoreTotal.Renormalised(With(35, null, null)));
        Assert.Equal(100, ScoreTotal.Renormalised(With(null, 30, null)));
        Assert.Equal(100, ScoreTotal.Renormalised(With(null, null, 35)));
        Assert.Equal(50, ScoreTotal.Renormalised(With(null, 15, null)));
    }

    [Fact]
    public void Nothing_assessable_returns_null_rather_than_zero()
    {
        // Null means "keep the score you had". A 0 here would publish
        // "assessed, and terrible" about a job nobody managed to assess.
        Assert.Null(ScoreTotal.Renormalised(With(null, null, null)));
    }

    [Fact]
    public void A_dropped_dimension_is_not_the_same_as_a_zero_one()
    {
        // The distinction the whole change rests on.
        Assert.Equal(86, ScoreTotal.Renormalised(With(30, 26, null)));
        Assert.Equal(56, ScoreTotal.Renormalised(With(30, 26, 0)));
    }
}
