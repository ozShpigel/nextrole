using System.Net;
using System.Text.Json;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GreenhouseTests;

/// <summary>Canned Workday responses, shaped as measured on 2026-09-28 (docs/plans/workday-adapter.md).</summary>
internal static class Workday
{
    public static readonly BoardConfig Board = new()
    {
        Source = "workday", Token = "acme", Name = "Acme", Host = "acme.wd1", Tenant = "acme", Site = "Careers",
    };

    /// <summary>A source with no pauses and no retries, recording every wait it would have made.</summary>
    public static WorkdaySource Source(StubHandler stub, List<TimeSpan>? waits = null, int attempts = 1) =>
        new(new HttpClient(stub), NullLogger<WorkdaySource>.Instance,
            new WorkdayLimits(TimeSpan.FromMilliseconds(7), attempts, TimeSpan.FromMilliseconds(100)),
            (t, _) => { waits?.Add(t); return Task.CompletedTask; });

    public static string Listed(string path, string title, string where = "Tel Aviv, Israel") => $$"""
        { "title": {{JsonSerializer.Serialize(title)}}, "externalPath": "{{path}}",
          "locationsText": {{JsonSerializer.Serialize(where)}}, "postedOn": "Posted 30+ Days Ago", "bulletFields": ["X"] }
        """;

    /// <summary>A listing page. <paramref name="total"/> is what the site says: the real count on page one, 0 after.</summary>
    public static string Page(int total, params string[] listed) =>
        $$"""{ "total": {{total}}, "jobPostings": [ {{string.Join(",", listed)}} ], "facets": [] }""";

    public static string Page(int total, IEnumerable<string> listed) => Page(total, [.. listed]);

    public static string Detail(
        string title, string html, string? startDate, string location = "Tel Aviv, Israel",
        string[]? more = null, string reqId = "R100") => $$"""
        { "jobPostingInfo": {
            "title": {{JsonSerializer.Serialize(title)}},
            "jobDescription": {{JsonSerializer.Serialize(html)}},
            "location": {{JsonSerializer.Serialize(location)}},
            {{(more is null ? "" : $"\"additionalLocations\": {JsonSerializer.Serialize(more)},")}}
            "startDate": {{(startDate is null ? "null" : $"\"{startDate}\"")}},
            "jobReqId": "{{reqId}}",
            "externalUrl": "https://acme.wd1.myworkdayjobs.com/Careers/job/x",
            "id": "cb116e8fb14d100059d21e66d1790000"
          },
          "hiringOrganization": { "name": "Acme Holdings LTD" } }
        """;

    public static IEnumerable<string> Many(int from, int count) =>
        Enumerable.Range(from, count).Select(i => Listed($"/job/Tel-Aviv-Israel/Engineer_R{i}", $"Engineer {i}"));
}

/// <summary>Workday, through the contract every source passes.</summary>
public class WorkdaySourceContractTests : JobSourceContract
{
    protected override BoardConfig Board => Workday.Board;

    private static readonly string TwoListed = Workday.Page(2,
        Workday.Listed("/job/Tel-Aviv-Israel/Backend-Engineer_R100", "Backend Engineer"),
        Workday.Listed("/job/Yavne-Israel/Data-Engineer_R101-2", "Data Engineer", "2 Locations"));

    protected override IJobSource Healthy() => Workday.Source(new StubHandler()
        .EnqueueJson(HttpStatusCode.OK, TwoListed)
        .EnqueueJson(HttpStatusCode.OK, Workday.Detail("Backend Engineer",
            "<h2>Who we are</h2><p>We build R&amp;D tooling.</p>", "2026-09-20"))
        .EnqueueJson(HttpStatusCode.OK, Workday.Detail("Data Engineer", "<p>Pipelines at scale.</p>", null)));

    protected override IJobSource ServerError() =>
        Workday.Source(new StubHandler().EnqueueJson(HttpStatusCode.InternalServerError, "oops"));

