using ApplicationTracker.Core.Matching;
using ApplicationTracker.Infrastructure.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The post-filter that decides whether a retrieved posting is somewhere the
/// candidate would work.
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
/// <para>
/// It asks the question in both directions. Does the posting name the
/// candidate's country (or an alias of it)? Failing that, does the candidate's
/// own stated location name the posting's place? The second is what reaches a
/// posting located only "London" -- 14 of 132 measured -- without extracting a
/// city out of prose like "Open to relocation to London, UK".
/// </para>
/// </remarks>
public class LocationMatchTests
{
    private static PoolJob At(string? location) => new() { Id = "x", Location = location };

    private static bool Match(string? location, string? term) =>
        GreenhouseJobRepository.MatchesLocation(At(location), term);

    private static bool Match(string? location, string? term, string? candidateLocation) =>
        GreenhouseJobRepository.MatchesLocation(At(location), term, candidateLocation);

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
        // 'London (hybrid)' carries no country at all, so the country term
        // alone cannot see it.
        Assert.False(Match("London (hybrid)", "United Kingdom"));
        Assert.True(Match("London (hybrid)", "London"));
    }

    // ── A posting that names a city and no country ───────────────────────────
    //
    // 14 of 132 real postings on the monzo and similarweb boards were located
    // exactly "London" -- the second most common form there, and invisible to
    // a UK candidate while the only question asked was whether the posting
    // contained the candidate's country.

    [Fact]
    public void A_bare_city_matches_a_candidate_whose_location_names_that_city()
    {
        // Maya's real profile string, extracted verbatim from an uploaded CV.
        const string candidate = "Open to relocation to London, UK";

        // The gap: country-only cannot see it.
        Assert.False(Match("London", "UK"));

        // Closed by asking whether the candidate's own location says London.
        Assert.True(Match("London", "UK", candidate));
    }

    [Theory]
    [InlineData("London")]
    [InlineData("London, England")]
    public void The_same_holds_for_a_plain_city_profile(string postingLocation)
    {
        // A profile of "London, England" yields the term "England" -- the
        // trailing segment -- so the country path misses a bare "London" here
        // too. The term is deliberately the derived one, not "London", or this
        // would pass on the forward path and prove nothing.
        Assert.True(Match(postingLocation, "England", "London, England"));
    }

    [Theory]
    [InlineData("Barcelona")]
    [InlineData("Tel Aviv, Israel")]
    [InlineData("Prague")]
    [InlineData("Singapore")]
    [InlineData("New York, NY")]
    public void A_bare_city_elsewhere_still_does_not_match(string postingLocation)
    {
        // The reverse question must not become a way in for everything: the
        // candidate's location says London, and says none of these.
        Assert.False(Match(postingLocation, "UK", "Open to relocation to London, UK"));
    }

    [Fact]
    public void A_short_posting_location_does_not_match_inside_a_word()
    {
        // Substring would pass this: "penny lane, uk" contains "ny". The match
        // is word-bounded precisely so a two-letter location cannot land in the
        // middle of an unrelated word.
        Assert.False(Match("NY", "UK", "Penny Lane, UK"));

        // Still matches when it really is its own word.
        Assert.True(Match("NY", "USA", "Brooklyn, NY"));
    }

    [Fact]
    public void The_reverse_check_is_case_insensitive_and_absence_safe()
    {
        Assert.True(Match("LONDON", "UK", "open to relocation to london, uk"));

        // No candidate location at all: the reverse question cannot be asked,
        // and must simply not match rather than throw or pass everything.
        Assert.False(Match("London", "UK", null));
        Assert.False(Match("London", "UK", ""));
        Assert.False(Match("London", "UK", "   "));
    }

    [Fact]
    public void The_country_path_is_unaffected_by_the_reverse_check()
    {
        // A posting that already matches on the country must not depend on the
        // candidate's raw string being present or well-formed.
        Assert.True(Match("London, United Kingdom", "UK", null));
        Assert.True(Match("Cardiff, London or Remote (UK)", "UK", null));
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
