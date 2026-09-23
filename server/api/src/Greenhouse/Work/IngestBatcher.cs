using ApplicationTracker.Core.Matching;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// The ingest's two reads through the Message Batches API: submit now, collect
/// on a later poll, at half the price of the live calls.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why.</b> job-facts and job-parse were about three quarters of the
/// production Anthropic bill, and nobody waits on them: the ingest runs on a
/// timer. A batch returns the same answers -- same prompts, model and chunking
/// (the API builds both paths from one request builder) -- within minutes to
/// hours.
/// </para>
/// <para>
/// <b>Pending markers.</b> Each posting in an open batch carries the batch id in
/// <c>ai_pending_facts</c> / <c>ai_pending_parse</c>. The backfill and re-read
/// selectors skip it, so the next run does not pay for the same read twice, and
/// the candidate search skips a posting whose parse is pending, so no scan pays
/// full price to parse it inline -- or scores it before its facts can filter it.
/// A marker is cleared only by the batch that set it: a newer batch for the
/// same posting owns it from then on.
/// </para>
/// <para>
/// <b>Never throws.</b> A failed submit leaves postings unread and unmarked, so
/// the next run's backfill submits them again, as a failed live call does today.
/// A failed collect is retried on the next poll.
/// </para>
/// </remarks>
public sealed class IngestBatcher
{
    /// <summary>
    /// A batch older than this is abandoned: its markers are cleared so the
    /// backfill reads the postings again.
    /// </summary>
    /// <remarks>
    /// Anthropic ends every batch within 24 hours; results stay retrievable for
    /// 29 days. Twice the processing window is room for an API outage without
    /// leaving a posting marked, and so hidden from candidates, indefinitely.
    /// </remarks>
    public static readonly TimeSpan AbandonAfter = TimeSpan.FromHours(48);

    private readonly IngestAiClient _ai;
    private readonly IJobStore _jobs;
    private readonly IAiBatchStore _batches;
    private readonly ILogger _log;

    public IngestBatcher(IngestAiClient ai, IJobStore jobs, IAiBatchStore batches, ILogger<IngestBatcher> log)
    {
        _ai = ai;
        _jobs = jobs;
        _batches = batches;
        _log = log;
    }

    /// <summary>Submit one read for these postings, in batches of at most 200.</summary>
    /// <returns>How many postings were submitted.</returns>
    public async Task<int> SubmitAsync(
        string boardToken, string kind, IReadOnlyList<IngestJob> jobs, DateTime now, CancellationToken ct)
    {
        var submitted = 0;
        foreach (var chunk in jobs.Chunk(IngestAiClient.BatchSubmitSize))
        {
            try
            {
                var batch = kind == AiBatchRecord.Facts
                    ? await _ai.SubmitFactsBatchAsync(chunk, ct)
                    : await _ai.SubmitParseBatchAsync(chunk, ct);
                if (batch is null) continue;

                var ids = chunk.Select(j => long.Parse(j.JobId)).ToList();

                // Recorded before the markers: a batch with no row is paid for
                // and never collected, while a row with no markers only lets
                // the next run submit the same postings again.
                await _batches.RecordAsync(new AiBatchRecord
                {
                    BatchId = batch.BatchId,
                    Kind = kind,
                    BoardToken = boardToken,
                    JobIds = ids,
                    ParseVersion = batch.ParseVersion,
                    SubmittedAt = now,
                }, ct);
                await _jobs.MarkAiPendingAsync(boardToken, ids, kind, batch.BatchId, ct);

                submitted += ids.Count;
                _log.LogInformation("Board {Board}: submitted {Kind} batch {BatchId} for {Count} posting(s)",
                    boardToken, kind, batch.BatchId, ids.Count);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _log.LogError(e, "Board {Board}: could not submit a {Kind} batch of {Count}; read again next run",
                    boardToken, kind, chunk.Length);
            }
        }
        return submitted;
    }

