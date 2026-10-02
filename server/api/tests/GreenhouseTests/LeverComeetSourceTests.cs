using System.Net;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GreenhouseTests;

/// <summary>Canned Lever responses, shaped as measured on 2026-10-02 (palantir, spotify).</summary>
internal static class Lever
{
    public static readonly BoardConfig Board = new() { Source = "lever", Token = "acme", Name = "Acme" };

    public static LeverSource Source(StubHandler stub) => new(new HttpClient(stub), NullLogger<LeverSource>.Instance);

    public static LeverSource Over(HttpStatusCode status, string body) =>
        Source(new StubHandler().EnqueueJson(status, body));

    // 2026-09-20T10:00:00Z and 2026-09-01T00:00:00Z, as epoch milliseconds.
    public const string TwoPostings = """
        [
          { "id": "6ed76ce8-4156-4b60-b120-403538bd66cd", "text": "Backend Engineer", "createdAt": 1789898400000,
            "hostedUrl": "https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd66cd",
            "categories": { "location": "Tel Aviv", "allLocations": ["Tel Aviv", "London"],
                            "department": "R&D", "team": "Platform", "commitment": "Full-time" },
            "description": "<div>We build R&amp;D tooling.</div>",
            "lists": [ { "text": "What you bring", "content": "<li>Kubernetes in production</li>" } ],
            "additional": "<div>Hybrid, three days.</div>",
            "descriptionPlain": "ignored" },
          { "id": "a1b2c3d4-0000-0000-0000-000000000002", "text": "Data Engineer", "createdAt": 1788220800000,
            "hostedUrl": "https://jobs.lever.co/acme/a1b2c3d4-0000-0000-0000-000000000002",
            "categories": { "location": "London", "allLocations": ["London"], "team": "Data" },
            "description": "<p>Pipelines at scale.</p>", "lists": [], "additional": "" }
        ]
        """;
}

/// <summary>Lever, through the contract every source passes.</summary>
public class LeverSourceContractTests : JobSourceContract
{
    protected override BoardConfig Board => Lever.Board;

    protected override IJobSource Healthy() => Lever.Over(HttpStatusCode.OK, Lever.TwoPostings);
    protected override IJobSource ServerError() => Lever.Over(HttpStatusCode.InternalServerError, "oops");
    protected override IJobSource Unparseable() => Lever.Over(HttpStatusCode.OK, """[ { "id": "6ed76ce8", "tex""");

    // Lever gives no count: the contract then checks the healthy listing carries none.
    protected override IJobSource? Truncated() => null;

    protected override IReadOnlyList<ExpectedPosting> Expected { get; } =
    [
        new("6ed76ce8-4156-4b60-b120-403538bd66cd", "Backend Engineer",
            new DateTime(2026, 9, 20, 10, 0, 0, DateTimeKind.Utc), null, "We build R&D tooling."),
        new("a1b2c3d4-0000-0000-0000-000000000002", "Data Engineer",
            new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), null, "Pipelines at scale."),
    ];
}

/// <summary>What only Lever does: the request, and a body built from three fields.</summary>
public class LeverSourceTests
{
    [Fact]
    public async Task Reads_the_whole_board_in_one_request_with_no_limit()
    {
        var stub = new StubHandler().EnqueueJson(HttpStatusCode.OK, Lever.TwoPostings);

        await Lever.Source(stub).ListAsync(Lever.Board, default);

        Assert.Equal(["https://api.lever.co/v0/postings/acme?mode=json"], stub.RequestUris);
    }

    [Fact]
    public async Task Maps_locations_departments_url_and_the_board_name()
    {
        var listing = await Lever.Over(HttpStatusCode.OK, Lever.TwoPostings).ListAsync(Lever.Board, default);
        var detail = listing.Postings[0].Detail!;

        Assert.Equal("Tel Aviv", detail.Listed.Location);
        Assert.Equal(["London"], detail.Listed.Offices);   // allLocations, less the primary one
        Assert.Equal(["R&D", "Platform"], detail.Listed.Departments);
        Assert.Equal("https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd66cd", detail.Url);
        Assert.Equal("Acme", detail.Company);
    }

