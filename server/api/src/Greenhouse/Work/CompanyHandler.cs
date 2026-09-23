using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Core.Matching;
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
    private readonly IngestAiClient? _ai;
    private readonly IngestBatcher? _batcher;
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
        CompaniesConfig config, ILogger<CompanyHandler> log, IngestAiClient? ai = null,
        IngestBatcher? batcher = null)
    {
        // Set when Greenhouse:UseBatchApi is on: the same two reads go through
        // the Message Batches API at half the price and are collected later.
        // Null keeps the live path below, unchanged.
        _batcher = batcher;
        _board = board;
        _embeddings = embeddings;
        // Optional so the unit tests can drive the handler without an API to
        // call. Null means the AI passes are skipped and the jobs are stored
        // with extracted/parsed null -- which the scan tolerates, at the cost
        // of parsing inline per user.
        _ai = ai;
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

        // The two USER-INDEPENDENT AI reads, once per job, here rather than
        // once per user.
        //
        // Neither pass sees a profile, so their output cannot differ between
        // users -- running them per user was measured at 2.1x the entire
        // global ingest pipeline, spent recomputing identical answers. Doing
        // them here is what leaves the per-user scan with a single Evaluator
        // call, and it is what feeds EnforceEvidenceCaps and ClaimGrounding
        // from a reading the scored model did not author.
        //
        // Only for jobs whose content CHANGED. An unchanged posting keeps the
        // facts and parse it already has; that is the whole point of the hash.
        if (_batcher is not null)
        {
            await SubmitBatchedReadsAsync(boardToken, changed, now, ct);
        }
        else if (_ai is not null && changed.Count > 0)
        {
            await RunIngestAiAsync(boardToken, ToIngestJobs(changed), now, ct);
        }

        // ...and then the ones the hash skip can never reach: postings stored
        // before this ran at all. A run with no Api:BaseUrl, or with the API
        // down, leaves facts and parse missing, and an unchanged hash means
        // nothing ever looks at them again. Without this sweep the only repair
        // is the company editing their own posting text.
        if (_ai is not null && _batcher is null)
        {
            await BackfillIngestAiAsync(boardToken, now, ct);
            await ReReadFactsAsync(boardToken, now, ct);
        }

        // Presence for the ones we skipped. Also clears closedAt, so a job that
        // closed and came back unchanged reopens without being re-embedded.
        await _store.TouchAsync(boardToken, unchanged, runId, now, ct);

        await StampLogoAsync(boardToken, ct);

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

    /// <summary>
    /// Run job-facts and job-parse over the changed jobs and store both.
    /// </summary>
    /// <remarks>
    /// Never throws. Both passes already swallow their own failures and return
    /// what they got, and a posting is worth keeping even when the reads about
    /// it are not available yet -- the scan degrades to an inline parse rather
    /// than losing the job. Letting a failure here fail the company would nack
    /// a message whose embeddings are already written and paid for.
    /// </remarks>
    /// <summary>
    /// How many never-read postings one run will sweep, per board.
    /// </summary>
    /// <remarks>
    /// Bounded so recovering a backlog cannot turn a nightly run into an
    /// unbounded Claude bill in one go — 100 is two facts chunks and ten parse
    /// chunks. The selector sorts oldest-first, so successive runs drain the
    /// backlog instead of re-reading the same page.
    /// </remarks>
    public const int BackfillBatchSize = 100;

    // The board's own job id is the correlation key, as a string, because that
    // is what the endpoints take. It maps back to the long the collection is
    // keyed on.
    private static List<IngestJob> ToIngestJobs(IReadOnlyList<GreenhouseJob> jobs) =>
        [.. jobs.Select(j => new IngestJob(
            j.GreenhouseJobId.ToString(),
            j.Source.Title ?? "",
            j.Source.CompanyName,
            j.Source.Location?.Name,
            j.CleanedContent))];

    /// <summary>
    /// The batch path: every read this run owes, submitted instead of awaited.
    /// </summary>
    /// <remarks>
    /// The same three sets the live path reads -- changed postings, the never-
    /// read backlog, and the facts re-read -- each posting once. Changed and
    /// backlog postings need both reads; re-read postings need facts only, so
    /// they get no parse batch and stay visible to the candidate search while
    /// their new facts are in flight. The backlog and re-read selectors skip
    /// postings already in an open batch, so nothing is paid for twice. Never
    /// throws, like the live path: the board is already fetched, embedded and
    /// written.
    /// </remarks>
    private async Task SubmitBatchedReadsAsync(
        string boardToken, IReadOnlyList<GreenhouseJob> changed, DateTime now, CancellationToken ct)
    {
        try
        {
            var both = ToIngestJobs(changed);
            var seen = both.Select(j => j.JobId).ToHashSet();

            var backlog = await _store.NeedingIngestAiAsync(boardToken, BackfillBatchSize, ct);
            both.AddRange(backlog.Where(p => seen.Add(p.GreenhouseJobId.ToString())).Select(ToIngestJob));

            var reread = await _store.NeedingFactsReReadAsync(boardToken, BackfillBatchSize, ct);
            var factsOnly = reread.Where(p => seen.Add(p.GreenhouseJobId.ToString())).Select(ToIngestJob).ToList();

            var facts = await _batcher!.SubmitAsync(boardToken, AiBatchRecord.Facts, [.. both, .. factsOnly], now, ct);
            var parses = await _batcher.SubmitAsync(boardToken, AiBatchRecord.Parse, both, now, ct);

            if (facts + parses > 0)
                _log.LogInformation(
                    "Board {Board}: submitted {Facts} facts read(s) and {Parses} parse(s) as batches "
                    + "({Changed} changed, {Backlog} never read, {ReRead} re-read)",
                    boardToken, facts, parses, changed.Count, backlog.Count, factsOnly.Count);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogError(e, "Board {Board}: could not submit the batched reads; they are owed again next run", boardToken);
        }
    }

    private static IngestJob ToIngestJob(StoredJobContent p) =>
        new(p.GreenhouseJobId.ToString(), p.Title, p.Company, p.Location, p.Content);

    /// <summary>
    /// Run the ingest AI reads over postings that have never had them.
    /// </summary>
    /// <remarks>
    /// Reads the stored content rather than the board response, so it repairs a
    /// posting whose text has not changed since it was stored. Deliberately
    /// does NOT re-embed: the vectors are valid and already paid for, and only
    /// the reads are missing.
    /// </remarks>
    private async Task BackfillIngestAiAsync(string boardToken, DateTime now, CancellationToken ct)
    {
        List<IngestJob> aiJobs;
        try
        {
            var pending = await _store.NeedingIngestAiAsync(boardToken, BackfillBatchSize, ct);
            if (pending.Count == 0) return;

            _log.LogInformation(
                "Board {Board}: {Count} stored posting(s) have never had the ingest AI reads; backfilling",
                boardToken, pending.Count);

            aiJobs = [.. pending.Select(p => new IngestJob(
                p.GreenhouseJobId.ToString(), p.Title, p.Company, p.Location, p.Content))];
        }
        catch (Exception e)
        {
            // Selecting the backlog is not worth failing a company over: the
            // board has already been fetched, embedded and written.
            _log.LogError(e, "Board {Board}: could not select postings needing the ingest AI reads", boardToken);
            return;
        }

        await RunIngestAiAsync(boardToken, aiJobs, now, ct);
    }

    /// <summary>
    /// Re-read the facts of postings read before requirement groups existed.
    /// </summary>
    /// <remarks>
    /// Facts only, never the parse: the parse did not change and costs several
    /// times more. Same per-board bound as the backfill, so a board of any size
    /// drains over successive runs rather than in one bill. Never throws, for
    /// the same reason the backfill does not.
    /// </remarks>
    private async Task ReReadFactsAsync(string boardToken, DateTime now, CancellationToken ct)
    {
        try
        {
            var pending = await _store.NeedingFactsReReadAsync(boardToken, BackfillBatchSize, ct);
            if (pending.Count == 0) return;

            _log.LogInformation(
                "Board {Board}: {Count} stored posting(s) have facts from before requirement groups; re-reading the facts",
                boardToken, pending.Count);

            List<IngestJob> jobs = [.. pending.Select(p => new IngestJob(
                p.GreenhouseJobId.ToString(), p.Title, p.Company, p.Location, p.Content))];

            var facts = await ChunkedAsync(jobs, IngestAiClient.FactsChunkSize,
                chunk => _ai!.ExtractFactsAsync(chunk, ct));

            var saved = await _store.SaveIngestAiAsync(
                boardToken, ByJobId(facts), new Dictionary<long, BsonDocument>(), null, now, ct);

            _log.LogInformation(
                "Board {Board}: re-read {Facts} fact read(s) over {Rows} row(s)",
                boardToken, facts.Count, saved);
        }
        catch (Exception e)
        {
            _log.LogError(e, "Board {Board}: the facts re-read failed; the old facts stay in place", boardToken);
        }
    }

    private async Task RunIngestAiAsync(
        string boardToken, IReadOnlyList<IngestJob> aiJobs, DateTime now, CancellationToken ct)
    {
        if (aiJobs.Count == 0) return;

        try
        {
            var facts = await ChunkedAsync(aiJobs, IngestAiClient.FactsChunkSize,
                chunk => _ai!.ExtractFactsAsync(chunk, ct));

            string? parseVersion = null;
            var parsed = await ChunkedAsync(aiJobs, IngestAiClient.ParseChunkSize, async chunk =>
            {
                var (result, version) = await _ai!.ParseAsync(chunk, ct);
                if (version is not null) parseVersion = version;
                return result;
            });

            var saved = await _store.SaveIngestAiAsync(
                boardToken, ByJobId(facts), ByJobId(parsed), parseVersion, now, ct);

            _log.LogInformation(
                "Board {Board}: stored {Facts} fact read(s) and {Parsed} parse(s) over {Rows} row(s)",
                boardToken, facts.Count, parsed.Count, saved);
        }
        catch (Exception e)
        {
            _log.LogError(e,
                "Board {Board}: the ingest AI passes failed; jobs are stored without facts or a parse "
                + "and the per-user scan will parse them inline", boardToken);
        }
    }

    /// <summary>
    /// Stamp the board's configured logo onto its rows.
    /// </summary>
    /// <remarks>
    /// Never throws. A logo is display-only, and failing the company over it
    /// would nack a message whose embeddings are already written and paid for.
    /// The next run stamps it again.
    /// </remarks>
    private async Task StampLogoAsync(string boardToken, CancellationToken ct)
    {
        var logo = _config.LogoUrlFor(boardToken);
        try
        {
            var stamped = await _store.StampCompanyLogoAsync(boardToken, logo, ct);
            if (stamped > 0)
                _log.LogInformation("Board {Board}: set the company logo on {Count} row(s)", boardToken, stamped);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogError(e, "Board {Board}: could not set the company logo", boardToken);
        }
    }

    /// <summary>Re-key the API's string job ids back to the collection's long ids.</summary>
    /// <remarks>
    /// A key that will not parse is dropped rather than guessed at. Attaching
    /// one job's facts to another is the failure this whole correlation exists
    /// to avoid.
    /// </remarks>
    private static Dictionary<long, BsonDocument> ByJobId(Dictionary<string, BsonDocument> source)
    {
        var result = new Dictionary<long, BsonDocument>(source.Count);
        foreach (var (key, value) in source)
            if (long.TryParse(key, out var id)) result[id] = value;
        return result;
    }

    private static async Task<Dictionary<string, BsonDocument>> ChunkedAsync(
        IReadOnlyList<IngestJob> jobs, int chunkSize,
        Func<IReadOnlyList<IngestJob>, Task<Dictionary<string, BsonDocument>>> call)
    {
        var merged = new Dictionary<string, BsonDocument>();
        for (var i = 0; i < jobs.Count; i += chunkSize)
        {
            foreach (var (k, v) in await call([.. jobs.Skip(i).Take(chunkSize)]))
                merged[k] = v;
        }
        return merged;
    }
}
