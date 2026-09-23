using System.Net;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The sweep that repairs postings the content hash can never reach.
/// </summary>
/// <remarks>
/// <para>
/// The AI reads run only over jobs whose content CHANGED, which is correct for
/// a posting that already has facts and makes "never attempted" look exactly
/// like "attempted, unchanged". So a run with no <c>Api:BaseUrl</c>, or with
/// the API down, left postings factless <b>permanently</b> — nothing selected
/// them again until the company edited their own board.
/// </para>
/// <para>
/// This was measured, not imagined: the production consumer was found running
/// with no <c>Api__BaseUrl</c> in its environment, and every posting it had
/// stored carried an empty <c>extracted</c> and no <c>parsed</c>. The effect is
/// silent and it is not small — an empty <c>must_have_tech</c> makes the
/// server-side <c>stackedGaps</c> check inert, so Core Stack is scored on the
/// model's own unchecked reading of the posting.
/// </para>
/// </remarks>
public class IngestAiBackfillTests
{
    private static readonly string Content = "&lt;p&gt;" + new string('a', 400) + "&lt;/p&gt;";

    private static ApplicationTracker.Core.Matching.IngestAiClient Client(StubHandler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://api.local") }, NullLogger.Instance);

    private static string FactsJson(params long[] ids) =>
        $$"""
        { "results": [ {{string.Join(",", ids.Select(id => $$"""
            {
              "jobId": "{{id}}",
              "requiredYears": 5,
              "mustHaveTech": ["TypeScript"],
              "niceToHaveTech": [],
              "seniority": "mid-senior level",
              "domain": "fintech",
              "location": "London, United Kingdom"
            }
            """))}} ] }
        """;

    private static string ParseJson(params long[] ids) =>
        $$"""
        { "parseVersion": "v7",
          "results": [ {{string.Join(",", ids.Select(id => $$"""
            { "jobId": "{{id}}", "parsed": { "jobTitle": "Full-Stack Engineer", "namedTechnologies": ["TypeScript"] } }
            """))}} ] }
        """;

    private static StoredJobContent Stored(long id) =>
        new(id, "Full-Stack Engineer", "Deliveroo", "London, United Kingdom - Deliveroo", "A real posting body.");

    [Fact]
    public async Task A_posting_stored_without_facts_is_read_even_though_its_content_is_unchanged()
    {
        // The board returns nothing new at all, so the hash skip fires for
        // every job and the changed-jobs pass does nothing. The backfill is the
        // only thing that can reach row 7.
        var store = new FakeJobStore();
        store.NeedingAi.Add(Stored(7));

        var api = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, FactsJson(7))
            .EnqueueJson(HttpStatusCode.OK, ParseJson(7));

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson()),
                new FakeEmbeddingClient(), store, ai: Client(api))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(2, api.Calls);
        Assert.Contains("/api/match/job-facts", api.RequestUris[0]);
        Assert.Contains("/api/match/job-parse", api.RequestUris[1]);
        Assert.Equal([7L], store.SavedAiFor.Distinct().Order());
    }

    [Fact]
    public async Task The_backfill_does_not_re_embed()
    {
        // The vectors are valid and already paid for; only the reads are
        // missing. Re-embedding to fix a missing parse would spend money for
        // nothing, which is why the sweep reads STORED content instead of
        // pushing the posting back through the embed path.
        var store = new FakeJobStore();
        store.NeedingAi.Add(Stored(7));

        var embedder = new FakeEmbeddingClient();
        var api = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, FactsJson(7))
            .EnqueueJson(HttpStatusCode.OK, ParseJson(7));

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson()),
                embedder, store, ai: Client(api))
            .HandleCompanyAsync(Build.Token);

        Assert.Empty(store.UpsertBatchSizes);
        Assert.Empty(store.Vectors);
    }

    [Fact]
    public async Task Nothing_pending_costs_nothing()
    {
        // An empty stub throws if it is called, which is the assertion: the
        // steady state — every posting already read — must not spend a call.
        var store = new FakeJobStore();

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson()),
                new FakeEmbeddingClient(), store, ai: Client(new StubHandler()))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, store.NeedingAiCalls);
        Assert.Empty(store.SavedAiFor);
    }

    [Fact]
    public async Task The_sweep_is_bounded_per_run()
    {
        // A backlog must not turn one nightly run into an unbounded bill. The
        // selector is asked for a capped page, oldest first, so successive runs
        // drain it.
        var store = new FakeJobStore();

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson()),
                new FakeEmbeddingClient(), store, ai: Client(new StubHandler()))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(CompanyHandler.BackfillBatchSize, store.LastNeedingAiLimit);
    }

    [Fact]
    public async Task Without_an_AI_client_the_sweep_is_not_even_attempted()
    {
        // The degraded mode: no Api:BaseUrl configured. It must stay degraded
        // rather than half-running — and must not query for a backlog it has
        // no way to process.
        var store = new FakeJobStore();
        store.NeedingAi.Add(Stored(7));

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson()),
                new FakeEmbeddingClient(), store, ai: null)
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(0, store.NeedingAiCalls);
        Assert.Empty(store.SavedAiFor);
    }

    [Fact]
    public async Task A_failing_backfill_does_not_fail_the_company()
    {
        // Same rule as the changed-jobs pass: by this point the board is
        // fetched, embedded and written. Nacking over a failed read would throw
        // that away and re-do it.
        var store = new FakeJobStore();
        store.NeedingAi.Add(Stored(7));

        var api = new StubHandler()
            .EnqueueJson(HttpStatusCode.InternalServerError, "boom")
            .EnqueueJson(HttpStatusCode.InternalServerError, "boom");

        var result = await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson()),
                new FakeEmbeddingClient(), store, ai: Client(api))
            .HandleCompanyAsync(Build.Token);

        Assert.NotNull(result);
        Assert.Empty(store.SavedAiFor);
    }
}