    [Fact]
    public async Task The_body_keeps_the_lists_where_the_requirements_are()
    {
        var listing = await Lever.Over(HttpStatusCode.OK, Lever.TwoPostings).ListAsync(Lever.Board, default);
        var cleaned = GreenhouseJob.From("lever", "acme", listing.Postings[0].Detail!).CleanedContent;

        Assert.Contains("What you bring", cleaned);
        Assert.Contains("Kubernetes in production", cleaned);
        Assert.Contains("Hybrid, three days.", cleaned);
    }

    [Fact]
    public async Task An_unknown_site_throws_rather_than_reading_as_empty()
    {
        var source = Lever.Over(HttpStatusCode.NotFound, """{"ok":false,"error":"Document not found"}""");

        var e = await Assert.ThrowsAsync<BoardFetchException>(() => source.ListAsync(Lever.Board, default));
        Assert.Contains("404", e.Message);
    }
}

/// <summary>Canned Comeet responses, shaped as measured on 2026-10-02 (VAST Data).</summary>
internal static class Comeet
{
    public static readonly BoardConfig Board = new()
    {
        Source = "comeet", Token = "acme", CompanyUid = "43.001", ApiToken = "34110453411D4968234168209C31D49",
    };

    public static ComeetSource Source(StubHandler stub) => new(new HttpClient(stub), NullLogger<ComeetSource>.Instance);

    public static ComeetSource Over(HttpStatusCode status, string body) =>
        Source(new StubHandler().EnqueueJson(status, body));

    public const string TwoPositions = """
        [
          { "uid": "6D.76F", "name": "Backend Engineer", "department": "R&D", "company_name": "Acme",
            "internal_use_custom_id": "ACM-17", "time_updated": "2026-09-22T16:55:35Z",
            "url_active_page": "https://acme.example/careers?comeet_pos=6D.76F",
            "url_comeet_hosted_page": "https://www.comeet.com/jobs/acme/43.001/backend-engineer/6D.76F",
            "is_internal": false, "workplace_type": "Hybrid",
            "location": { "name": "Tel Aviv", "country": "IL", "city": "Tel Aviv" },
            "details": [
              { "name": "Requirements", "value": "<ul><li>Kubernetes in production</li></ul>", "order": 2 },
              { "name": "Description", "value": "<p>We build R&amp;D tooling.</p>", "order": 1 }
            ] },
          { "uid": "6D.770", "name": "Data Engineer", "department": "", "company_name": "Acme",
            "internal_use_custom_id": null, "time_updated": "2026-09-01T00:00:00Z",
            "url_active_page": null,
            "url_comeet_hosted_page": "https://www.comeet.com/jobs/acme/43.001/data-engineer/6D.770",
            "is_internal": false,
            "location": { "name": "London", "country": "GB" },
            "details": [ { "name": "Description", "value": "<p>Pipelines at scale.</p>", "order": 1 } ] }
        ]
        """;
}

/// <summary>Comeet, through the contract every source passes.</summary>
public class ComeetSourceContractTests : JobSourceContract
{
    protected override BoardConfig Board => Comeet.Board;

    protected override IJobSource Healthy() => Comeet.Over(HttpStatusCode.OK, Comeet.TwoPositions);
    protected override IJobSource ServerError() => Comeet.Over(HttpStatusCode.InternalServerError, "oops");
    protected override IJobSource Unparseable() => Comeet.Over(HttpStatusCode.OK, """[ { "uid": "6D.76F", "na""");

    // Comeet gives no count: the contract then checks the healthy listing carries none.
    protected override IJobSource? Truncated() => null;

    protected override IReadOnlyList<ExpectedPosting> Expected { get; } =
    [
        // No posting date on Comeet: PostedAt stays null, and the prefilter
        // ages the posting by its update date.
        new("6D.76F", "Backend Engineer", null, new DateTime(2026, 9, 22, 16, 55, 35, DateTimeKind.Utc), "We build R&D tooling."),
        new("6D.770", "Data Engineer", null, new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), "Pipelines at scale."),
    ];
}

/// <summary>What only Comeet does: uid and token in the request, sections in order, internal positions.</summary>
public class ComeetSourceTests
{
    [Fact]
    public async Task Reads_every_position_with_its_details_in_one_request()
    {
        var stub = new StubHandler().EnqueueJson(HttpStatusCode.OK, Comeet.TwoPositions);

        await Comeet.Source(stub).ListAsync(Comeet.Board, default);

        Assert.Equal(
            ["https://www.comeet.co/careers-api/2.0/company/43.001/positions?token=34110453411D4968234168209C31D49&details=true"],
            stub.RequestUris);
    }

