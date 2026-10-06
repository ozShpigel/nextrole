using System.Net;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GreenhouseTests;

/// <summary>Canned scraper responses, shaped as server/scraper's POST /scrape returns them.</summary>
internal static class LinkedIn
{
    public static readonly BoardConfig Board = new()
    {
        Source = "linkedin", Token = "israel",
        Titles = ["DevOps Engineer", "Backend Engineer"], Locations = ["Israel"], ResultsWanted = 50, HoursOld = 48,
    };

    // Boards a LinkedIn posting must not duplicate.
    public static readonly BoardConfig[] CompanyBoards =
    [
        new() { Source = "greenhouse", Token = "wiz", Domain = "wiz.io", Aliases = ["Wiz Security"] },
        new() { Source = "comeet", Token = "fetcherr", Domain = "fetcherr.io", CompanyUid = "68.006", ApiToken = "abc" },
        new() { Source = "workday", Token = "nvidia", Name = "NVIDIA", Host = "nvidia.wd5", Tenant = "x", Site = "y" },
        new() { Source = "lever", Token = "acmeco", Name = "Acme Co" },
    ];

    public static LinkedInSource Source(StubHandler stub, IEnumerable<BoardConfig>? boards = null) =>
        new(new HttpClient(stub) { BaseAddress = new Uri("http://scraper:8080/") },
            boards ?? CompanyBoards, NullLogger<LinkedInSource>.Instance);

    public static LinkedInSource Over(HttpStatusCode status, string body, IEnumerable<BoardConfig>? boards = null) =>
        Source(new StubHandler().EnqueueJson(status, body), boards);

    public static readonly string LongText = string.Concat(Enumerable.Repeat(
        "Run our Kubernetes platform on AWS and own CI/CD for forty engineers. ", 6));

    // id is the scraper's own row id: a fresh UUID every scrape, never the key.
    public static string Job(string id, string url, string company, string title = "DevOps Engineer",
        string? description = null, string? date = "2026-10-03", string? direct = null) => $$"""
        { "id": "{{id}}", "title": "{{title}}", "company": "{{company}}", "location": "Tel Aviv, Israel",
          "description": "{{description ?? LongText}}", "job_url": "{{url}}", "date_posted": {{(date is null ? "null" : $"\"{date}\"")}},
          "job_url_direct": {{(direct is null ? "null" : $"\"{direct}\"")}}, "site": "linkedin" }
        """;

    public static string Response(params string[] jobs) =>
        $$"""{ "jobs": [ {{string.Join(",", jobs)}} ], "stats": { "searches_total": 2, "searches_failed": 0, "searches_empty": 0 } }""";

    public static readonly string TwoJobs = Response(
        Job(Guid.NewGuid().ToString(), "https://www.linkedin.com/jobs/view/4012345678", "Small Startup"),
        Job(Guid.NewGuid().ToString(), "https://il.linkedin.com/jobs/view/backend-engineer-at-tiny-4012345679?trk=x",
            "Tiny Ltd", title: "Backend Engineer", date: null));
}

/// <summary>LinkedIn, through the contract every source passes -- as a source that never proves completeness.</summary>
public class LinkedInSourceContractTests : JobSourceContract
{
    protected override BoardConfig Board => LinkedIn.Board;

    protected override bool ProvesCompleteness => false;

    protected override IJobSource Healthy() => LinkedIn.Over(HttpStatusCode.OK, LinkedIn.TwoJobs);
    protected override IJobSource ServerError() => LinkedIn.Over(HttpStatusCode.InternalServerError, "oops");
    protected override IJobSource Unparseable() => LinkedIn.Over(HttpStatusCode.OK, """{ "jobs": [ { "title": "Dev""");

    // A search has no count to fall short of.
    protected override IJobSource? Truncated() => null;

