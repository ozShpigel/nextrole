using System.Net;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The ingest's reads through the Message Batches API: submit, record, mark,
/// collect, and the ways each step can fail without paying twice or losing a
/// posting.
/// </summary>
public class IngestBatcherTests
{
    private static readonly DateTime Now = new(2026, 9, 24, 6, 15, 0, DateTimeKind.Utc);

    private sealed class FakeBatchStore : IAiBatchStore
    {
        public List<AiBatchRecord> Rows { get; } = [];
        public Dictionary<string, string> Closed { get; } = [];

        public Task RecordAsync(AiBatchRecord batch, CancellationToken ct)
        {
            Rows.Add(batch);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<AiBatchRecord>> PendingAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<AiBatchRecord>>([.. Rows.Where(r => !Closed.ContainsKey(r.BatchId))]);

        public Task CloseAsync(string batchId, string status, DateTime now, CancellationToken ct)
        {
            Closed[batchId] = status;
            return Task.CompletedTask;
        }
    }

    private static IngestAiClient Client(StubHandler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://api.local") }, NullLogger.Instance);

    private static IngestBatcher Batcher(StubHandler api, FakeJobStore jobs, FakeBatchStore batches) =>
        new(Client(api), jobs, batches, NullLogger<IngestBatcher>.Instance);

    private static List<IngestJob> Jobs(params long[] ids) =>
        [.. ids.Select(i => new IngestJob(i.ToString(), "Engineer", "Acme", "London", "A posting."))];

    private static AiBatchRecord Row(string id, string kind, DateTime submittedAt, params long[] jobIds) => new()
    {
        BatchId = id, Kind = kind, BoardToken = Build.Token, JobIds = jobIds,
        ParseVersion = kind == AiBatchRecord.Parse ? "v-at-submit" : null, SubmittedAt = submittedAt,
    };

    private static string Submitted(string id, string? parseVersion = null) =>
        $$"""{ "batchId": "{{id}}", "requests": 1, "parseVersion": {{(parseVersion is null ? "null" : $"\"{parseVersion}\"")}} }""";

    // ---- submit --------------------------------------------------------------

    [Fact]
    public async Task Submitting_records_the_batch_then_marks_its_postings()
    {
        var jobs = new FakeJobStore();
        var batches = new FakeBatchStore();
        var api = new StubHandler().EnqueueJson(HttpStatusCode.OK, Submitted("msgbatch_a", "v1"));

        var count = await Batcher(api, jobs, batches)
            .SubmitAsync(Build.Token, AiBatchRecord.Parse, Jobs(1, 2), Now, CancellationToken.None);

        Assert.Equal(2, count);
        var row = Assert.Single(batches.Rows);
        Assert.Equal("msgbatch_a", row.BatchId);
        Assert.Equal([1L, 2L], row.JobIds);
        // Captured at submission, not at collection: a deploy in between must
        // not restamp an old-prompt parse.
        Assert.Equal("v1", row.ParseVersion);
        Assert.Equal("msgbatch_a", jobs.Pending[(AiBatchRecord.Parse, 1)]);
        Assert.Equal("msgbatch_a", jobs.Pending[(AiBatchRecord.Parse, 2)]);
        Assert.EndsWith("/api/match/job-parse/batches", api.RequestUris.Single());
    }

    [Fact]
    public async Task A_large_board_is_split_into_submissions_the_endpoint_accepts()
    {
        var api = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, Submitted("msgbatch_a"))
            .EnqueueJson(HttpStatusCode.OK, Submitted("msgbatch_b"));
        var batches = new FakeBatchStore();

        var count = await Batcher(api, new FakeJobStore(), batches).SubmitAsync(
            Build.Token, AiBatchRecord.Facts, Jobs([.. Enumerable.Range(1, 250).Select(i => (long)i)]),
            Now, CancellationToken.None);

        Assert.Equal(250, count);
        Assert.Equal([200, 50], batches.Rows.Select(r => r.JobIds.Count));
    }

    [Fact]
    public async Task A_failed_submit_records_and_marks_nothing()
    {
        // Unmarked, so the next run's backfill submits the postings again --
        // what a failed live call already means.
        var jobs = new FakeJobStore();
        var batches = new FakeBatchStore();
        var api = new StubHandler().EnqueueJson(HttpStatusCode.InternalServerError, "boom");

        var count = await Batcher(api, jobs, batches)
            .SubmitAsync(Build.Token, AiBatchRecord.Facts, Jobs(1), Now, CancellationToken.None);

        Assert.Equal(0, count);
        Assert.Empty(batches.Rows);
        Assert.Empty(jobs.Pending);
    }