    protected override IJobSource Unparseable() =>
        Workday.Source(new StubHandler().EnqueueJson(HttpStatusCode.OK, """{ "total": 2, "jobPost"""));

    // The site says 3; two come back.
    protected override IJobSource? Truncated() => Workday.Source(new StubHandler().EnqueueJson(HttpStatusCode.OK,
        Workday.Page(3,
            Workday.Listed("/job/Tel-Aviv-Israel/Backend-Engineer_R100", "Backend Engineer"),
            Workday.Listed("/job/Yavne-Israel/Data-Engineer_R101-2", "Data Engineer"))));

    protected override IReadOnlyList<ExpectedPosting> Expected { get; } =
    [
        // The id is the path's last segment, Workday's own jobPostingId.
        new("Backend-Engineer_R100", "Backend Engineer",
            new DateTime(2026, 9, 20, 0, 0, 0, DateTimeKind.Utc), null, "We build R&D tooling."),
        // A repost keeps its suffix; a detail with no startDate stays undated (and is read, as Matches would show it).
        new("Data-Engineer_R101-2", "Data Engineer", null, null, "Pipelines at scale."),
    ];
}

/// <summary>What only Workday does: pages, a first-page total, a count cap, pacing.</summary>
public class WorkdaySourceTests
{
    private static BoardConfig Board => Workday.Board;

