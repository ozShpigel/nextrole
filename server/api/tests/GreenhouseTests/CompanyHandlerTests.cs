using System.Net;
using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The unit of work, driven directly -- no queue, no broker, no transport.
/// </summary>
/// <remarks>
/// That this file compiles without a single AMQP type is itself the assertion
/// that the transport does not leak into <c>HandleCompanyAsync</c>.
/// </remarks>
public class CompanyHandlerTests
{
    private static readonly string LongContent = "&lt;p&gt;" + new string('a', 400) + "&lt;/p&gt;";

    // ---- the hash skip -----------------------------------------------------

    [Fact]
    public async Task Embeds_every_job_on_a_first_run()
    {
        var board = new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson(
            (1, "Backend Engineer", LongContent),
            (2, "Platform Engineer", LongContent)));

        var embeddings = new FakeEmbeddingClient();
        var store = new FakeJobStore();

        var result = await Build.Handler(board, embeddings, store).HandleCompanyAsync(Build.Token);

        Assert.Equal(2, result.Fetched);
        Assert.Equal(2, result.Embedded);
        Assert.Equal(0, result.Skipped);
        Assert.Equal(2, store.Hashes.Count);
    }

    [Fact]
    public async Task An_unchanged_hash_costs_neither_an_embedding_nor_a_write()
    {
        var json = Build.BoardJson((1, "Backend Engineer", LongContent), (2, "Platform Engineer", LongContent));

        var store = new FakeJobStore();
        var first = new FakeEmbeddingClient();
        await Build.Handler(new StubHandler().EnqueueJson(HttpStatusCode.OK, json), first, store)
            .HandleCompanyAsync(Build.Token);

        // The store carries the first run's hashes into the second, so its
        // write log carries the first run's writes too. The assertion is that
        // the second run ADDS nothing, not that nothing was ever written.
        var writesAfterFirstRun = store.UpsertBatchSizes.Count;

        // Same board, same content, second run.
        var second = new FakeEmbeddingClient();
        var result = await Build.Handler(new StubHandler().EnqueueJson(HttpStatusCode.OK, json), second, store)
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(2, result.Skipped);
        Assert.Equal(0, result.Embedded);
        Assert.Empty(second.Batches);                                    // no Voyage call at all
        Assert.Equal(writesAfterFirstRun, store.UpsertBatchSizes.Count); // and no write
        Assert.Equal([1, 2], store.Touched.Order());
    }

    [Fact]
    public async Task Only_the_changed_job_is_re_embedded()
    {
        var store = new FakeJobStore();
        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson(
                    (1, "Backend Engineer", LongContent),
                    (2, "Platform Engineer", LongContent))),
                new FakeEmbeddingClient(), store)
            .HandleCompanyAsync(Build.Token);

        var embeddings = new FakeEmbeddingClient();
        var result = await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson(
                    (1, "Backend Engineer", LongContent),
                    (2, "Platform Engineer", LongContent + "&lt;p&gt;now with Kubernetes&lt;/p&gt;"))),
                embeddings, store)
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, result.Embedded);
        Assert.Equal(1, result.Skipped);
        Assert.Contains("Kubernetes", Assert.Single(embeddings.Batches)[0]);
    }

    [Fact]
    public async Task A_changed_title_alone_re_embeds_the_job()
    {
        // The embedded text leads with the title, so a re-titled job whose body
        // is identical MUST change hash. If it did not, the stored vector would
        // keep the old title forever -- and the skip is permanent, because
        // every later run compares the same unchanged hash again.
        var store = new FakeJobStore();
        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson((1, "Backend Engineer", LongContent))),
                new FakeEmbeddingClient(), store)
            .HandleCompanyAsync(Build.Token);

        var result = await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson((1, "Staff Backend Engineer", LongContent))),
                new FakeEmbeddingClient(), store)
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, result.Embedded);
        Assert.Equal(0, result.Skipped);
    }

    // ---- batching and alignment -------------------------------------------

    [Fact]
    public async Task Writes_per_batch_rather_than_once_at_the_end()
    {
        // Five jobs, a cap of two: three batches, three writes. If a later
        // batch failed, the earlier ones would already be durable and their
        // embeddings already paid for.
        var jobs = Enumerable.Range(1, 5)
            .Select(i => ((long)i, $"Role {i}", LongContent + i))
            .ToArray();

        var store = new FakeJobStore();
        var config = CompaniesConfig.ForTesting(Build.Token) with { MaxBatchItems = 2 };

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson(jobs)),
                new FakeEmbeddingClient(), store, config)
            .HandleCompanyAsync(Build.Token);

        Assert.Equal([2, 2, 1], store.UpsertBatchSizes);
    }

    [Fact]
    public async Task Each_job_is_stored_with_its_own_vector()
    {
        // The fake's vectors encode their input text, so a misalignment is
        // visible in the stored rows. A constant vector would make every wrong
        // pairing look correct.
        var jobs = Enumerable.Range(1, 6)
            .Select(i => ((long)i, $"Role {i}", LongContent + i))
            .ToArray();

        var store = new FakeJobStore();
        var embeddings = new FakeEmbeddingClient();
        var config = CompaniesConfig.ForTesting(Build.Token) with { MaxBatchItems = 2 };

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson(jobs)),
                embeddings, store, config)
            .HandleCompanyAsync(Build.Token);

        var texts = embeddings.Batches.SelectMany(b => b).ToList();
        for (var i = 0; i < 6; i++)
        {
            var expected = (float)texts[i].GetHashCode();
            Assert.Equal(expected, store.Vectors[i + 1][0]);
        }
    }

    [Fact]
    public async Task Refuses_to_write_a_batch_the_embedder_returned_the_wrong_number_of_vectors_for()
    {
        // Guards against any IEmbeddingClient, not just the Voyage one: this is
        // the last point at which the jobs and the vectors are side by side.
        var short1 = new FakeEmbeddingClient(custom: texts =>
            new EmbeddingBatchResult([.. texts.Skip(1).Select(_ => new float[4])], 1));

        var store = new FakeJobStore();

        await Assert.ThrowsAsync<EmbeddingException>(() => Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson(
                    (1, "A", LongContent), (2, "B", LongContent))),
                short1, store)
            .HandleCompanyAsync(Build.Token));

        Assert.Empty(store.UpsertBatchSizes);
    }

    [Fact]
    public async Task Embeds_documents_as_documents()
    {
        var embeddings = new FakeEmbeddingClient();

        await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson((1, "A", LongContent))),
                embeddings, new FakeJobStore())
            .HandleCompanyAsync(Build.Token);

        Assert.Equal("document", Assert.Single(embeddings.InputTypes));
    }

    [Fact]
    public async Task Collapses_a_duplicate_job_id_within_one_response()
    {
        // Two upserts on the same unique key inside one unordered bulk write
        // race each other. Collapsed here, deterministically.
        var store = new FakeJobStore();

        var result = await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson(
                    2, (1, "A", LongContent), (1, "A again", LongContent))),
                new FakeEmbeddingClient(), store)
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, result.Fetched);
        Assert.Equal(1, result.Embedded);
    }

    // ---- GUARD 1: never diff on a failed fetch -----------------------------

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task A_failed_fetch_never_reaches_the_close_diff(HttpStatusCode status)
    {
        // The guard is structural: BoardClient throws, so control cannot reach
        // the diff. Asserted as "the store was never asked to close anything"
        // rather than by inspecting a flag -- there is no flag to inspect.
        var store = new FakeJobStore();

        await Assert.ThrowsAsync<BoardFetchException>(() => Build.Handler(
                new StubHandler().EnqueueJson(status, """{"error":"nope"}"""),
                new FakeEmbeddingClient(), store)
            .HandleCompanyAsync(Build.Token));

        Assert.Equal(0, store.CloseCalls);
        Assert.Empty(store.UpsertBatchSizes);
        Assert.Empty(store.Touched);
    }

    [Fact]
    public async Task A_truncated_response_is_a_failed_fetch_not_a_board_that_shrank()
    {
        // meta.total says 50, the body carries 2. Measured on four real boards,
        // meta.total always equalled the job count -- so a mismatch means a
        // short read, and reading the missing tail as closures would close 48
        // live jobs.
        var store = new FakeJobStore();

        var e = await Assert.ThrowsAsync<BoardFetchException>(() => Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson(
                    50, (1, "A", LongContent), (2, "B", LongContent))),
                new FakeEmbeddingClient(), store)
            .HandleCompanyAsync(Build.Token));

        Assert.Contains("meta.total=50", e.Message);
        Assert.Equal(0, store.CloseCalls);
    }

    [Fact]
    public async Task An_unparseable_body_is_a_failed_fetch()
    {
        var store = new FakeJobStore();

        await Assert.ThrowsAsync<BoardFetchException>(() => Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, """{ "jobs": [ {"id": 1, "ti"""),
                new FakeEmbeddingClient(), store)
            .HandleCompanyAsync(Build.Token));

        Assert.Equal(0, store.CloseCalls);
    }

    [Fact]
    public async Task An_embedding_failure_also_stops_short_of_the_close_diff()
    {
        // Not one of the two named guards, but the same principle: a run that
        // could not finish must not conclude anything about what closed.
        var failing = new FakeEmbeddingClient(custom: _ => throw new EmbeddingException("boom"));
        var store = new FakeJobStore();

        await Assert.ThrowsAsync<EmbeddingException>(() => Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson((1, "A", LongContent))),
                failing, store)
            .HandleCompanyAsync(Build.Token));

        Assert.Equal(0, store.CloseCalls);
    }

    // ---- the diff is reached on a good fetch -------------------------------

    [Fact]
    public async Task A_successful_run_passes_the_seen_ids_to_the_close_diff()
    {
        var store = new FakeJobStore { CloseReturns = 3 };

        var result = await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson(
                    (1, "A", LongContent), (2, "B", LongContent))),
                new FakeEmbeddingClient(), store)
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, store.CloseCalls);
        Assert.Equal([1, 2], store.LastCloseSeenIds!.Order());
        Assert.Equal(3, result.Closed);
    }

    [Fact]
    public async Task An_empty_board_still_reaches_the_diff_so_the_guard_can_judge_it()
    {
        // The handler must not second-guess the guard: an empty response is a
        // legitimate fetch, and whether it closes anything is CloseDiff's
        // decision, made against the stored count.
        var store = new FakeJobStore();

        var result = await Build.Handler(
                new StubHandler().EnqueueJson(HttpStatusCode.OK, Build.BoardJson(0)),
                new FakeEmbeddingClient(), store)
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(0, result.Fetched);
        Assert.Equal(1, store.CloseCalls);
        Assert.Empty(store.LastCloseSeenIds!);
    }

    [Fact]
    public async Task Refuses_a_blank_board_token()
    {
        await Assert.ThrowsAnyAsync<ArgumentException>(() =>
            Build.Handler(new StubHandler(), new FakeEmbeddingClient(), new FakeJobStore())
                .HandleCompanyAsync("   "));
    }
}
