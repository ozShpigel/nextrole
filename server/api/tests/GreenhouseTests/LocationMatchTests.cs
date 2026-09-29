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
        // 'London (hybrid)' carries no country at all. The term alone could
        // not see it -- this asserted False until the country check -- and
        // London resolves to the UK (among others), so now it does.
        Assert.True(Match("London (hybrid)", "United Kingdom"));
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

        // Once the gap: the term alone could not see it. Closed first by
        // asking whether the candidate's own location says London, and now by
        // the country too -- London is in the UK.
        Assert.True(Match("London", "UK"));
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
        // and must simply not match rather than throw or pass everything. (A
        // city in another country: London would now pass a UK term by country.)
        Assert.False(Match("Barcelona", "UK", null));
        Assert.False(Match("Barcelona", "UK", ""));
        Assert.False(Match("Barcelona", "UK", "   "));
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

    // ── By country (docs/plans/country-location-match.md) ────────────────────
    //
    // Measured 2026-09-29 over every open posting: the text rule alone had a
    // "London, UK" profile missing ~38 London postings, a bare "London" missing
    // ~270 UK ones outside London, and "London, England" seeing 22 of ~577.
    // Every location below is a real stored value from that run.

    public static readonly TheoryData<string> MeasuredUkSpellings =
    [
        "London (hybrid)", "London, England (hybrid)", "London; Sunnyvale (hybrid)", "London, England",
        "London", "London, United Kingdom (hybrid)", "United Kingdom (remote)", "UK (remote)",
        "Cardiff, London or Remote (UK)", "Crawley, United Kingdom", "Glasgow, United Kingdom",
        "Manchester, United Kingdom (hybrid)", "Reading, United Kingdom", "Cambridge, UK",
        "Edinburgh, UK (hybrid)", "Belfast, United Kingdom", "Cheadle, United Kingdom", "Uxbridge, UK (hybrid)",
        "Ware, UK", "London, England, United Kingdom", "Remote (UK)",
        "Amsterdam, Netherlands; London, United Kingdom", "Israel; London; Mountain View (hybrid)",
        "Germany; London (hybrid)", "Leonberg, Germany; London (hybrid)", "Amsterdam; Paris; London",
    ];

    // As Matches builds them: the term is the profile location's last part.
    public static readonly TheoryData<string, string> UkProfiles = new()
    {
        { "UK", "London, UK" },
        { "United Kingdom", "London, United Kingdom" },
        { "England", "London, England" },
        { "London", "London" },
        { "UK", "Manchester, UK" },
        { "UK", "Open to relocation to London, UK" },
    };

    public static TheoryData<string, string, string> EveryUkSpellingForEveryUkProfile()
    {
        var data = new TheoryData<string, string, string>();
        foreach (var location in MeasuredUkSpellings)
            foreach (var profile in UkProfiles)
                data.Add(location, (string)profile[0], (string)profile[1]);
        return data;
    }

    [Theory]
    [MemberData(nameof(EveryUkSpellingForEveryUkProfile))]
    public void Every_measured_UK_spelling_reaches_every_way_a_UK_profile_is_written(
        string location, string term, string profileLocation)
    {
        Assert.True(Match(location, term, profileLocation),
            $"'{location}' is a UK posting and must reach a profile located '{profileLocation}'.");
    }

    [Theory]
    // Measured in the same run, and not in the UK.
    [InlineData("New York, NY (hybrid)")]
    [InlineData("Birmingham, Alabama, United States")]   // England has a Birmingham too
    [InlineData("New York, USA (remote)")]
    [InlineData("Amsterdam, Netherlands")]
    [InlineData("Tel Aviv, Israel")]
    [InlineData("London, Ontario, Canada")]              // the profile said which London
    [InlineData("Rochester, MN")]                        // measured: England has a Rochester too
    public void A_named_UK_profile_does_not_take_postings_from_elsewhere(string location)
    {
        Assert.False(Match(location, "UK", "London, UK"));
        Assert.False(Match(location, "England", "London, England"));
    }

    [Fact]
    public void A_bare_London_profile_also_takes_London_Ontario()
    {
        // The accepted cost: "London" alone does not say which, and reading it
        // as both is the only reading that cannot hide a UK posting.
        Assert.True(Match("London, Ontario, Canada", "London", "London"));
        Assert.False(Match("Amsterdam, Netherlands", "London", "London"));
    }

    [Theory]
    // Measured 2026-09-29: each passed a bare "London" profile when a place was
    // the plain union of its parts -- "CA" is Canada's code as well as
    // California, "MA" Morocco's as well as Massachusetts.
    [InlineData("Burlington, MA (hybrid)")]
    [InlineData("San Francisco, CA (hybrid)")]
    [InlineData("Los Angeles, CA")]
    [InlineData("Rochester, MN")]
    public void A_bare_London_profile_does_not_take_US_places_that_share_a_code(string location)
    {
        Assert.False(Match(location, "London", "London"));
    }

    [Theory]
    // Applied Materials writes the three-letter code.
    [InlineData("Mig Ha'emek,ISR", "Israel", "Tel Aviv, Israel")]
    [InlineData("Rehovot,ISR", "Israel", "Rishon LeZion, Israel")]
    [InlineData("England-Berkshire,GBR", "UK", "London, UK")]
    public void A_three_letter_country_code_is_its_country(string location, string term, string profileLocation)
    {
        Assert.True(Match(location, term, profileLocation));
    }

    [Theory]
    // Whatever the countries say, a posting the text rule keeps is kept: the
    // country check only ever adds. "Kyiv, Ukraine" contains "uk" -- a known,
    // unmeasured-in-practice false positive of the text rule, unchanged here.
    [InlineData("Kyiv, Ukraine", "UK", "London, UK")]
    [InlineData("Somewhere, Israel", "Israel", "Tel Aviv, Israel")]
    public void The_text_rule_still_keeps_what_it_kept(string location, string term, string profileLocation)
    {
        Assert.True(Match(location, term, profileLocation));
    }
}
