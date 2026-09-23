using System.Net;
using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The two user-independent AI reads the ingest runs once per posting.
/// </summary>
/// <remarks>
/// These run at ingest rather than per user because neither pass sees a
/// profile, so their answers cannot differ between users — measured at 2.1x the
/// whole ingest pipeline when done per user. They also keep
/// <c>EnforceEvidenceCaps</c> and <c>ClaimGrounding</c> fed from a reading the
/// scored model did not author.
///
/// Driven through the REAL <see cref="IngestAiClient"/> over a stub transport,
/// so the camelCase → snake_case mapping and the correlate-by-jobId rule are
/// exercised rather than mocked away.
/// </remarks>
public class IngestAiPassTests
{
    private static readonly string Content = "&lt;p&gt;" + new string('a', 400) + "&lt;/p&gt;";

    private static IngestAiClient Client(StubHandler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://api.local") },
            NullLogger.Instance);

    private static string FactsJson(params (long Id, string Location, string[] Tech)[] jobs) =>
        $$"""
        { "results": [ {{string.Join(",", jobs.Select(j => $$"""
            {
              "jobId": "{{j.Id}}",
              "requiredYears": 5,
              "mustHaveTech": [{{string.Join(",", j.Tech.Select(t => $"\"{t}\""))}}],
              "niceToHaveTech": ["Terraform"],
              "seniority": "mid-senior level",
              "domain": "fintech",
              "location": "{{j.Location}}"
            }
            """))}} ] }
        """;

    private static string ParseJson(params long[] ids) =>
        $$"""
        { "parseVersion": "v7",
          "results": [ {{string.Join(",", ids.Select(id => $$"""
            { "jobId": "{{id}}", "parsed": { "jobTitle": "Backend Engineer", "namedTechnologies": ["Go"] } }
            """))}} ] }
        """;

    [Fact]
    public async Task Runs_both_passes_for_a_new_job_and_stores_what_they_return()
    {
        var api = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, FactsJson((1, "London, United Kingdom", ["Go", "Kubernetes"])))
            .EnqueueJson(HttpStatusCode.OK, ParseJson(1));

        var store = new FakeJobStore();

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson((1, "Backend Engineer", Content))),
                new FakeEmbeddingClient(), store, ai: Client(api))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(2, api.Calls);
        Assert.Contains("/api/match/job-facts", api.RequestUris[0]);
        Assert.Contains("/api/match/job-parse", api.RequestUris[1]);
        Assert.Equal([1L], store.SavedAiFor.Distinct().Order());
    }

    [Fact]
    public async Task Does_not_re_read_a_posting_whose_content_did_not_change()
    {
        // The whole point of the content hash. An unchanged posting keeps the
        // facts and parse it already has; re-reading it would pay twice for an
        // answer that cannot have changed.
        var json = Build.BoardJson((1, "Backend Engineer", Content));
        var store = new FakeJobStore();

        var first = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, FactsJson((1, "London", ["Go"])))
            .EnqueueJson(HttpStatusCode.OK, ParseJson(1));
        await Build.Handler(new StubHandler().EnqueueJson(HttpStatusCode.OK, json),
                new FakeEmbeddingClient(), store, ai: Client(first))
            .HandleCompanyAsync(Build.Token);

        // Second run: same board, same content. An empty stub would THROW if
        // anything called it, which is the assertion.
        var second = new StubHandler();
        var result = await Build.Handler(new StubHandler().EnqueueJson(HttpStatusCode.OK, json),
                new FakeEmbeddingClient(), store, ai: Client(second))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, result.Skipped);
        Assert.Equal(0, second.Calls);
    }

    [Fact]
    public async Task A_failing_AI_pass_does_not_fail_the_company()
    {
        // The embeddings are already written and paid for by this point. Nacking
        // the message over a failed read would throw that away and re-do it,
        // and the scan tolerates a missing parse by parsing inline.
        var api = new StubHandler()
            .EnqueueJson(HttpStatusCode.InternalServerError, "boom")
            .EnqueueJson(HttpStatusCode.InternalServerError, "boom");

        var store = new FakeJobStore();

        var result = await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson((1, "Backend Engineer", Content))),
                new FakeEmbeddingClient(), store, ai: Client(api))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, result.Embedded);          // the job is stored
        Assert.Empty(store.SavedAiFor);            // with no facts and no parse
    }

    [Fact]
    public async Task Works_with_no_API_configured_at_all()
    {
        // Api:BaseUrl unset. Degraded, not broken: jobs are embedded and stored,
        // and the per-user scan parses them inline as it did before the cache.
        var store = new FakeJobStore();

        var result = await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson((1, "Backend Engineer", Content))),
                new FakeEmbeddingClient(), store)
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, result.Embedded);
        Assert.Empty(store.SavedAiFor);
    }

    [Fact]
    public async Task A_result_for_an_unknown_job_id_is_dropped_rather_than_guessed_at()
    {
        // The API answered about a job this board never sent. Attaching it to
        // whatever happened to be at that position is the failure the
        // correlate-by-jobId rule exists to prevent, and it is silent.
        var api = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, FactsJson((999, "Nowhere", ["Go"])))
            .EnqueueJson(HttpStatusCode.OK, ParseJson(999));

        var store = new FakeJobStore();

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson((1, "Backend Engineer", Content))),
                new FakeEmbeddingClient(), store, ai: Client(api))
            .HandleCompanyAsync(Build.Token);

        Assert.DoesNotContain(1L, store.SavedAiFor);
    }

    [Fact]
    public void The_parse_chunk_is_smaller_than_the_facts_chunk()
    {
        // Not symmetry for its own sake. A parse emits a full ParsedJob per job
        // (~746 output tokens at the median), so the RESPONSE bounds the batch;
        // overflowing max_tokens loses every job in it and cannot be retried.
        Assert.True(IngestAiClient.ParseChunkSize < IngestAiClient.FactsChunkSize);
        Assert.True(IngestAiClient.FactsChunkSize <= 200);   // endpoint's cap
        Assert.True(IngestAiClient.ParseChunkSize <= 25);    // endpoint's cap
    }
}