    [Fact]
    public async Task Maps_the_company_url_and_requisition_and_orders_the_sections()
    {
        var listing = await Comeet.Over(HttpStatusCode.OK, Comeet.TwoPositions).ListAsync(Comeet.Board, default);
        var first = listing.Postings[0].Detail!;
        var second = listing.Postings[1].Detail!;

        Assert.Equal("Acme", first.Company);
        Assert.Equal("ACM-17", first.RequisitionId);
        Assert.Equal("Tel Aviv", first.Listed.Location);
        Assert.Equal(["R&D"], first.Listed.Departments);
        Assert.Equal("https://acme.example/careers?comeet_pos=6D.76F", first.Url);   // the company's own page
        Assert.Empty(second.Listed.Departments);
        Assert.Equal("https://www.comeet.com/jobs/acme/43.001/data-engineer/6D.770", second.Url);   // else Comeet's

        var cleaned = GreenhouseJob.From("comeet", "acme", first).CleanedContent;
        Assert.True(cleaned.IndexOf("We build", StringComparison.Ordinal) < cleaned.IndexOf("Kubernetes", StringComparison.Ordinal));
    }

    [Fact]
    public async Task An_internal_position_is_left_out()
    {
        const string json = """
            [ { "uid": "6D.771", "name": "Internal move", "is_internal": true,
                "details": [ { "name": "Description", "value": "<p>Staff only.</p>", "order": 1 } ] } ]
            """;

        var listing = await Comeet.Over(HttpStatusCode.OK, json).ListAsync(Comeet.Board, default);

        Assert.Empty(listing.Postings);
    }

    [Fact]
    public async Task A_rejected_uid_or_token_throws_rather_than_reading_as_empty()
    {
        var source = Comeet.Over(HttpStatusCode.BadRequest,
            """{"status":400,"message":"Account uid or token are not valid","ignore_sentry":true}""");

        var e = await Assert.ThrowsAsync<BoardFetchException>(() => source.ListAsync(Comeet.Board, default));
        Assert.Contains("not valid", e.Message);
    }
}

/// <summary>The boards.json fields Lever and Comeet boards need, and refuse.</summary>
public class LeverComeetBoardsConfigTests
{
    [Fact]
    public void Lever_and_comeet_boards_load()
    {
        var config = BoardsConfig.Parse("""
            { "boards": [
                { "source": "lever", "token": "acme", "name": "Acme", "domain": "acme.example" },
                { "source": "comeet", "token": "beta", "company_uid": "43.001",
                  "api_token": "34110453411D4968234168209C31D49", "domain": "beta.example" }
            ] }
            """);

        Assert.Equal(["lever:acme", "comeet:beta"], config.All.Select(b => b.Key));
        Assert.Equal("43.001", config.All[1].CompanyUid);
    }

    [Theory]
    // A Lever posting carries no company name.
    [InlineData("""{ "boards": [ { "source": "lever", "token": "acme" } ] }""")]
    // Comeet needs both, each in its exact shape: they go into the request URL.
    [InlineData("""{ "boards": [ { "source": "comeet", "token": "beta", "api_token": "ABC123" } ] }""")]
    [InlineData("""{ "boards": [ { "source": "comeet", "token": "beta", "company_uid": "43.001" } ] }""")]
    [InlineData("""{ "boards": [ { "source": "comeet", "token": "beta", "company_uid": "43.001/../x", "api_token": "ABC123" } ] }""")]
    [InlineData("""{ "boards": [ { "source": "comeet", "token": "beta", "company_uid": "43.001", "api_token": "ABC&x=1" } ] }""")]
    // Another source's fields: a board filed under the wrong source.
    [InlineData("""{ "boards": [ { "source": "greenhouse", "token": "acme", "company_uid": "43.001" } ] }""")]
    [InlineData("""{ "boards": [ { "source": "lever", "token": "acme", "name": "Acme", "host": "acme.wd1" } ] }""")]
    public void A_malformed_lever_or_comeet_board_is_fatal(string json) =>
        Assert.Throws<InvalidOperationException>(() => BoardsConfig.Parse(json));
}
