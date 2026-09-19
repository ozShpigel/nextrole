using ApplicationTracker.Core.Greenhouse;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;

namespace ApplicationTracker.Greenhouse;

/// <param name="Fetched">Jobs the board returned.</param>
/// <param name="Skipped">Unchanged content hash: neither embedded nor written.</param>
/// <param name="Embedded">Jobs sent to Voyage.</param>
/// <param name="Closed">Jobs marked closedAt this run.</param>
/// <param name="TokensBilled">Voyage's own usage.total_tokens, summed.</param>
public sealed record CompanyResult(
    int Fetched, int Skipped, int Embedded, long Closed, int TokensBilled)
{
    public BsonDocument ToCounts() => new()
    {
        { "fetched", Fetched },
        { "skipped", Skipped },
        { "embedded", Embedded },
        { "closed", Closed },
        { "tokensBilled", TokensBilled },
    };
}

/// <summary>
/// One company, start to finish. The unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Self-contained, idempotent, and it throws on failure.</b> Nothing in this
/// file knows a queue exists -- no AMQP type, no delivery tag, no ack. The
/// transport calls this and interprets the outcome; that is the only direction
/// the dependency runs. Driving it from a test means calling the method.
/// </para>
/// <para>
/// Idempotent because every write is keyed: the upsert is on
/// (boardToken, greenhouseJobId) behind a unique index, and the content hash
/// means a second run embeds nothing and writes nothing. Running it twice in a
/// row is the acceptance test, and killing it half-way and restarting reaches
/// the same rows -- the per-batch write is what makes the partial state valid
/// rather than torn.
/// </para>
/// </remarks>
public sealed class CompanyHandler
{
    private readonly IBoardClient _board;
    private readonly IEmbeddingClient _embeddings;
    private readonly IJobStore _store;
    private readonly CompaniesConfig _config;
    private readonly ILogger<CompanyHandler> _log;

    /// <summary>
    /// How many open jobs make an empty board response suspicious.
    /// </summary>
    /// <remarks>
    /// Above this, an empty response skips the close diff entirely. Below it,
    /// the diff runs -- a board with a handful of jobs genuinely can empty, and
    /// never closing those would leave them retrievable forever.
    /// </remarks>
    public const int EmptyResponseGuardThreshold = 10;

    public CompanyHandler(
        IBoardClient board, IEmbeddingClient embeddings, IJobStore store,
        CompaniesConfig config, ILogger<CompanyHandler> log)
    {
        _board = board;
        _embeddings = embeddings;
        _store = store;
        _config = config;
        _log = log;
    }

    public async Task<CompanyResult> HandleCompanyAsync(string boardToken, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(boardToken);

        var runId = Guid.NewGuid().ToString();
        var now = DateTime.UtcNow;

        // GUARD 1: never diff on a failed fetch.
        //
        // BoardClient throws on a non-2xx, an unparseable body, or a
        // meta.total/job-count mismatch. Because it throws, control never
        // reaches the diff below -- the guard is structural rather than a flag
        // somebody has to remember to check. A 429, a 500 and a truncated 5 MB
        // response all leave this company's stored jobs exactly as they were.
        var fetched = await _board.FetchAsync(boardToken, ct);

        var jobs = fetched.Select(j => GreenhouseJob.From(boardToken, j)).ToList();

        // Two jobs with the same board id in one response cannot both be
        // upserted: an unordered bulk write of two upserts on the same unique
        // key races itself. Last one wins, deterministically, here.
        jobs = [.. jobs.GroupBy(j => j.GreenhouseJobId).Select(g => g.Last())];

        var storedHashes = await _store.StoredHashesAsync(boardToken, ct);

        var changed = new List<GreenhouseJob>();
        var unchanged = new List<long>();

        foreach (var job in jobs)
        {
            // The skip. An unchanged hash costs neither an embedding nor a
            // content write -- only the presence touch below.
            if (storedHashes.TryGetValue(job.GreenhouseJobId, out var stored)
                && stored == job.ContentHash
                && stored.Length > 0)
                unchanged.Add(job.GreenhouseJobId);
            else
                changed.Add(job);
        }

        _log.LogInformation(
            "Board {Board}: {Total} job(s) -- {Changed} to embed, {Unchanged} unchanged",
            boardToken, jobs.Count, changed.Count, unchanged.Count);

        var embedded = 0;
        var tokens = 0;

        var batches = EmbeddingBatcher.Batch(
            changed, j => j.EmbedText, _config.EmbedBatchTokenBudget, _config.MaxBatchItems);

        for (var i = 0; i < batches.Count; i++)
        {
            ct.ThrowIfCancellationRequested();

            var batch = batches[i];
            var texts = batch.Select(j => j.EmbedText).ToList();

            var result = await _embeddings.EmbedAsync(texts, "document", ct);

            // Belt and braces over VoyageEmbeddingClient.Align, which has
            // already checked this. It costs one comparison and it guards the
            // one failure with no symptom: a vector attached to the wrong job
            // produces a clean run, correct counts and silently useless
            // retrieval. Any IEmbeddingClient implementation passes through
            // here, and this is the last point where the two lists are still
            // side by side.
            if (result.Vectors.Count != batch.Count)
                throw new EmbeddingException(
                    $"Batch {i + 1} of board '{boardToken}': {result.Vectors.Count} vectors "
                    + $"for {batch.Count} jobs. Refusing to write a misaligned batch.");

            var paired = batch.Zip(result.Vectors, (job, vector) => (Job: job, Vector: vector)).ToList();

            // WRITTEN PER BATCH, not at the end. If batch 5 of 8 throws, the
            // first four are durable and their embeddings are already paid for.
            await _store.UpsertBatchAsync(paired, runId, now, ct);

            embedded += batch.Count;
            tokens += result.TotalTokens;

            _log.LogInformation(
                "Board {Board}: batch {N}/{Total} -- {Count} job(s), {Tokens} tokens billed",
                boardToken, i + 1, batches.Count, batch.Count, result.TotalTokens);
        }

        // Presence for the ones we skipped. Also clears closedAt, so a job that
        // closed and came back unchanged reopens without being re-embedded.
        await _store.TouchAsync(boardToken, unchanged, runId, now, ct);

        // GUARD 2 is inside CloseMissingAsync: an empty response against a large
        // stored count logs and skips the diff rather than closing the board.
        var closed = await _store.CloseMissingAsync(
            boardToken,
            [.. jobs.Select(j => j.GreenhouseJobId)],
            EmptyResponseGuardThreshold,
            now,
            ct);

        return new CompanyResult(jobs.Count, unchanged.Count, embedded, closed, tokens);
    }
}
