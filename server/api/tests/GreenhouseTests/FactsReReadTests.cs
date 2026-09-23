using System.Net;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// Postings whose facts were read before requirement groups existed.
/// </summary>
/// <remarks>
/// Their <c>must_have_tech</c> is flat, so Deliveroo's "Go, Ruby, or Python"
/// is three requirements, and a Python candidate is scored as missing two of
/// them. The content hash never changes, so without this sweep nothing would
/// ever read them again.
/// </remarks>
public class FactsReReadTests
{
    private static ApplicationTracker.Core.Matching.IngestAiClient Client(StubHandler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://api.local") }, NullLogger.Instance);

    private const string GroupedFacts = """
        { "results": [ {
            "jobId": "7",
            "requiredYears": null,
            "mustHaveTech": ["Go", "Ruby", "Python", "PostgreSQL", "MySQL"],
            "mustHaveGroups": [["Go", "Ruby", "Python"], ["PostgreSQL", "MySQL"]],
            "niceToHaveTech": ["Redis", "DynamoDB"],
            "seniority": "mid-senior level",
            "domain": null,
            "location": "London, United Kingdom (hybrid)"
        } ] }
        """;

    private static StoredJobContent Stored(long id) =>
        new(id, "Software Engineer", "Deliveroo", "London, United Kingdom - Deliveroo", "A real posting body.");

    [Fact]
    public async Task A_pre_groups_row_gets_its_facts_re_read_and_nothing_else()
    {
        // One call, to job-facts. No job-parse (the parse did not change and
        // costs several times more), and no embedding (the vector is valid).
        var store = new FakeJobStore();
        store.NeedingFactsReRead.Add(Stored(7));
        var embedder = new FakeEmbeddingClient();
        var api = new StubHandler().EnqueueJson(HttpStatusCode.OK, GroupedFacts);

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson()),
                embedder, store, ai: Client(api))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, api.Calls);
        Assert.Contains("/api/match/job-facts", api.RequestUris[0]);
        Assert.Empty(store.SavedParsedFor);
        Assert.Empty(store.Vectors);

        var groups = store.SavedFacts[7]["must_have_groups"].AsBsonArray;
        Assert.Equal(2, groups.Count);
        Assert.Equal(["Go", "Ruby", "Python"], groups[0].AsBsonArray.Select(v => v.AsString));
    }

    [Fact]
    public async Task The_re_read_is_bounded_like_the_backfill()
    {
        var store = new FakeJobStore();
        for (var i = 0; i < CompanyHandler.BackfillBatchSize + 20; i++) store.NeedingFactsReRead.Add(Stored(i));
        // More than one facts chunk's worth: answer every chunk with nothing.
        var api = new StubHandler();
        for (var i = 0; i < 3; i++) api.EnqueueJson(HttpStatusCode.OK, """{ "results": [] }""");

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson()),
                new FakeEmbeddingClient(), store, ai: Client(api))
            .HandleCompanyAsync(Build.Token);

        // 100 postings at 50 per facts chunk.
        Assert.Equal(CompanyHandler.BackfillBatchSize / ApplicationTracker.Core.Matching.IngestAiClient.FactsChunkSize, api.Calls);
    }

    [Fact]
    public async Task A_failing_re_read_does_not_fail_the_company()
    {
        var store = new FakeJobStore();
        store.NeedingFactsReRead.Add(Stored(7));
        var api = new StubHandler().EnqueueJson(HttpStatusCode.InternalServerError, "boom");

        var result = await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson()),
                new FakeEmbeddingClient(), store, ai: Client(api))
            .HandleCompanyAsync(Build.Token);

        Assert.NotNull(result);
        Assert.Empty(store.SavedAiFor);
    }

    [Fact]
    public async Task Groups_are_stored_only_when_the_api_sent_them()
    {
        // An absent must_have_groups is what marks a row as owed a re-read. An
        // API older than the field must therefore not produce an EMPTY one,
        // which would claim the grouped read had happened.
        const string OldApiFacts = """
            { "results": [ { "jobId": "7", "mustHaveTech": ["Go"], "niceToHaveTech": [] } ] }
            """;
        var facts = await Client(new StubHandler().EnqueueJson(HttpStatusCode.OK, OldApiFacts))
            .ExtractFactsAsync([new IngestJob("7", "t", "c", null, "body")], CancellationToken.None);

        Assert.False(facts["7"].Contains("must_have_groups"));
        Assert.Equal(["Go"], facts["7"]["must_have_tech"].AsBsonArray.Select(v => v.AsString));
    }
    [Fact]
    public async Task Functions_are_stored_only_when_the_api_sent_them()
    {
        // An absent functions field is what marks a row as owed a re-read, the
        // same rule as must_have_groups. An empty array means "read, unclear".
        const string NewApiFacts = """
            { "results": [
                { "jobId": "7", "mustHaveTech": [], "niceToHaveTech": [], "functions": ["infrastructure"] },
                { "jobId": "8", "mustHaveTech": [], "niceToHaveTech": [], "functions": [] },
                { "jobId": "9", "mustHaveTech": [], "niceToHaveTech": [] } ] }
            """;
        var facts = await Client(new StubHandler().EnqueueJson(HttpStatusCode.OK, NewApiFacts))
            .ExtractFactsAsync(
                [new IngestJob("7", "t", "c", null, "body"), new IngestJob("8", "t", "c", null, "body"),
                 new IngestJob("9", "t", "c", null, "body")],
                CancellationToken.None);

        Assert.Equal(["infrastructure"], facts["7"]["functions"].AsBsonArray.Select(v => v.AsString));
        Assert.Empty(facts["8"]["functions"].AsBsonArray);
        Assert.False(facts["9"].Contains("functions"));
    }
}
