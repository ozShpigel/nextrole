using ApplicationTracker.Core.Matching;
using ApplicationTracker.Infrastructure.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The post-filter that decides whether a retrieved posting is in the
/// candidate's country.
/// </summary>
/// <remarks>
/// <para>
/// It exists because an Atlas vector-search filter cannot express a regex, and
/// the extraction's location values do not survive exact matching. Every value
/// asserted here was <b>measured on the real collection</b> (134 postings from
/// similarweb and monzo) — "London" arrives as ten distinct strings, with the
/// city and the country each sometimes absent and a work-mode suffix appended.
/// </para>
/// <para>
/// The rule mirrors the pool's: substring, case-insensitive, and permissive on
/// absence. A job whose location could not be read must never become invisible
/// to everyone, because the extraction is best-effort.
/// </para>
/// </remarks>
public class LocationMatchTests
{
    private static PoolJob At(string? location) => new() { Id = "x", Location = location };

    private static bool Match(string? location, string? term) =>
        GreenhouseJobRepository.MatchesLocation(At(location), term);

    [Theory]
    // Every one of these is a real stored value.
    [InlineData("London, United Kingdom")]
    [InlineData("London, United Kingdom (remote)")]
    [InlineData("London, United Kingdom (hybrid)")]
    [InlineData("London, UK (hybrid)")]
    [InlineData("London, UK (remote)")]
    [InlineData("Cardiff, London or Remote (UK) (hybrid)")]
    [InlineData("Cardiff, London, United Kingdom (remote)")]
    [InlineData("London or Remote (UK) (hybrid)")]
    [InlineData("United Kingdom (remote)")]
    public void Every_real_UK_spelling_matches_United_Kingdom(string location)
    {
        Assert.True(Match(location, "United Kingdom"),
            $"'{location}' is a value the extraction actually wrote and must match a UK candidate.");
    }

    [Fact]
    public void The_one_UK_value_with_no_country_still_matches_on_the_city()
    {
        // 'London (hybrid)' carries no country at all. A country-only filter
        // misses it -- which is why a candidate's own city is worth passing as
        // the term when the country alone is too coarse.
        Assert.False(Match("London (hybrid)", "United Kingdom"));
        Assert.True(Match("London (hybrid)", "London"));
    }

    [Theory]
    [InlineData("Tel Aviv, Israel")]
    [InlineData("New York, NY (hybrid)")]
    [InlineData("Prague, Czech Republic (hybrid)")]
    [InlineData("Singapore")]
    [InlineData("Tokyo, Japan")]
    [InlineData("Barcelona")]
    public void Other_countries_do_not_match_a_UK_candidate(string location)
    {
        Assert.False(Match(location, "United Kingdom"));
        Assert.False(Match(location, "UK"));
    }

    [Fact]
    public void UK_and_United_Kingdom_are_the_same_country()
    {
        // Not a convenience: the extraction emits BOTH, on the same board, for
        // the same city. Without the alias a UK candidate loses whichever half
        // happened to be phrased the other way.
        Assert.True(Match("London, UK (hybrid)", "United Kingdom"));
        Assert.True(Match("London, United Kingdom", "UK"));
    }

    [Fact]
    public void Matching_is_case_insensitive()
    {
        Assert.True(Match("LONDON, UNITED KINGDOM", "united kingdom"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_posting_with_no_readable_location_passes(string? location)
    {
        // The pool's rule. The extraction is best-effort and a job it could not
        // read must not become invisible to everyone -- the filter fails OPEN.
        Assert.True(Match(location, "United Kingdom"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void A_candidate_with_no_location_constrains_nothing(string? term)
    {
        // Empty term means no constraint, not "match nothing" -- which would
        // return an empty scan for every profile that omitted a location.
        Assert.True(Match("Tel Aviv, Israel", term));
        Assert.True(Match("London, United Kingdom", term));
    }

    [Fact]
    public void A_country_the_aliases_do_not_know_still_matches_itself()
    {
        // The alias list is deliberately tiny. Anything not in it must still
        // work by plain substring, or adding a market would mean editing code.
        Assert.True(Match("Tel Aviv, Israel", "Israel"));
        Assert.True(Match("Prague, Czech Republic (hybrid)", "Czech Republic"));
        Assert.True(Match("Tokyo, Japan (hybrid)", "Japan"));
    }
}
