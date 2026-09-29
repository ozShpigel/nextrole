using ApplicationTracker.Infrastructure.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The place resolver both the ingest's pre-read filter and Matches read
/// (docs/plans/country-location-match.md).
/// </summary>
public class PlaceCountryTests
{
    [Theory]
    [InlineData("London, UK", new[] { "GB" })]                          // the profile said which London
    [InlineData("London, England", new[] { "GB" })]
    [InlineData("Open to relocation to London, UK", new[] { "GB" })]   // prose resolves by its places
    [InlineData("London", new[] { "CA", "GB" })]                        // it did not
    [InlineData("Barcelona, Spain", new[] { "ES" })]
    [InlineData("Tel Aviv, IL", new[] { "IL" })]                        // IL is also Illinois
    public void A_profile_is_the_countries_it_names_when_it_names_any(string location, string[] expected)
    {
        Assert.Equal(expected, Places.CountriesOfProfile(location).Order());
    }

    [Theory]
    [InlineData("Birmingham, Alabama, United States", new[] { "US" })]  // not GB: it says which Birmingham
    [InlineData("London, Ontario, Canada", new[] { "CA" })]
    [InlineData("London (hybrid)", new[] { "CA", "GB" })]
    [InlineData("Germany; London (hybrid)", new[] { "CA", "DE", "GB" })] // each place in the list counts
    [InlineData("Amsterdam, Netherlands; London, United Kingdom", new[] { "GB", "NL" })]
    // No part names one country, so the parts agree on one: measured 2026-09-29,
    // each passed a UK profile when a place was the plain union of its parts.
    [InlineData("Rochester, MN", new[] { "US" })]                        // GB/US, Minnesota/Mongolia
    [InlineData("Burlington, MA (hybrid)", new[] { "US" })]              // CA/US, Massachusetts/Morocco
    [InlineData("San Francisco, CA (hybrid)", new[] { "US" })]           // California, not Canada
    // Still Canada too: "Bay Area" is not in the table, so that place is just
    // "CA" -- truly both. It reaches only a bare "London" profile (GB and CA).
    [InlineData("Los Angeles, CA; Bay Area, CA", new[] { "CA", "US" })]
    public void A_posting_is_each_listed_place_read_like_a_profile(string location, string[] expected)
    {
        Assert.Equal(expected, Places.CountriesOfPosting(location).Order());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Remote (hybrid)")]   // words that are never places
    public void Nothing_recognised_is_empty(string? location)
    {
        Assert.Empty(Places.CountriesOfProfile(location));
        Assert.Empty(Places.CountriesOfPosting(location));
    }

    [Theory]
    [InlineData("ISR", "IL")]
    [InlineData("GBR", "GB")]
    [InlineData("DEU", "DE")]
    public void A_three_letter_country_code_is_its_country(string code, string country)
    {
        Assert.Contains(country, Places.CountriesOf(code));
    }

    [Fact]
    public void A_town_the_table_does_not_know_still_resolves_by_its_code()
    {
        // Applied Materials, 2026-09-29: the pre-read filter skipped this as
        // outside every served location before ISR was in the table.
        Assert.Contains("IL", Places.CountriesOf("Mig Ha'emek,ISR"));
    }

    [Fact]
    public void A_code_that_is_also_a_town_keeps_both()
    {
        // "can" is a town in Turkey as well as Canada's code; unioned, so
        // "Remote (CAN)" still reaches a Canadian candidate.
        Assert.Contains("CA", Places.CountriesOf("Remote (CAN)"));
    }
}