    [Fact]
    public async Task Pages_until_a_short_page_and_checks_the_count_against_page_ones_total()
    {
        var stub = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(45, Workday.Many(1, 20)))
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(0, Workday.Many(21, 20)))   // later pages say 0
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(0, Workday.Many(41, 5)));

        var listing = await Workday.Source(stub).ListAsync(Board with
        {
            Facets = new() { ["locationHierarchy1"] = ["2fcb99c455831013ea52bbe14cf9326c"] },
        }, default);

        Assert.True(listing.Complete);
        Assert.Equal(45, listing.Postings.Count);
        Assert.All(stub.RequestUris, u => Assert.Equal("https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/jobs", u));
        Assert.Equal([0, 20, 40], stub.RequestBodies.Select(b => JsonDocument.Parse(b).RootElement.GetProperty("offset").GetInt32()));
        Assert.All(stub.RequestBodies, b => Assert.Contains("\"locationHierarchy1\":[\"2fcb99c455831013ea52bbe14cf9326c\"]", b));
    }

    [Fact]
    public async Task Stops_at_page_ones_total_when_the_site_serves_page_one_again_past_the_end()
    {
        // A count that is a whole number of pages: the page after the last is
        // page one again, not an empty page. Reading it would list every
        // posting twice.
        var stub = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(40, Workday.Many(1, 20)))
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(0, Workday.Many(21, 20)))
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(0, Workday.Many(1, 20)));

        var listing = await Workday.Source(stub).ListAsync(Board, default);

        Assert.True(listing.Complete);
        Assert.Equal(40, listing.Postings.Count);
        Assert.Equal(2, stub.RequestBodies.Count);
    }

    [Fact]
    public async Task A_listing_shorter_than_page_ones_total_throws()
    {
        var stub = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(45, Workday.Many(1, 20)))
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(0, Workday.Many(21, 3)));

        var e = await Assert.ThrowsAsync<BoardFetchException>(() => Workday.Source(stub).ListAsync(Board, default));
        Assert.Contains("total=45", e.Message);
    }

    [Fact]
    public async Task A_posting_seen_on_two_pages_throws_because_another_was_missed()
    {
        // Postings added while paging shift the pages: the count can match
        // while one posting is listed twice and another not at all.
        var stub = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(21, Workday.Many(1, 20)))
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(0, Workday.Many(20, 1)));

        var e = await Assert.ThrowsAsync<BoardFetchException>(() => Workday.Source(stub).ListAsync(Board, default));
        Assert.Contains("listed twice", e.Message);
    }

    [Fact]
    public async Task A_failed_middle_page_throws_rather_than_ending_the_listing()
    {
        var stub = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(45, Workday.Many(1, 20)))
            .EnqueueJson(HttpStatusCode.BadGateway, "bad gateway");

        await Assert.ThrowsAsync<BoardFetchException>(() => Workday.Source(stub).ListAsync(Board, default));
    }

    [Fact]
    public async Task A_total_of_2000_is_the_cap_so_the_listing_cannot_be_proven_whole()
    {
        var stub = new StubHandler().EnqueueJson(HttpStatusCode.OK, Workday.Page(2000, Workday.Many(1, 5)));

        var listing = await Workday.Source(stub).ListAsync(Board, default);

        Assert.False(listing.Complete);          // stored, nothing closed
        Assert.Equal(5, listing.Postings.Count);
    }

    [Fact]
    public async Task The_listing_has_no_date_and_a_location_count_names_no_place()
    {
        var stub = new StubHandler().EnqueueJson(HttpStatusCode.OK, Workday.Page(2,
            Workday.Listed("/job/Yavne-Israel/A_R1", "A", "Yavne, Israel"),
            Workday.Listed("/job/Multiple/B_R2", "B", "2 Locations")));

        var listed = (await Workday.Source(stub).ListAsync(Board, default)).Postings;

        Assert.All(listed, p => Assert.Null(p.PostedAt));
        Assert.All(listed, p => Assert.Null(p.Detail));
        Assert.Equal("Yavne, Israel", listed[0].Location);
        Assert.Null(listed[1].Location);        // the filter reads it; the detail has the places
    }

    [Fact]
    public async Task The_detail_supplies_the_date_the_places_the_body_and_the_apply_link()
    {
        var stub = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(1, Workday.Listed("/job/Multiple/B_R2", "B", "2 Locations")))
            .EnqueueJson(HttpStatusCode.OK, Workday.Detail("B", "<p>Body.</p>", "2026-09-23",
                location: "Yavne, Israel", more: ["London, United Kingdom"], reqId: "R2"));
        var source = Workday.Source(stub);

        var detail = await source.DetailAsync(Board, (await source.ListAsync(Board, default)).Postings[0], default);

        Assert.NotNull(detail);
        Assert.Equal("B_R2", detail.Listed.SourceJobId);
        Assert.Equal(new DateTime(2026, 9, 23, 0, 0, 0, DateTimeKind.Utc), detail.Listed.PostedAt);
        Assert.Equal(DateTimeKind.Utc, detail.Listed.PostedAt!.Value.Kind);
        Assert.Equal("Yavne, Israel", detail.Listed.Location);
        Assert.Equal(["London, United Kingdom"], detail.Listed.Offices);
        Assert.Equal("<p>Body.</p>", detail.ContentHtml);
        Assert.Equal("https://acme.wd1.myworkdayjobs.com/Careers/job/x", detail.Url);
        Assert.Equal("Acme", detail.Company);           // the board's name, not the legal entity
        Assert.Equal("R2", detail.RequisitionId);
        Assert.Equal("https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/job/Multiple/B_R2", stub.RequestUris[1]);
    }

    [Fact]
    public async Task A_detail_that_cannot_be_read_is_null_not_an_error()
    {
        var stub = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(1, Workday.Listed("/job/X/A_R1", "A")))
            .EnqueueJson(HttpStatusCode.NotFound, "gone");
        var source = Workday.Source(stub);

        var posting = (await source.ListAsync(Board, default)).Postings[0];

        Assert.Null(await source.DetailAsync(Board, posting, default));
    }

    [Theory]
    [InlineData("https://evil.example/job/x")]
    [InlineData("/job/../../wday/cxs/other/Careers/jobs")]
    [InlineData("/careers/x")]
    public async Task A_path_that_is_not_a_posting_path_is_never_requested(string path)
    {
        // The path comes from the site and is appended to our URL.
        var stub = new StubHandler();
        var posting = new ListedPosting("x", "X", null, [], [], null, null, DetailRef: path);

        Assert.Null(await Workday.Source(stub).DetailAsync(Board, posting, default));
        Assert.Equal(0, stub.Calls);
    }

    [Fact]
    public async Task A_stub_in_the_listing_counts_toward_the_total_and_is_skipped()
    {
        // Measured on NVIDIA, 2026-09-28: one of 467 was {"bulletFields": ["JR2018715"]}
        // -- no title, no path -- and it failed the whole board, every run, when
        // the count left it out. The site did return it; we just cannot use it.
        var stub = new StubHandler().EnqueueJson(HttpStatusCode.OK, Workday.Page(3,
            Workday.Listed("/job/X/A_R1", "A"),
            """{ "bulletFields": ["JR2018715"] }""",
            Workday.Listed("https://evil.example/x", "B")));

        var listing = await Workday.Source(stub).ListAsync(Board, default);

        Assert.True(listing.Complete);
        Assert.Equal(["A_R1"], listing.Postings.Select(p => p.SourceJobId));
    }

    [Fact]
    public async Task A_listing_that_really_is_short_still_throws_with_a_stub_in_it()
    {
        var stub = new StubHandler().EnqueueJson(HttpStatusCode.OK, Workday.Page(3,
            Workday.Listed("/job/X/A_R1", "A"), """{ "bulletFields": ["JR2018715"] }"""));

        await Assert.ThrowsAsync<BoardFetchException>(() => Workday.Source(stub).ListAsync(Board, default));
    }

    [Fact]
    public async Task A_429_is_retried_after_a_backoff_and_then_succeeds()
    {
        var waits = new List<TimeSpan>();
        var stub = new StubHandler()
            .EnqueueJson(HttpStatusCode.TooManyRequests, "slow down")
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(1, Workday.Listed("/job/X/A_R1", "A")));

        var listing = await Workday.Source(stub, waits, attempts: 3).ListAsync(Board, default);

        Assert.Single(listing.Postings);
        Assert.Equal(2, stub.Calls);
        Assert.Contains(TimeSpan.FromMilliseconds(100), waits);   // the backoff
    }

    [Fact]
    public async Task Retries_stop_at_the_limit_and_the_listing_fails()
    {
        var stub = new StubHandler()
            .EnqueueJson(HttpStatusCode.ServiceUnavailable, "down")
            .EnqueueJson(HttpStatusCode.ServiceUnavailable, "down")
            .EnqueueJson(HttpStatusCode.ServiceUnavailable, "down");

        await Assert.ThrowsAsync<BoardFetchException>(() => Workday.Source(stub, attempts: 3).ListAsync(Board, default));
        Assert.Equal(3, stub.Calls);
    }

    [Fact]
    public async Task Every_request_after_the_first_waits_the_pause()
    {
        var waits = new List<TimeSpan>();
        var stub = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, Workday.Page(1, Workday.Listed("/job/X/A_R1", "A")))
            .EnqueueJson(HttpStatusCode.OK, Workday.Detail("A", "<p>x</p>", "2026-09-01"));
        var source = Workday.Source(stub, waits);

        await source.DetailAsync(Board, (await source.ListAsync(Board, default)).Postings[0], default);

        Assert.Equal([TimeSpan.FromMilliseconds(7)], waits);
    }
}

