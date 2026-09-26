using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The board list is configuration, and loading it is fatal when it is wrong.
/// </summary>
/// <remarks>
/// Every token in this file is invented. The only place a real Greenhouse token
/// exists is <c>config/companies.json</c> -- which is what makes "one company to
/// fifty" an edit to that file and nothing else.
/// </remarks>
public class CompaniesConfigTests
{
    private static string WriteTemp(string json)
    {
        var path = Path.Combine(Path.GetTempPath(), $"companies-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, json);
        return path;
    }

    [Fact]
    public void A_missing_file_is_fatal_rather_than_a_default_list()
    {
        // The failure this prevents is invisible: a run against a guessed board
        // list still ingests jobs, they are simply the wrong company's.
        Assert.Throws<FileNotFoundException>(() =>
            CompaniesConfig.Load(Path.Combine(Path.GetTempPath(), $"absent-{Guid.NewGuid():N}.json")));
    }

    [Fact]
    public void The_same_domain_on_two_boards_is_fatal()
    {
        // The same company under two tokens: every posting would be stored,
        // read and scored twice. Case does not make it a different domain.
        var e = Assert.Throws<InvalidOperationException>(() => CompaniesConfig.Parse("""
            { "companies": ["nice", "niceltd", "wizinc"],
              "company_domains": { "nice": "nice.com", "niceltd": "NICE.com", "wizinc": "wiz.io" } }
            """));

        Assert.Contains("nice.com", e.Message);
        Assert.Contains("nice", e.Message);
        Assert.Contains("niceltd", e.Message);
    }

    [Fact]
    public void Distinct_domains_load()
    {
        var config = CompaniesConfig.Parse("""
            { "companies": ["nice", "wizinc"],
              "company_domains": { "nice": "nice.com", "wizinc": "wiz.io" } }
            """);

        Assert.Equal(2, config.CompanyDomains.Count);
    }

    [Fact]
    public void An_empty_company_list_is_fatal()
    {
        var path = WriteTemp("""{ "companies": [] }""");
        try
        {
            var e = Assert.Throws<InvalidOperationException>(() => CompaniesConfig.Load(path));
            Assert.Contains("no companies", e.Message);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void A_list_of_only_blanks_is_empty_and_therefore_fatal()
    {
        var path = WriteTemp("""{ "companies": ["", "   "] }""");
        try
        {
            Assert.Throws<InvalidOperationException>(() => CompaniesConfig.Load(path));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Loads_tokens_and_batch_limits_from_the_file()
    {
        var path = WriteTemp("""
            {
              "companies": ["alpha-co", "beta_co"],
              "embed_batch_token_budget": 50000,
              "max_batch_items": 64
            }
            """);
        try
        {
            var config = CompaniesConfig.Load(path);

            Assert.Equal(["alpha-co", "beta_co"], config.Companies);
            Assert.Equal(50_000, config.EmbedBatchTokenBudget);
            Assert.Equal(64, config.MaxBatchItems);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void The_model_and_dimensions_are_deliberately_not_in_this_file()
    {
        // They live in GreenhouseEmbeddingOptions, which the API binds too.
        // This file ships inside the ingestion image and the API cannot read
        // it, so a model named here could differ from the one retrieval uses --
        // and that disagreement produces an empty result set, not an error.
        var properties = typeof(CompaniesConfig).GetProperties().Select(p => p.Name).ToList();

        Assert.DoesNotContain(nameof(GreenhouseEmbeddingOptions.Model), properties);
        Assert.DoesNotContain(nameof(GreenhouseEmbeddingOptions.Dimensions), properties);
    }

    [Fact]
    public void The_comment_keys_in_the_shipped_file_do_not_break_the_parse()
    {
        // config/companies.json carries _comment keys, the way roles.json does.
        var path = WriteTemp("""
            { "_comment": "why this list looks like this", "companies": ["alpha-co"] }
            """);
        try
        {
            Assert.Equal(["alpha-co"], CompaniesConfig.Load(path).Companies);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Rejects_something_that_is_not_a_board_token()
    {
        // A URL or a display name pasted in instead of the slug. Left alone it
        // becomes a 404 that reads as the company's fault rather than the
        // file's -- or a path traversal into another API route.
        var path = WriteTemp("""{ "companies": ["https://boards.greenhouse.io/alpha"] }""");
        try
        {
            var e = Assert.Throws<InvalidOperationException>(() => CompaniesConfig.Load(path));
            Assert.Contains("not a valid Greenhouse board token", e.Message);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void De_duplicates_case_insensitively_while_keeping_the_file_order()
    {
        var path = WriteTemp("""{ "companies": ["zeta-co", "alpha-co", "Zeta-Co"] }""");
        try
        {
            // Order is the human's, not sorted: the run log then reads the way
            // the list was written.
            Assert.Equal(["zeta-co", "alpha-co"], CompaniesConfig.Load(path).Companies);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Trims_surrounding_whitespace()
    {
        var path = WriteTemp("""{ "companies": ["  alpha-co  "] }""");
        try
        {
            Assert.Equal(["alpha-co"], CompaniesConfig.Load(path).Companies);
        }
        finally { File.Delete(path); }
    }

    [Theory]
    [InlineData("""{ "companies": ["alpha-co"], "embed_batch_token_budget": 0 }""")]
    [InlineData("""{ "companies": ["alpha-co"], "max_batch_items": 0 }""")]
    public void Rejects_a_nonsensical_limit(string json)
    {
        var path = WriteTemp(json);
        try
        {
            Assert.Throws<InvalidOperationException>(() => CompaniesConfig.Load(path));
        }
        finally { File.Delete(path); }
    }

    // ---- company domains, for logos ------------------------------------------

    [Fact]
    public void Resolves_a_logo_url_from_the_configured_domain()
    {
        var config = CompaniesConfig.Parse("""
            {
              "companies": ["alpha-co", "beta-co"],
              "company_domains": { "Alpha-Co": " Alpha.example " },
              "logo_url_template": "https://logos.test/{domain}.png"
            }
            """);

        // Matched case-insensitively and normalised, the way tokens are.
        Assert.Equal("https://logos.test/alpha.example.png", config.LogoUrlFor("alpha-co"));
        // No domain, no logo: the card falls back to its initial.
        Assert.Null(config.LogoUrlFor("beta-co"));
    }

    [Fact]
    public void Defaults_to_the_keyless_favicon_service()
    {
        var config = CompaniesConfig.Parse("""
            { "companies": ["alpha-co"], "company_domains": { "alpha-co": "alpha.example" } }
            """);

        Assert.Equal(
            "https://www.google.com/s2/favicons?domain=alpha.example&sz=128",
            config.LogoUrlFor("alpha-co"));
    }

    [Fact]
    public void A_domain_for_an_unlisted_token_is_fatal()
    {
        // A typo in one of the two. Guessing which would put a logo on the
        // wrong board, or silently on none.
        var e = Assert.Throws<InvalidOperationException>(() => CompaniesConfig.Parse("""
            { "companies": ["alpha-co"], "company_domains": { "alpha-cp": "alpha.example" } }
            """));
        Assert.Contains("not in companies", e.Message);
    }

    [Theory]
    [InlineData("https://alpha.example")]
    [InlineData("alpha.example/careers")]
    [InlineData("alpha")]
    [InlineData("")]
    public void A_domain_that_is_not_a_bare_hostname_is_fatal(string domain)
    {
        Assert.Throws<InvalidOperationException>(() => CompaniesConfig.Parse(
            $$"""{ "companies": ["alpha-co"], "company_domains": { "alpha-co": "{{domain}}" } }"""));
    }

    [Theory]
    [InlineData("https://logos.test/fixed.png")]
    [InlineData("http://logos.test/{domain}")]
    public void A_template_without_the_placeholder_or_https_is_fatal(string template)
    {
        // Without {domain}, every company would show the same logo.
        Assert.Throws<InvalidOperationException>(() => CompaniesConfig.Parse(
            $$"""{ "companies": ["alpha-co"], "logo_url_template": "{{template}}" }"""));
    }

    [Theory]
    [InlineData("companies.json")]
    [InlineData("companies.dev.json")]   // the local default (docker-compose.yml)
    public void The_shipped_file_loads(string file)
    {
        // The real file is the one config a typo in it would break in
        // production, so it is parsed here rather than trusted.
        var relative = Path.Combine("server", "api", "src", "Greenhouse", "config", file);
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, relative)))
            dir = Path.GetDirectoryName(dir);
        Assert.NotNull(dir);

        var config = CompaniesConfig.Load(Path.Combine(dir!, relative));

        Assert.All(config.CompanyDomains.Keys, token => Assert.NotNull(config.LogoUrlFor(token)));
    }

    [Fact]
    public void ForTesting_applies_the_same_validation_as_the_file()
    {
        // The in-memory path tests use must not be a laxer one, or the tests
        // would be exercising a config shape the file could never produce.
        Assert.Throws<InvalidOperationException>(() => CompaniesConfig.ForTesting());
        Assert.Throws<InvalidOperationException>(() => CompaniesConfig.ForTesting("not a token"));
        Assert.Equal(["alpha-co"], CompaniesConfig.ForTesting("alpha-co").Companies);
    }

    [Fact]
    public void The_shipped_config_file_is_valid()
    {
        // Guards the file itself, not just the loader. A typo in
        // config/companies.json otherwise fails for the first time in
        // production, at 05:30 UTC.
        var path = Path.Combine(
            RepoRoot(), "server", "api", "src", "Greenhouse", "config", "companies.json");

        Assert.True(File.Exists(path), $"Expected the shipped board list at {path}");

        var config = CompaniesConfig.Load(path);
        Assert.NotEmpty(config.Companies);
        Assert.True(config.EmbedBatchTokenBudget > 0);
        Assert.True(config.MaxBatchItems > 0);
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "AGENTS.md"))) return dir.FullName;
            dir = dir.Parent;
        }
        throw new InvalidOperationException("Could not find the repository root.");
    }
}
