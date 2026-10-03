using ApplicationTracker.Core.Matching;

namespace ArchitectureTests;

// The pool's company_profile arrives as an untyped dictionary; passing an EMPTY
// version of it to the Evaluator would spend tokens on a block that says
// nothing. (The Glassdoor-evidence guard that lived here went with the review
// machinery, 2026-10-03.)
public class PoolEnrichmentTests
{
    // --- company profile --------------------------------------------------

    [Fact]
    public void An_empty_company_profile_is_null_not_a_blank_record()
    {
        // An all-null record would make PromptBuilder emit a <company_profile>
        // block containing nothing, spending input tokens on every job to say
        // so.
        Assert.Null(PoolEnrichment.CompanyProfileFrom(null));
        Assert.Null(PoolEnrichment.CompanyProfileFrom(new Dictionary<string, object?>()));
        Assert.Null(PoolEnrichment.CompanyProfileFrom(
            new Dictionary<string, object?> { ["industry"] = null, ["url"] = "" }));
    }

    [Fact]
    public void Company_profile_keeps_only_the_documented_fields()
    {
        // The scraper owns that collection's schema and can add fields at any
        // time; the prompt documents five. Anything else is dropped rather than
        // forwarded to the model as unlabelled data.
        var raw = new Dictionary<string, object?>
        {
            ["industry"] = "Software Development",
            ["url"] = "https://www.linkedin.com/company/example",
            ["somethingTheScraperAddedLater"] = "should not reach the prompt",
        };

        var profile = PoolEnrichment.CompanyProfileFrom(raw);

        Assert.NotNull(profile);
        Assert.Equal("Software Development", profile!.Industry);
        Assert.Equal("https://www.linkedin.com/company/example", profile.Url);
        Assert.Null(profile.Description);
        Assert.Null(profile.NumEmployees);
        Assert.Null(profile.Revenue);
    }

    [Fact]
    public void The_live_shape_survives_the_round_trip()
    {
        // Exactly what every one of the 90 scannable pool documents carries.
        var raw = new Dictionary<string, object?>
        {
            ["industry"] = "Software Development",
            ["url"] = "https://il.linkedin.com/company/example",
        };

        var profile = PoolEnrichment.CompanyProfileFrom(raw);

        Assert.NotNull(profile);
        Assert.Equal("Software Development", profile!.Industry);
    }
}