/// <summary>A Workday board in boards.json: its fields required, validated, and refused elsewhere.</summary>
public class WorkdayBoardConfigTests
{
    private const string Good = """
        { "source": "workday", "token": "nvidia", "name": "NVIDIA", "domain": "nvidia.com",
          "host": "nvidia.wd5", "tenant": "nvidia", "site": "NVIDIAExternalCareerSite",
          "facets": { "locationHierarchy1": ["2fcb99c455831013ea52bbe14cf9326c"] } }
        """;

    private static BoardsConfig With(string board) => BoardsConfig.Parse($$"""{ "boards": [ {{board}} ] }""");

    [Fact]
    public void A_workday_board_loads_with_its_site_and_facets()
    {
        var board = With(Good).All.Single();

        Assert.Equal("workday:nvidia", board.Key);
        Assert.Equal(("nvidia.wd5", "nvidia", "NVIDIAExternalCareerSite"), (board.Host, board.Tenant, board.Site));
        Assert.Equal(["2fcb99c455831013ea52bbe14cf9326c"], board.Facets!["locationHierarchy1"]);
    }

    [Theory]
    [InlineData("name")]
    [InlineData("host")]
    [InlineData("tenant")]
    [InlineData("site")]
    public void A_workday_board_missing_a_required_field_is_fatal(string field)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(Good)!.AsObject();
        node.Remove(field);

