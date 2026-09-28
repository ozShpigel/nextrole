using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The board list is configuration, and loading it is fatal when it is wrong.
/// </summary>
/// <remarks>
/// Every token in this file is invented. The only place a real board token
/// exists is <c>config/boards.json</c> -- which is what makes "one company to
/// fifty" an edit to that file and nothing else. Most tests here use the old
/// <c>companies</c> shape on purpose: it must keep loading exactly as it did.
/// </remarks>
public class BoardsConfigTests
{
    private static List<string> Tokens(BoardsConfig config) => [.. config.All.Select(b => b.Token)];

    private static string? Logo(BoardsConfig config, string token) =>
        config.LogoUrlFor(config.BoardFor($"greenhouse:{token}")!);

    private static string WriteTemp(string json)
    {
        var path = Path.Combine(Path.GetTempPath(), $"boards-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, json);
        return path;
    }

    [Fact]
    public void A_missing_file_is_fatal_rather_than_a_default_list()
    {
        // The failure this prevents is invisible: a run against a guessed board
        // list still ingests jobs, they are simply the wrong company's.
        Assert.Throws<FileNotFoundException>(() =>
            BoardsConfig.Load(Path.Combine(Path.GetTempPath(), $"absent-{Guid.NewGuid():N}.json")));
    }

    [Fact]
    public void The_same_domain_on_two_boards_is_fatal()
    {
        // The same company under two tokens: every posting would be stored,
        // read and scored twice. Case does not make it a different domain.
        var e = Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse("""
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
        var config = BoardsConfig.Parse("""
            { "companies": ["nice", "wizinc"],
              "company_domains": { "nice": "nice.com", "wizinc": "wiz.io" } }
            """);

        Assert.Equal(2, config.All.Count(b => b.Domain is not null));
    }

    [Fact]
    public void An_empty_company_list_is_fatal()
    {
        var path = WriteTemp("""{ "companies": [] }""");
        try
        {
            var e = Assert.Throws<InvalidOperationException>(() => BoardsConfig.Load(path));
            Assert.Contains("no boards", e.Message);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void A_list_of_only_blanks_is_empty_and_therefore_fatal()
    {
        var path = WriteTemp("""{ "companies": ["", "   "] }""");
        try
        {
            Assert.Throws<InvalidOperationException>(() => BoardsConfig.Load(path));
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
            var config = BoardsConfig.Load(path);

            Assert.Equal(["alpha-co", "beta_co"], Tokens(config));
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
        var properties = typeof(BoardsConfig).GetProperties().Select(p => p.Name).ToList();

        Assert.DoesNotContain(nameof(GreenhouseEmbeddingOptions.Model), properties);
        Assert.DoesNotContain(nameof(GreenhouseEmbeddingOptions.Dimensions), properties);
    }

    [Fact]
    public void The_comment_keys_in_the_shipped_file_do_not_break_the_parse()
    {
        // config/boards.json carries _comment keys, the way roles.json does.
        var path = WriteTemp("""
            { "_comment": "why this list looks like this", "companies": ["alpha-co"] }
            """);
        try
        {
            Assert.Equal(["alpha-co"], Tokens(BoardsConfig.Load(path)));
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
            var e = Assert.Throws<InvalidOperationException>(() => BoardsConfig.Load(path));
            Assert.Contains("not a valid greenhouse board token", e.Message);
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
            Assert.Equal(["zeta-co", "alpha-co"], Tokens(BoardsConfig.Load(path)));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Trims_surrounding_whitespace()
    {
        var path = WriteTemp("""{ "companies": ["  alpha-co  "] }""");
        try
        {
            Assert.Equal(["alpha-co"], Tokens(BoardsConfig.Load(path)));
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
            Assert.Throws<InvalidOperationException>(() => BoardsConfig.Load(path));
        }
        finally { File.Delete(path); }
    }

    // ---- company domains, for logos ------------------------------------------

    [Fact]
    public void Resolves_a_logo_url_from_the_configured_domain()
    {
        var config = BoardsConfig.Parse("""
            {
              "companies": ["alpha-co", "beta-co"],
              "company_domains": { "Alpha-Co": " Alpha.example " },
              "logo_url_template": "https://logos.test/{domain}.png"
            }
            """);

        // Matched case-insensitively and normalised, the way tokens are.
        Assert.Equal("https://logos.test/alpha.example.png", Logo(config, "alpha-co"));
        // No domain, no logo: the card falls back to its initial.
        Assert.Null(Logo(config, "beta-co"));
    }

    [Fact]
    public void Defaults_to_the_keyless_favicon_service()
    {
        var config = BoardsConfig.Parse("""
            { "companies": ["alpha-co"], "company_domains": { "alpha-co": "alpha.example" } }
            """);

        Assert.Equal(
            "https://www.google.com/s2/favicons?domain=alpha.example&sz=128",
            Logo(config, "alpha-co"));
    }

    [Fact]
    public void A_domain_for_an_unlisted_token_is_fatal()
    {
        // A typo in one of the two. Guessing which would put a logo on the
        // wrong board, or silently on none.
        var e = Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse("""
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
        Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse(
            $$"""{ "companies": ["alpha-co"], "company_domains": { "alpha-co": "{{domain}}" } }"""));
    }

    [Theory]
    [InlineData("https://logos.test/fixed.png")]
    [InlineData("http://logos.test/{domain}")]
    public void A_template_without_the_placeholder_or_https_is_fatal(string template)
    {
        // Without {domain}, every company would show the same logo.
        Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse(
            $$"""{ "companies": ["alpha-co"], "logo_url_template": "{{template}}" }"""));
    }