    protected override IReadOnlyList<ExpectedPosting> Expected =>
    [
        new("4012345678", "DevOps Engineer", new DateTime(2026, 10, 3, 0, 0, 0, DateTimeKind.Utc), null, "Kubernetes platform"),
        new("4012345679", "Backend Engineer", null, null, "Kubernetes platform"),
    ];
}

/// <summary>What only LinkedIn does: ids from the URL, board companies skipped, thin descriptions held back.</summary>
public class LinkedInSourceTests
{
    [Fact]
    public async Task Sends_the_search_from_config_to_the_scraper()
    {
        var stub = new StubHandler().EnqueueJson(HttpStatusCode.OK, LinkedIn.TwoJobs);

        await LinkedIn.Source(stub).ListAsync(LinkedIn.Board, default);

        Assert.Equal("http://scraper:8080/scrape", stub.RequestUris.Single());
        var body = stub.RequestBodies.Single();
        Assert.Contains("\"job_titles\":[\"DevOps Engineer\",\"Backend Engineer\"]", body);
        Assert.Contains("\"locations\":[\"Israel\"]", body);
        Assert.Contains("\"results_wanted\":50", body);
        Assert.Contains("\"hours_old\":48", body);
    }

    [Fact]
    public async Task The_key_is_linkedins_job_id_never_the_scrapers_row_id()
    {
        var listing = await LinkedIn.Over(HttpStatusCode.OK, LinkedIn.TwoJobs).ListAsync(LinkedIn.Board, default);

        Assert.Equal(["4012345678", "4012345679"], listing.Postings.Select(p => p.SourceJobId));
    }

    [Theory]
    [InlineData("https://www.linkedin.com/jobs/view/4012345678", "4012345678")]
    [InlineData("https://il.linkedin.com/jobs/view/devops-engineer-at-acme-4012345678?refId=abc", "4012345678")]
    [InlineData("https://www.linkedin.com/company/acme", null)]
    [InlineData("", null)]
    public void Reads_the_job_id_from_the_posting_url(string url, string? expected) =>
        Assert.Equal(expected, LinkedInSource.JobIdFrom(url));

    [Fact]
    public async Task A_posting_without_a_job_id_is_skipped()
    {
        var json = LinkedIn.Response(LinkedIn.Job("x", "https://www.linkedin.com/company/acme", "Small Startup"));

        var listing = await LinkedIn.Over(HttpStatusCode.OK, json).ListAsync(LinkedIn.Board, default);

        Assert.Empty(listing.Postings);
    }

    [Fact]
    public async Task Never_reports_complete_so_nothing_is_ever_closed_by_absence()
    {
        var listing = await LinkedIn.Over(HttpStatusCode.OK, LinkedIn.TwoJobs).ListAsync(LinkedIn.Board, default);

        Assert.False(listing.Complete);
    }

    [Theory]
    [InlineData("Wiz")]               // the board's token
    [InlineData("Wiz Inc.")]          // legal suffix dropped
    [InlineData("Wiz Security")]      // an alias on the board
    [InlineData("Fetcherr")]          // token
    [InlineData("NVIDIA Corporation")] // name + suffix
    [InlineData("Acme Co")]           // a Lever board's name
    public async Task A_company_with_its_own_board_is_skipped_by_name(string company)
    {
        var json = LinkedIn.Response(LinkedIn.Job("x", "https://www.linkedin.com/jobs/view/4000000001", company));

        var listing = await LinkedIn.Over(HttpStatusCode.OK, json).ListAsync(LinkedIn.Board, default);

        Assert.Empty(listing.Postings);
    }

