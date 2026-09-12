using ApplicationTracker.Core.Matching;

namespace ArchitectureTests;

/// <summary>
/// The role list is capped, so a synonym of a role already being searched costs
/// a slot that a genuinely new role needs. These are the pairs that must
/// collapse — and, just as importantly, the ones that must not.
/// </summary>
public class RoleCanonicalizationTests
{
    [Theory]
    // Case and spacing.
    [InlineData("Backend Engineer", "backend engineer")]
    [InlineData("  backend   ENGINEER ", "backend engineer")]
    // Developer / Programmer / Engineer name one search.
    [InlineData("Backend Developer", "backend engineer")]
    [InlineData("Backend Programmer", "backend engineer")]
    // Seniority is never part of a search term.
    [InlineData("Senior Backend Engineer", "backend engineer")]
    [InlineData("Sr. Backend Developer", "backend engineer")]
    [InlineData("Staff Backend Engineer", "backend engineer")]
    [InlineData("Lead Backend Developer", "backend engineer")]
    // Word-boundary spellings.
    [InlineData("Back End Engineer", "backend engineer")]
    [InlineData("Back-End Developer", "backend engineer")]
    [InlineData("Full Stack Engineer", "fullstack engineer")]
    [InlineData("Full-Stack Developer", "fullstack engineer")]
    [InlineData("Front End Engineer", "frontend engineer")]
    // "DevOps" must survive the developer->engineer token rule intact.
    [InlineData("DevOps Engineer", "devops engineer")]
    [InlineData("Senior DevOps Developer", "devops engineer")]
    public void Spellings_of_the_same_search_collapse(string input, string expected) =>
        Assert.Equal(expected, RoleCanonicalizer.Canonicalize(input));

    [Theory]
    // Over-merging is worse than a duplicate: a duplicate costs one cap slot,
    // a wrong merge silently stops searching a role somebody needs.
    [InlineData("Data Engineer", "Data Scientist")]
    [InlineData("Backend Engineer", "Frontend Engineer")]
    [InlineData("DevOps Engineer", "Platform Engineer")]
    [InlineData("iOS Engineer", "Android Engineer")]
    [InlineData("Security Engineer", "Site Reliability Engineer")]
    [InlineData("Machine Learning Engineer", "Data Engineer")]
    public void Different_searches_stay_apart(string a, string b) =>
        Assert.NotEqual(RoleCanonicalizer.Canonicalize(a), RoleCanonicalizer.Canonicalize(b));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Nothing_in_nothing_out(string? input) =>
        Assert.Equal("", RoleCanonicalizer.Canonicalize(input));

    [Fact]
    public void A_role_that_is_only_seniority_keeps_something_to_key_on()
    {
        // Every token stripped would otherwise key as "", colliding with every
        // other unidentifiable role.
        Assert.NotEqual("", RoleCanonicalizer.Canonicalize("Senior Lead"));
    }

    [Fact]
    public void The_configured_baseline_roles_are_all_distinct()
    {
        // If two baseline roles ever canonicalised the same, the mirror would
        // publish one row for both and a real search would silently vanish.
        string[] baseline =
            ["Backend Engineer", "Platform Engineer", "DevOps Engineer", "Full Stack Engineer", "Software Engineer"];
        var keys = baseline.Select(RoleCanonicalizer.Canonicalize).ToList();
        Assert.Equal(keys.Count, keys.Distinct().Count());
    }
}
