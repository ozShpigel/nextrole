using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Infrastructure.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The seniority post-filter the Greenhouse candidate search was missing.
/// </summary>
/// <remarks>
/// The LinkedIn pool always narrowed candidates to the profile's band and one
/// either side, in its Mongo query. The Greenhouse source filtered by location
/// only, so a senior engineer's band carried Deliveroo's "Software Engineer,
/// New Grad" -- and every such posting cost a Claude call once the reader
/// scrolled to it. Same rule, including permissive on absence.
/// </remarks>
public class SeniorityMatchTests
{
    private static PoolJob Job(string? seniority) => new() { Id = "1", Title = "t", Seniority = seniority };

    private static IReadOnlyList<string> BandsOf(string profileSeniority) =>
        CandidateFilter.FromProfile(new StructuredProfile { Seniority = profileSeniority }).SeniorityBands;

    [Theory]
    [InlineData("mid-senior level", true)]
    [InlineData("associate", true)]      // one band below: still shown
    [InlineData("director", true)]       // one band above: still shown
    [InlineData("entry level", false)]   // "Software Engineer, New Grad"
    [InlineData("executive", false)]
    public void A_senior_candidate_sees_their_band_and_one_either_side(string posting, bool expected)
    {
        Assert.Equal(expected, GreenhouseJobRepository.MatchesSeniority(Job(posting), BandsOf("Senior Backend Engineer")));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void A_posting_with_no_stated_band_is_never_hidden(string? posting)
    {
        Assert.True(GreenhouseJobRepository.MatchesSeniority(Job(posting), BandsOf("Senior Backend Engineer")));
    }

    [Fact]
    public void A_profile_with_no_seniority_constrains_nothing()
    {
        Assert.True(GreenhouseJobRepository.MatchesSeniority(Job("entry level"), []));
    }

    [Fact]
    public void Band_comparison_ignores_case_and_padding()
    {
        Assert.True(GreenhouseJobRepository.MatchesSeniority(Job(" Mid-Senior Level "), ["mid-senior level"]));
    }
}