        var e = Assert.Throws<InvalidOperationException>(() => With(node.ToJsonString()));
        Assert.Contains(field, e.Message);
    }

    [Theory]
    [InlineData("nvidia.wd5.myworkdayjobs.com")]   // the whole host, not its first part
    [InlineData("evil.example")]
    [InlineData("nvidia.wd5/../x")]
    [InlineData("NVIDIA.WD5")]
    public void A_host_that_is_not_exactly_a_workday_host_is_fatal(string host) =>
        Assert.Throws<InvalidOperationException>(() => With(Good.Replace("\"nvidia.wd5\"", $"\"{host}\"")));

    [Theory]
    [InlineData("""{ "locationHierarchy1": [] }""")]
    [InlineData("""{ "locationHierarchy1": ["not an id"] }""")]
    [InlineData("""{ "": ["abc"] }""")]
    public void A_malformed_facet_is_fatal(string facets) =>
        Assert.Throws<InvalidOperationException>(() => With(
            Good.Replace("""{ "locationHierarchy1": ["2fcb99c455831013ea52bbe14cf9326c"] }""", facets)));

    [Fact]
    public void A_greenhouse_board_with_workday_fields_is_fatal()
    {
        // A board filed under the wrong source; ignoring the fields would hide it.
        var e = Assert.Throws<InvalidOperationException>(() => With(
            """{ "source": "greenhouse", "token": "wizinc", "host": "wiz.wd1" }"""));
        Assert.Contains("only a workday board", e.Message);
    }
}

/// <summary>
/// The adapter against KLA's real Israel site: the API shape can change
/// without notice, and only a live call shows it has.
/// </summary>
/// <remarks>Opt-in: <c>GREENHOUSE_WORKDAY_LIVE=1</c>. About 5 read-only requests.</remarks>
public class WorkdayLiveTests
{
    private static readonly BoardConfig Kla = new()
    {
        Source = "workday", Token = "kla", Name = "KLA", Host = "kla.wd1", Tenant = "kla", Site = "Israel",
    };

    [SkippableFact]
    public async Task Klas_israel_site_lists_whole_and_a_posting_reads_in_full()
    {
        Skip.IfNot(Environment.GetEnvironmentVariable("GREENHOUSE_WORKDAY_LIVE") == "1",
            "Set GREENHOUSE_WORKDAY_LIVE=1 to call KLA's real careers site.");

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        var source = new WorkdaySource(http, NullLogger<WorkdaySource>.Instance);

        var listing = await source.ListAsync(Kla, default);
        Assert.True(listing.Complete);
        Assert.NotEmpty(listing.Postings);

        var detail = await source.DetailAsync(Kla, listing.Postings[0], default);
        Assert.NotNull(detail);
        Assert.NotNull(detail.Listed.PostedAt);
        Assert.False(string.IsNullOrWhiteSpace(detail.ContentHtml));
        Assert.StartsWith("https://kla.wd1.myworkdayjobs.com/", detail.Url);
    }
}