    // ---- collect -------------------------------------------------------------

    [Fact]
    public async Task A_batch_still_in_progress_is_left_for_the_next_poll()
    {
        var jobs = new FakeJobStore();
        jobs.Pending[(AiBatchRecord.Facts, 1)] = "msgbatch_a";
        var batches = new FakeBatchStore();
        batches.Rows.Add(Row("msgbatch_a", AiBatchRecord.Facts, Now.AddMinutes(-5), 1));
        var api = new StubHandler().EnqueueJson(HttpStatusCode.OK, """{ "status": "in_progress", "results": [] }""");

        var closed = await Batcher(api, jobs, batches).CollectAsync(Now, CancellationToken.None);

        Assert.Equal(0, closed);
        Assert.Empty(batches.Closed);
        Assert.Empty(jobs.SavedAiFor);
        Assert.True(jobs.Pending.ContainsKey((AiBatchRecord.Facts, 1)));
    }

    [Fact]
    public async Task An_ended_facts_batch_stores_only_its_own_postings_and_clears_their_markers()
    {
        var jobs = new FakeJobStore();
        jobs.Pending[(AiBatchRecord.Facts, 1)] = "msgbatch_a";
        var batches = new FakeBatchStore();
        batches.Rows.Add(Row("msgbatch_a", AiBatchRecord.Facts, Now.AddMinutes(-30), 1));
        // Job 99 was never in this batch: storing it would attach one
        // posting's read to another.
        var api = new StubHandler().EnqueueJson(HttpStatusCode.OK, """
            { "status": "ended", "results": [
                { "jobId": "1", "mustHaveTech": ["Go"], "niceToHaveTech": [], "functions": ["infrastructure"] },
                { "jobId": "99", "mustHaveTech": ["Go"], "niceToHaveTech": [] } ] }
            """);

        var closed = await Batcher(api, jobs, batches).CollectAsync(Now, CancellationToken.None);

        Assert.Equal(1, closed);
        Assert.Equal([1L], jobs.SavedAiFor);
        Assert.Equal(0, jobs.UncountedSaves);   // a facts read counts as an attempt
        Assert.Empty(jobs.Pending);
        Assert.Equal("collected", batches.Closed["msgbatch_a"]);
        Assert.EndsWith("/api/match/job-facts/batches/msgbatch_a", api.RequestUris.Single());
    }

    [Fact]
    public async Task An_ended_parse_batch_is_verified_against_the_stored_postings_and_does_not_count_an_attempt()
    {
        var jobs = new FakeJobStore();
        jobs.Pending[(AiBatchRecord.Parse, 1)] = "msgbatch_p";
        jobs.Stored[1] = new StoredJobContent(1, "Engineer", "Acme", "London", "The stored posting body.");
        var batches = new FakeBatchStore();
        batches.Rows.Add(Row("msgbatch_p", AiBatchRecord.Parse, Now.AddMinutes(-30), 1));
        var api = new StubHandler().EnqueueJson(HttpStatusCode.OK, """
            { "status": "ended", "results": [ { "jobId": "1", "parsed": { "jobTitle": "Engineer" } } ] }
            """);

        await Batcher(api, jobs, batches).CollectAsync(Now, CancellationToken.None);

        // The API keeps nothing between calls, so the collect carries the text
        // the parse is checked against.
        Assert.Contains("The stored posting body.", api.RequestBodies.Single());
        Assert.Equal([1L], jobs.SavedAiFor);
        Assert.Equal(1, jobs.UncountedSaves);
        Assert.Equal("v-at-submit", jobs.LastParseVersion);
        Assert.Empty(jobs.Pending);
    }

    [Fact]
    public async Task A_marker_owned_by_a_newer_batch_is_left_alone()
    {
        // Posting 1 changed and was resubmitted in msgbatch_b before msgbatch_a
        // landed. Clearing it now would un-hide a posting whose new read is
        // still in flight.
        var jobs = new FakeJobStore();
        jobs.Pending[(AiBatchRecord.Facts, 1)] = "msgbatch_b";
        var batches = new FakeBatchStore();
        batches.Rows.Add(Row("msgbatch_a", AiBatchRecord.Facts, Now.AddMinutes(-30), 1));
        var api = new StubHandler().EnqueueJson(HttpStatusCode.OK, """{ "status": "ended", "results": [] }""");

        await Batcher(api, jobs, batches).CollectAsync(Now, CancellationToken.None);

        Assert.Equal("msgbatch_b", jobs.Pending[(AiBatchRecord.Facts, 1)]);
    }

