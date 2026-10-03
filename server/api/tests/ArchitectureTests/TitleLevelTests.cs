using ApplicationTracker.Core.Matching;

namespace ArchitectureTests;

/// <summary>
/// The Matches Seniority and AI-roles filters, read from the title. Cases are
/// real titles from the Comeet boards (2026-10-03) unless noted.
/// </summary>
public class TitleLevelTests
{
    [Theory]
    [InlineData("Legal Intern", TitleLevel.Intern)]
    [InlineData("Security Analyst (Student Position)", TitleLevel.Intern)]
    [InlineData("Graduate QA Automation Engineer", TitleLevel.Junior)]
    [InlineData("Junior Cloud Security Validation Engineer", TitleLevel.Junior)]
    [InlineData("Associate Customer Success Engineer - France", TitleLevel.Junior)]
    [InlineData("Software Engineer", TitleLevel.Mid)]
    [InlineData("Product Manager", TitleLevel.Mid)]
    [InlineData("Senior Backend Engineer (Applied AI)", TitleLevel.Senior)]
    [InlineData("Sr. DevOps Engineer", TitleLevel.Senior)]                 // constructed
    [InlineData("System Architect", TitleLevel.Staff)]
    [InlineData("Backend Team Lead", TitleLevel.Staff)]
    [InlineData("SW Development Team Leader", TitleLevel.Staff)]
    [InlineData("Principal Engineer", TitleLevel.Staff)]                   // constructed
    [InlineData("Director, Web Strategy", TitleLevel.Director)]
    [InlineData("VP of Product Marketing", TitleLevel.Director)]
    [InlineData("Head of Platform", TitleLevel.Director)]                  // constructed
    public void Reads_the_level_from_the_title(string title, string expected) =>
        Assert.Equal(expected, TitleLevel.Of(title));

    [Theory]
    [InlineData("Senior Staff Engineer", TitleLevel.Staff)]         // Staff before Senior
    [InlineData("Senior Architect", TitleLevel.Staff)]
    [InlineData("Associate Director of Sales", TitleLevel.Director)] // Director before Junior's "associate"
    [InlineData("Senior Software Engineering Intern", TitleLevel.Intern)]
    public void A_title_has_exactly_one_level_the_first_in_order(string title, string expected) =>
        Assert.Equal(expected, TitleLevel.Of(title));

    [Theory]
    [InlineData("Leadership Coach")]       // "lead" only as a whole word
    [InlineData("Internal Tools Engineer")] // "intern" only as a whole word
    [InlineData("Seniority Analyst")]
    public void Words_match_whole_not_inside_other_words(string title) =>
        Assert.Equal(TitleLevel.Mid, TitleLevel.Of(title));

    [Fact]
    public void An_empty_title_is_mid() => Assert.Equal(TitleLevel.Mid, TitleLevel.Of(null));

    [Theory]
    [InlineData("LLM Inference Engineer", true)]
    [InlineData("AI Researcher", true)]
    [InlineData("Senior Backend Engineer (Applied AI)", true)]
    [InlineData("Data Scientist - Deep Learning Forecasting", true)]
    [InlineData("Machine Learning Engineer", true)]                  // constructed
    [InlineData("Data Engineer", false)]
    [InlineData("Software Engineer", false)]
    [InlineData("Email Marketing Manager", false)]                    // "ai" inside "email"
    public void Ai_roles_are_ai_work_named_in_the_title(string title, bool expected) =>
        Assert.Equal(expected, TitleLevel.IsAiRole(title));

    [Fact]
    public void Every_level_the_client_offers_is_known()
    {
        foreach (var level in new[] { "intern", "junior", "mid", "senior", "staff", "director" })
            Assert.Contains(level, TitleLevel.All);
        Assert.DoesNotContain("mid-senior level", TitleLevel.All);   // the old LinkedIn bands
    }

    [Fact]
    public void The_browser_copy_holds_every_server_pattern_verbatim()
    {
        // The unscored band is filtered in the browser (client/src/lib/titleLevel.ts)
        // and the scored list here: a pattern changed on one side only is a
        // chip that filters half the board.
        var client = File.ReadAllText(Path.Combine(RepoSources.Root, "client", "src", "lib", "titleLevel.ts"));
        foreach (var (level, pattern) in TitleLevel.Ordered)
            Assert.True(client.Contains($"['{level}', new RegExp(String.raw`{pattern}`, 'i')]"),
                $"titleLevel.ts does not hold the server's {level} pattern {pattern}");
        Assert.Contains($"String.raw`{TitleLevel.AiPattern}`", client);
    }
}
