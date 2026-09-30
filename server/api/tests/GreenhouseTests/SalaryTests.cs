using ApplicationTracker.Core.Matching;
using ApplicationTracker.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The checks between a salary figure and a job card: SalaryBounds for every
/// range, PayRanges for Greenhouse's published ones.
/// </summary>
/// <remarks>
/// These are the code behind the facts prompt's salary rules (AGENTS.md: a
/// prompt rule with no check is not a rule), and the only thing standing
/// between an hourly or monthly figure and a card that calls it a year's pay.
/// </remarks>
public class SalaryTests
{
    // ── SalaryBounds ────────────────────────────────────────────────────────

    [Fact]
    public void An_annual_range_passes_and_its_currency_is_normalised()
    {
        var r = SalaryBounds.Check(420_000, 540_000, " ils ", estimate: true);

        Assert.Equal(new SalaryRange(420_000, 540_000, "ILS"), r);
    }

    [Theory]
    [InlineData(30, 45, "USD")]           // an hourly rate
    [InlineData(30_000, 38_000, "ILS")]   // an Israeli MONTHLY figure: ~$8-10k a year, under the floor
    [InlineData(150_000, 120_000, "USD")] // inverted
    [InlineData(0, 100_000, "USD")]       // no floor
    [InlineData(100_000, 150_000, "XYZ")] // not a currency we can bound
    [InlineData(100_000, 150_000, null)]
    [InlineData(3_000_000, 3_500_000, "USD")] // not believable as base pay
    public void Ranges_that_are_not_a_years_pay_are_dropped(long min, long max, string? currency)
    {
        Assert.Null(SalaryBounds.Check(min, max, currency, estimate: false));
        Assert.Null(SalaryBounds.Check(min, max, currency, estimate: true));
    }

    [Fact]
    public void Only_an_estimate_is_held_to_the_spread_limit()
    {
        // A company may publish a wide band -- it is their number. An estimate
        // that wide says nothing, so it is dropped rather than shown.
        Assert.NotNull(SalaryBounds.Check(100_000, 200_000, "USD", estimate: false));
        Assert.Null(SalaryBounds.Check(100_000, 200_000, "USD", estimate: true));
        Assert.NotNull(SalaryBounds.Check(100_000, 150_000, "USD", estimate: true));
    }

    [Fact]
    public void A_posted_range_wins_over_an_estimate()
    {
        var posted = new SalaryRange(135_000, 195_000, "USD");
        var estimated = new SalaryRange(150_000, 190_000, "USD");

        Assert.Equal("posted", JobSalary.From(posted, estimated)!.Source);
        Assert.Equal("estimated", JobSalary.From(null, estimated)!.Source);
        Assert.Null(JobSalary.From(null, null));
    }

    // ── PayRanges (Greenhouse pay_input_ranges) ─────────────────────────────

    private static BoardPayRange Range(long min, long max, string currency = "USD", string? title = "Pay Range", string? blurb = null) =>
        new() { MinCents = min, MaxCents = max, CurrencyType = currency, Title = title, Blurb = blurb };

    [Fact]
    public void No_published_range_is_null()
    {
        Assert.Null(PayRanges.Annual(null));
        Assert.Null(PayRanges.Annual([]));
    }

    [Fact]
    public void Cents_become_whole_units()
    {
        Assert.Equal(new SalaryRange(139_200, 235_200, "USD"), PayRanges.Annual([Range(13_920_000, 23_520_000)]));
    }

    [Theory]
    [InlineData("Hourly Pay Range", null)]
    [InlineData("Pay Range", "<p>This role is paid per&amp;nbsp;hour.</p>")]
    public void An_hourly_range_is_dropped_even_when_its_cents_would_pass(string title, string? blurb)
    {
        // 150,000 cents is $1,500 -- under the floor anyway -- so use cents that
        // WOULD pass as annual, to prove the words alone drop it.
        Assert.Null(PayRanges.Annual([Range(12_000_000, 15_000_000, title: title, blurb: blurb)]));
    }

    [Fact]
    public void Zones_in_one_currency_merge_into_their_overall_range()
    {
        var r = PayRanges.Annual([Range(12_000_000, 16_000_000), Range(14_000_000, 19_000_000)]);

        Assert.Equal(new SalaryRange(120_000, 190_000, "USD"), r);
    }

    [Fact]
    public void A_second_currency_does_not_mix_into_the_first()
    {
        var r = PayRanges.Annual([Range(12_000_000, 16_000_000, "USD"), Range(9_000_000, 11_000_000, "GBP")]);

        Assert.Equal(new SalaryRange(120_000, 160_000, "USD"), r);
    }
}