    [Fact]
    public async Task An_unreachable_api_leaves_the_batch_pending()
    {
        var jobs = new FakeJobStore();
        var batches = new FakeBatchStore();
        batches.Rows.Add(Row("msgbatch_a", AiBatchRecord.Facts, Now.AddMinutes(-30), 1));
        var api = new StubHandler().EnqueueJson(HttpStatusCode.BadGateway, "down");

        var closed = await Batcher(api, jobs, batches).CollectAsync(Now, CancellationToken.None);

        Assert.Equal(0, closed);
        Assert.Empty(batches.Closed);
    }

    [Fact]
    public async Task A_batch_past_its_window_is_abandoned_and_its_postings_are_read_again()
    {
        // Otherwise an outage longer than the results window would leave these
        // postings marked -- and hidden from every candidate search -- forever.
        var jobs = new FakeJobStore();
        jobs.Pending[(AiBatchRecord.Parse, 1)] = "msgbatch_old";
        var batches = new FakeBatchStore();
        batches.Rows.Add(Row("msgbatch_old", AiBatchRecord.Parse, Now - IngestBatcher.AbandonAfter - TimeSpan.FromMinutes(1), 1));
        var api = new StubHandler();

        var closed = await Batcher(api, jobs, batches).CollectAsync(Now, CancellationToken.None);

        Assert.Equal(1, closed);
        Assert.Equal("abandoned", batches.Closed["msgbatch_old"]);
        Assert.Empty(jobs.Pending);
        Assert.Equal(0, api.Calls);
    }

    [Fact]
    public async Task Collecting_twice_stores_once()
    {
        var jobs = new FakeJobStore();
        var batches = new FakeBatchStore();
        batches.Rows.Add(Row("msgbatch_a", AiBatchRecord.Facts, Now.AddMinutes(-30), 1));
        var api = new StubHandler().EnqueueJson(HttpStatusCode.OK, """
            { "status": "ended", "results": [ { "jobId": "1", "mustHaveTech": [], "niceToHaveTech": [] } ] }
            """);
        var batcher = Batcher(api, jobs, batches);

        await batcher.CollectAsync(Now, CancellationToken.None);
        await batcher.CollectAsync(Now, CancellationToken.None);   // no second response queued: must not call

        Assert.Equal([1L], jobs.SavedAiFor);
        Assert.Equal(1, api.Calls);
    }

    // ---- the handler in batch mode -------------------------------------------

    private static readonly string LongContent = "&lt;p&gt;" + new string('a', 400) + "&lt;/p&gt;";

    [Fact]
    public async Task In_batch_mode_the_handler_submits_instead_of_calling_live()
    {
        // Changed and never-read postings need both reads; a re-read posting
        // needs facts only, so it gets no parse batch and stays visible to the
        // candidate search meanwhile. Each posting once.
        var store = new FakeJobStore();
        store.NeedingAi.Add(new StoredJobContent(1, "Engineer", "Acme", null, "body"));      // also changed below
        store.NeedingAi.Add(new StoredJobContent(5, "Engineer", "Acme", null, "body"));
        store.NeedingFactsReRead.Add(new StoredJobContent(7, "Engineer", "Acme", null, "body"));

        var api = new StubHandler()
            .EnqueueJson(HttpStatusCode.OK, Submitted("msgbatch_f"))
            .EnqueueJson(HttpStatusCode.OK, Submitted("msgbatch_p", "v1"));
        var batches = new FakeBatchStore();
        var batcher = Batcher(api, store, batches);

        var handler = new CompanyHandler(
            Build.BoardClient(new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson((1, "Backend Engineer", LongContent)))),
            new FakeEmbeddingClient(), store, CompaniesConfig.ForTesting(Build.Token),
            NullLogger<CompanyHandler>.Instance, Client(api), batcher);

        await handler.HandleCompanyAsync(Build.Token);

        Assert.Equal(2, api.Calls);
        Assert.EndsWith("/api/match/job-facts/batches", api.RequestUris[0]);
        Assert.EndsWith("/api/match/job-parse/batches", api.RequestUris[1]);
        var facts = batches.Rows.Single(r => r.Kind == AiBatchRecord.Facts);
        var parse = batches.Rows.Single(r => r.Kind == AiBatchRecord.Parse);
        Assert.Equal([1L, 5L, 7L], facts.JobIds.Order());
        Assert.Equal([1L, 5L], parse.JobIds.Order());
        // Nothing was read live, so nothing was stored yet.
        Assert.Empty(store.SavedAiFor);
    }
}