    [Theory]
    [InlineData("https://boards.greenhouse.io/wiz/jobs/123")]
    [InlineData("https://job-boards.greenhouse.io/wiz/jobs/123")]
    [InlineData("https://www.comeet.com/jobs/fetcherr/68.006/devops/AB.123")]
    [InlineData("https://nvidia.wd5.myworkdayjobs.com/en-US/x/job/123")]
    [InlineData("https://jobs.lever.co/acmeco/abc-123")]
    [InlineData("https://careers.wiz.io/jobs/123")]   // a board company's own domain
    [InlineData("https://fetcherr.io/careers/73276")]
    public async Task A_posting_whose_apply_link_is_one_of_our_boards_is_skipped_however_the_name_reads(string direct)
    {
        // The name matches no board: only the link gives it away.
        var json = LinkedIn.Response(LinkedIn.Job(
            "x", "https://www.linkedin.com/jobs/view/4000000002", "Some Very Different Name Ltd", direct: direct));

        var listing = await LinkedIn.Over(HttpStatusCode.OK, json).ListAsync(LinkedIn.Board, default);

        Assert.Empty(listing.Postings);
    }

    [Theory]
    [InlineData("Wizard Labs")]        // "wiz" only as a prefix: no fuzzy matching
    [InlineData("Small Startup")]
    public async Task Only_exact_normalised_names_match(string company)
    {
        var json = LinkedIn.Response(LinkedIn.Job(
            "x", "https://www.linkedin.com/jobs/view/4000000003", company,
            direct: "https://boards.greenhouse.io/someoneelse/jobs/1"));

        var listing = await LinkedIn.Over(HttpStatusCode.OK, json).ListAsync(LinkedIn.Board, default);

        Assert.Single(listing.Postings);
    }

    [Fact]
    public async Task A_thin_description_has_no_detail_so_the_posting_waits_for_a_better_read()
    {
        var json = LinkedIn.Response(LinkedIn.Job(
            "x", "https://www.linkedin.com/jobs/view/4000000004", "Small Startup", description: "Too short."));

        var source = LinkedIn.Over(HttpStatusCode.OK, json);
        var posting = Assert.Single((await source.ListAsync(LinkedIn.Board, default)).Postings);

        Assert.Null(posting.Detail);
        Assert.Null(await source.DetailAsync(LinkedIn.Board, posting, default));
    }

    [Fact]
    public async Task Every_search_failing_is_a_failed_fetch_not_an_empty_day()
    {
        const string blocked = """{ "jobs": [], "stats": { "searches_total": 2, "searches_failed": 2, "searches_empty": 0 } }""";

        await Assert.ThrowsAsync<BoardFetchException>(
            () => LinkedIn.Over(HttpStatusCode.OK, blocked).ListAsync(LinkedIn.Board, default));
    }

    [Fact]
    public async Task No_scraper_configured_refuses_by_name()
    {
        var source = new LinkedInSource(null, LinkedIn.CompanyBoards, NullLogger<LinkedInSource>.Instance);

        var e = await Assert.ThrowsAsync<BoardFetchException>(() => source.ListAsync(LinkedIn.Board, default));
        Assert.Contains("Scraper:BaseUrl", e.Message);
    }

    [Theory]
    [InlineData("linkedin", true)]
    [InlineData("greenhouse", false)]
    [InlineData("comeet", false)]
    public void Only_linkedin_postings_get_a_delete_date(string source, bool expected)
    {
        var now = new DateTime(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);
        Assert.Equal(expected, JobStore.DeleteAtFor(source, null, now) is not null);
    }

    [Fact]
    public void The_delete_date_counts_from_the_posting_date_else_from_first_seen()
    {
        var now = new DateTime(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);
        var posted = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);

        Assert.Equal(posted.AddDays(LinkedInSource.DeleteAfterDays), JobStore.DeleteAtFor("linkedin", posted, now));
        Assert.Equal(now.AddDays(LinkedInSource.DeleteAfterDays), JobStore.DeleteAtFor("linkedin", null, now));
    }
}