    /// <summary>Collect every batch that has ended. Safe to run as often as wanted.</summary>
    /// <returns>How many batches were closed this pass.</returns>
    public async Task<int> CollectAsync(DateTime now, CancellationToken ct)
    {
        IReadOnlyList<AiBatchRecord> pending;
        try
        {
            pending = await _batches.PendingAsync(ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogError(e, "Could not list pending AI batches; tried again next poll");
            return 0;
        }

        var closed = 0;
        foreach (var batch in pending)
        {
            try
            {
                if (await CollectOneAsync(batch, now, ct)) closed++;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _log.LogError(e, "Collecting {Kind} batch {BatchId} failed; tried again next poll",
                    batch.Kind, batch.BatchId);
            }
        }
        return closed;
    }

    private async Task<bool> CollectOneAsync(AiBatchRecord batch, DateTime now, CancellationToken ct)
    {
        if (now - batch.SubmittedAt > AbandonAfter)
        {
            await _jobs.ClearAiPendingAsync(batch.BoardToken, batch.JobIds, batch.Kind, batch.BatchId, ct);
            await _batches.CloseAsync(batch.BatchId, "abandoned", now, ct);
            _log.LogWarning("Board {Board}: abandoned {Kind} batch {BatchId} after {Hours}h; its postings are read again next run",
                batch.BoardToken, batch.Kind, batch.BatchId, (int)AbandonAfter.TotalHours);
            return true;
        }

        var wanted = batch.JobIds.ToHashSet();
        long saved;

        if (batch.Kind == AiBatchRecord.Facts)
        {
            var result = await _ai.CollectFactsBatchAsync(batch.BatchId, ct);
            if (result is not { Status: IngestBatchStatus.Ended } ended) return false;

            // extract_attempts counts, as for a live facts read.
            saved = await _jobs.SaveIngestAiAsync(
                batch.BoardToken, ByJobId(ended.Facts, wanted), new Dictionary<long, BsonDocument>(), null, now, ct);
        }
        else
        {
            // The parse is verified against the postings it was made from, so
            // the collect carries them (the API keeps nothing between calls).
            var stored = await _jobs.StoredContentForAsync(batch.BoardToken, batch.JobIds, ct);
            var jobs = stored
                .Select(p => new IngestJob(p.GreenhouseJobId.ToString(), p.Title, p.Company, p.Location, p.Content))
                .ToList();
            if (jobs.Count == 0)
            {
                await _batches.CloseAsync(batch.BatchId, "collected", now, ct);
                return true;
            }

            var result = await _ai.CollectParseBatchAsync(batch.BatchId, jobs, ct);
            if (result is not { Status: IngestBatchStatus.Ended } ended) return false;

            // Not an extraction attempt: extract_attempts counts facts reads,
            // and the re-read ceiling is measured in them. A live read saved
            // facts and parse together and counted once; counting both batches
            // would cost every posting one of its re-reads.
            saved = await _jobs.SaveIngestAiAsync(
                batch.BoardToken, new Dictionary<long, BsonDocument>(), ByJobId(ended.Parsed, wanted),
                batch.ParseVersion, now, ct, countAttempt: false);
        }

        await _jobs.ClearAiPendingAsync(batch.BoardToken, batch.JobIds, batch.Kind, batch.BatchId, ct);
        await _batches.CloseAsync(batch.BatchId, "collected", now, ct);

        _log.LogInformation("Board {Board}: collected {Kind} batch {BatchId} -- {Saved} of {Count} posting(s) stored",
            batch.BoardToken, batch.Kind, batch.BatchId, saved, batch.JobIds.Count);
        return true;
    }

    /// <summary>Re-key string ids to the collection's long ids, keeping only the batch's own.</summary>
    /// <remarks>
    /// An id the batch did not submit is dropped rather than stored: attaching
    /// one posting's read to another is the failure this correlation exists to
    /// prevent.
    /// </remarks>
    private static Dictionary<long, BsonDocument> ByJobId(Dictionary<string, BsonDocument> source, HashSet<long> wanted)
    {
        var result = new Dictionary<long, BsonDocument>(source.Count);
        foreach (var (key, value) in source)
            if (long.TryParse(key, out var id) && wanted.Contains(id)) result[id] = value;
        return result;
    }
}
