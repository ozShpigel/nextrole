using System.Net;
using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Greenhouse;
using MongoDB.Bson;
using Xunit;

namespace GreenhouseTests;

/// <summary>Greenhouse, through the contract every source passes.</summary>
public class GreenhouseSourceContractTests : JobSourceContract
{
    // Entity-encoded, as the real board sends it: the first decode is not optional.
    private const string EncodedBody = "&lt;h2&gt;Who we are&lt;/h2&gt;&lt;p&gt;We build R&amp;amp;D tooling.&lt;/p&gt;";

    private static string Json(int metaTotal, bool withJobs = true)
    {
        var jobs = !withJobs ? "" : $$"""
            {
              "id": 101, "title": "Backend Engineer",
              "absolute_url": "https://boards.greenhouse.io/x/jobs/101", "company_name": "Test Co",
              "first_published": "2026-09-20T10:00:00-04:00", "updated_at": "2026-09-25T08:30:00+03:00",
              "location": { "name": "Tel Aviv" }, "content": "{{EncodedBody}}"
            },
            {
              "id": 102, "title": "Data Engineer",
              "absolute_url": "https://boards.greenhouse.io/x/jobs/102", "company_name": "Test Co",
              "updated_at": "2026-09-01T00:00:00Z",
              "location": { "name": "London" }, "content": "&lt;p&gt;Pipelines at scale.&lt;/p&gt;"
            }
            """;
        return $$"""{ "jobs": [ {{jobs}} ], "meta": { "total": {{metaTotal}} } }""";
    }

    private static GreenhouseSource Over(HttpStatusCode status, string body) =>
        Build.Source(new StubHandler().EnqueueJson(status, body));

    protected override IJobSource Healthy() => Over(HttpStatusCode.OK, Json(2));
    protected override IJobSource ServerError() => Over(HttpStatusCode.InternalServerError, "oops");
    protected override IJobSource Unparseable() => Over(HttpStatusCode.OK, """{ "jobs": [ { "id": 1, "tit""");
    protected override IJobSource? Truncated() => Over(HttpStatusCode.OK, Json(3));

    protected override IReadOnlyList<ExpectedPosting> Expected { get; } =
    [
        new("101", "Backend Engineer",
            new DateTime(2026, 9, 20, 14, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 9, 25, 5, 30, 0, DateTimeKind.Utc),
            "We build R&D tooling."),
        // No first_published: PostedAt stays null here, and the prefilter's
        // own fallback to the update date is what dates it.
        new("102", "Data Engineer", null, new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), "Pipelines at scale."),
    ];
}

/// <summary>What the Greenhouse mapping writes, field by field.</summary>
/// <remarks>
/// Pinned because moving from the board's own JSON type to the source-neutral
/// records is exactly the change that could alter a stored field and still
/// pass every count-based test.
/// </remarks>
public class GreenhouseSourceStoredFieldsTests
{
    [Fact]
    public async Task A_greenhouse_posting_is_stored_exactly_as_before_the_source_interface()
    {
        const string json = """
            { "jobs": [ {
                "id": 7, "title": " Platform Engineer ", "absolute_url": "https://x/jobs/7",
                "company_name": "Test Co", "requisition_id": "R-7",
                "first_published": "2026-09-20T10:00:00Z", "updated_at": "2026-09-25T08:30:00Z",
                "location": { "name": "Tel Aviv, Israel" },
                "departments": [ { "id": 1, "name": " Engineering " }, { "id": 2, "name": "engineering" }, { "id": 3 } ],
                "offices": [ { "id": 4, "name": "Tel Aviv" } ],
                "content": "&lt;p&gt;Run the platform.&lt;/p&gt;"
            } ], "meta": { "total": 1 } }
            """;

        var listing = await Build.Source(new StubHandler().EnqueueJson(HttpStatusCode.OK, json))
            .ListAsync(Build.Token, default);
        var job = GreenhouseJob.From(Build.Token, 7, listing.Postings.Single().Detail!);
        var stored = job.ToStoredFields();

        Assert.Equal(Build.Token, stored[GreenhouseJobFields.BoardToken].AsString);
        Assert.Equal(7L, stored[GreenhouseJobFields.GreenhouseJobId].AsInt64);
        Assert.Equal("Platform Engineer", stored[GreenhouseJobFields.Title].AsString);
        Assert.Equal("Test Co", stored[GreenhouseJobFields.Company].AsString);
        Assert.Equal("https://x/jobs/7", stored[GreenhouseJobFields.AbsoluteUrl].AsString);
        Assert.Equal("R-7", stored[GreenhouseJobFields.RequisitionId].AsString);
        Assert.Equal("Tel Aviv, Israel", stored[GreenhouseJobFields.Location].AsString);
        // Names only, trimmed, distinct ignoring case, a nameless entry dropped.
        Assert.Equal(new BsonArray { "Engineering" }, stored[GreenhouseJobFields.Department]);
        Assert.Equal(new BsonArray { "Tel Aviv" }, stored[GreenhouseJobFields.Office]);
        Assert.Equal("Run the platform.", stored[GreenhouseJobFields.Content].AsString);
        Assert.Equal(new DateTime(2026, 9, 25, 8, 30, 0, DateTimeKind.Utc),
            stored[GreenhouseJobFields.BoardUpdatedAt].ToUniversalTime());
        Assert.Equal(new DateTime(2026, 9, 20, 10, 0, 0, DateTimeKind.Utc),
            stored[GreenhouseJobFields.FirstPublishedAt].ToUniversalTime());
        // The embedded text takes the title as the board sent it, untrimmed --
        // as it always has; changing that would change every stored hash.
        Assert.Equal(" Platform Engineer \n\nRun the platform.", job.EmbedText);
    }

    [Fact]
    public async Task Missing_dates_are_stored_as_null()
    {
        var listing = await Build.Source(new StubHandler().EnqueueJson(HttpStatusCode.OK,
                Build.BoardJson((9, "Engineer", "&lt;p&gt;x&lt;/p&gt;"))))
            .ListAsync(Build.Token, default);
        var stored = GreenhouseJob.From(Build.Token, 9, listing.Postings.Single().Detail!).ToStoredFields();

        Assert.True(stored[GreenhouseJobFields.BoardUpdatedAt].IsBsonNull);
        Assert.True(stored[GreenhouseJobFields.FirstPublishedAt].IsBsonNull);
    }
}