/// <summary>The boards.json fields a LinkedIn search needs, and refuses.</summary>
public class LinkedInBoardsConfigTests
{
    [Fact]
    public void A_linkedin_search_loads()
    {
        var config = BoardsConfig.Parse("""
            { "boards": [ { "source": "linkedin", "token": "israel",
                            "titles": [" DevOps Engineer ", "Backend Engineer"], "locations": ["Israel"],
                            "results_wanted": 50, "hours_old": 48 } ] }
            """);

        var board = Assert.Single(config.All);
        Assert.Equal("linkedin:israel", board.Key);
        Assert.Equal(["DevOps Engineer", "Backend Engineer"], board.Titles);
        Assert.Equal(["Israel"], board.Locations);
    }

    [Fact]
    public void A_board_may_carry_aliases()
    {
        var config = BoardsConfig.Parse("""
            { "boards": [ { "source": "greenhouse", "token": "wiz", "aliases": ["Wiz Inc."] } ] }
            """);

        Assert.Equal(["Wiz Inc."], config.All[0].Aliases);
    }

    [Theory]
    // A search must ask for something.
    [InlineData("""{ "boards": [ { "source": "linkedin", "token": "israel", "locations": ["Israel"] } ] }""")]
    [InlineData("""{ "boards": [ { "source": "linkedin", "token": "israel", "titles": ["DevOps Engineer"] } ] }""")]
    // Bounds that keep a run's cost and pacing sane.
    [InlineData("""{ "boards": [ { "source": "linkedin", "token": "israel", "titles": ["x"], "locations": ["y"], "results_wanted": 500 } ] }""")]
    [InlineData("""{ "boards": [ { "source": "linkedin", "token": "israel", "titles": ["x"], "locations": ["y"], "hours_old": 720 } ] }""")]
    // A search is many companies: no company fields.
    [InlineData("""{ "boards": [ { "source": "linkedin", "token": "israel", "titles": ["x"], "locations": ["y"], "domain": "linkedin.com" } ] }""")]
    [InlineData("""{ "boards": [ { "source": "linkedin", "token": "israel", "titles": ["x"], "locations": ["y"], "aliases": ["z"] } ] }""")]
    // Search fields on a company board are a board filed under the wrong source.
    [InlineData("""{ "boards": [ { "source": "greenhouse", "token": "wiz", "titles": ["DevOps Engineer"] } ] }""")]
    public void A_malformed_linkedin_entry_is_refused(string json) =>
        Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse(json));
}

/// <summary>The entry's exclude_companies: recruiting and staffing agencies.</summary>
public class LinkedInExcludedCompaniesTests
{
    private static readonly BoardConfig Board = LinkedIn.Board with
    {
        ExcludeCompanies = ["Gotfriends", "Logica-IT", "Mertens"],
    };

    [Theory]
    [InlineData("Gotfriends")]
    [InlineData("GotFriends Ltd")]                       // case and legal suffix
    [InlineData("Logica IT")]                            // punctuation
    [InlineData("מרטנס | Mertens – מקבוצת מלם תים")]      // matched on its Latin part, as LinkedIn shows it
    public async Task An_excluded_company_is_skipped(string company)
    {
        var json = LinkedIn.Response(LinkedIn.Job("x", "https://www.linkedin.com/jobs/view/4000000010", company));

        var listing = await LinkedIn.Over(System.Net.HttpStatusCode.OK, json).ListAsync(Board, default);

        Assert.Empty(listing.Postings);
    }

    [Fact]
    public async Task Other_companies_are_kept()
    {
        var json = LinkedIn.Response(LinkedIn.Job("x", "https://www.linkedin.com/jobs/view/4000000011", "Silverfort"));

        var listing = await LinkedIn.Over(System.Net.HttpStatusCode.OK, json).ListAsync(Board, default);

        Assert.Single(listing.Postings);
    }

    [Fact]
    public void Exclusions_belong_only_on_a_linkedin_search() =>
        Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse(
            """{ "boards": [ { "source": "greenhouse", "token": "wiz", "exclude_companies": ["x"] } ] }"""));
}