    [Theory]
    [InlineData("boards.json")]
    [InlineData("boards.dev.json")]   // the local default (docker-compose.yml)
    public void The_shipped_file_loads(string file)
    {
        // The real file is the one config a typo in it would break in
        // production, so it is parsed here rather than trusted.
        var relative = Path.Combine("server", "api", "src", "Greenhouse", "config", file);
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, relative)))
            dir = Path.GetDirectoryName(dir);
        Assert.NotNull(dir);

        var config = BoardsConfig.Load(Path.Combine(dir!, relative));

        // Every shipped board is on a known source and has a domain, so a logo.
        Assert.All(config.All, board => Assert.NotNull(config.LogoUrlFor(board)));
    }

    [Fact]
    public void ForTesting_applies_the_same_validation_as_the_file()
    {
        // The in-memory path tests use must not be a laxer one, or the tests
        // would be exercising a config shape the file could never produce.
        Assert.Throws<InvalidOperationException>(() => BoardsConfig.ForTesting());
        Assert.Throws<InvalidOperationException>(() => BoardsConfig.ForTesting("not a token"));
        Assert.Equal(["alpha-co"], Tokens(BoardsConfig.ForTesting("alpha-co")));
    }

    [Fact]
    public void The_shipped_config_file_is_valid()
    {
        // Guards the file itself, not just the loader. A typo in
        // config/boards.json otherwise fails for the first time in
        // production, at 05:30 UTC.
        var path = Path.Combine(
            RepoRoot(), "server", "api", "src", "Greenhouse", "config", "boards.json");

        Assert.True(File.Exists(path), $"Expected the shipped board list at {path}");

        var config = BoardsConfig.Load(path);
        Assert.NotEmpty(config.All);
        // Written in the new shape: the old one is only for paths still set to an old file.
        Assert.Contains("\"boards\"", File.ReadAllText(path));
        Assert.True(config.EmbedBatchTokenBudget > 0);
        Assert.True(config.MaxBatchItems > 0);
    }

    [Fact]
    public void The_path_the_shipped_appsettings_resolves_to_is_a_file_that_ships()
    {
        // The phase 3 deploy failed exactly here: appsettings.json still set
        // Companies:ConfigPath to companies.json, which outranks the default,
        // after the file was renamed. The shipped-file tests above loaded
        // boards.json by name and passed. This resolves the path the way the
        // process does -- same file, same method -- and loads what it names.
        var project = Path.Combine(RepoRoot(), "server", "api", "src", "Greenhouse");
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(project, "appsettings.json"), optional: false)
            .Build();

        var resolved = BoardsConfig.PathFrom(configuration);

        Assert.True(File.Exists(Path.Combine(project, resolved)),
            $"appsettings.json resolves the boards config to {resolved}, which does not exist in {project}");
        Assert.NotEmpty(BoardsConfig.Load(Path.Combine(project, resolved)).All);
    }

    // ---- the boards shape (docs/plans/board-config.md) -------------------------

    [Fact]
    public void Loads_boards_with_their_source_token_and_domain()
    {
        var config = BoardsConfig.Parse("""
            { "boards": [
                { "source": "greenhouse", "token": " alpha-co ", "domain": "Alpha.Example" },
                { "source": "greenhouse", "token": "beta-co", "name": "Beta" }
            ] }
            """);

        Assert.Equal(["greenhouse:alpha-co", "greenhouse:beta-co"], config.All.Select(b => b.Key));
        Assert.Equal("alpha.example", config.All[0].Domain);
        Assert.Null(config.All[1].Domain);
        Assert.Equal("Beta", config.All[1].Name);
        Assert.Same(config.All[1], config.BoardFor("GREENHOUSE:Beta-Co"));
        Assert.Null(config.BoardFor("greenhouse:gamma-co"));
    }

    [Fact]
    public void The_old_shape_loads_as_the_same_greenhouse_boards()
    {
        // A path still pointing at an old companies.json keeps working, and
        // means exactly what it meant.
        var old = BoardsConfig.Parse("""
            { "companies": ["alpha-co", "beta-co"], "company_domains": { "alpha-co": "alpha.example" } }
            """);
        var current = BoardsConfig.Parse("""
            { "boards": [
                { "source": "greenhouse", "token": "alpha-co", "domain": "alpha.example" },
                { "source": "greenhouse", "token": "beta-co" }
            ] }
            """);

        Assert.Equal(current.All, old.All);
    }

    [Fact]
    public void Both_shapes_in_one_file_is_fatal()
    {
        // Two lists that can disagree about what runs.
        var e = Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse("""
            { "boards": [ { "source": "greenhouse", "token": "alpha-co" } ], "companies": ["beta-co"] }
            """));
        Assert.Contains("both boards and companies", e.Message);
    }

    [Fact]
    public void A_board_on_an_unknown_source_is_fatal()
    {
        var e = Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse("""
            { "boards": [ { "source": "workday", "token": "acme" } ] }
            """));
        Assert.Contains("'workday'", e.Message);
        Assert.Contains("greenhouse", e.Message);   // and says which sources ARE known
    }

    [Fact]
    public void A_board_listed_twice_is_fatal_rather_than_dropped()
    {
        // With a source and a domain on each entry, two copies can disagree;
        // silently keeping the first would pick one without saying so.
        var e = Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse("""
            { "boards": [
                { "source": "greenhouse", "token": "alpha-co", "domain": "alpha.example" },
                { "source": "greenhouse", "token": "Alpha-Co" }
            ] }
            """));
        Assert.Contains("twice", e.Message);
    }

    [Fact]
    public void The_same_domain_on_two_boards_is_fatal_in_the_new_shape_too()
    {
        var e = Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse("""
            { "boards": [
                { "source": "greenhouse", "token": "alpha-co", "domain": "alpha.example" },
                { "source": "greenhouse", "token": "alpha-uk", "domain": "ALPHA.example" }
            ] }
            """));
        Assert.Contains("greenhouse:alpha-co", e.Message);
        Assert.Contains("greenhouse:alpha-uk", e.Message);
    }

    [Theory]
    [InlineData("""{ "boards": [] }""")]
    [InlineData("""{ "boards": [ { "source": "greenhouse", "token": "" } ] }""")]
    [InlineData("""{ "boards": [ { "source": "greenhouse", "token": "not a token" } ] }""")]
    [InlineData("""{ "boards": [ { "token": "alpha-co" } ] }""")]
    public void A_malformed_board_list_is_fatal(string json) =>
        Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse(json));

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
