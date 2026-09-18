using ApplicationTracker.Core.Matching;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.PoolIngest;

/// <summary>
/// The shared job pool's daily ingest.
/// </summary>
/// <remarks>
/// One run, one pool, everyone. Nothing here reads a profile or scores
/// anything: the pool is common to every user, so a job's stored facts are a
/// property of the posting and are computed exactly once.
///
/// Ported from the scraper's <c>app/services/pool.py</c>. What changed is where
/// it runs, not what it does — the counters, the chunk sizes and the attempt
/// cap are the measured values from that implementation, not fresh guesses.
/// </remarks>
public sealed class IngestRunner
{
    // One Haiku call per chunk; the API caps a request at 200 jobs.
    private const int ExtractChunkSize = 25;
    // Smaller than the extraction chunk: a ParsedJob is a whole structured
    // document per job (~712 output tokens at the median, p99 far higher),
    // where a facts row is ~140. The response, not the request, bounds this.
    private const int ParseChunkSize = 5;
    private const int MaxConcurrentChunks = 2;
    // A posting whose facts could not be read is retried on later runs, but not
    // forever: a permanently unreadable one would otherwise cost a Claude call
    // a day for as long as it stays in the pool, and that bill grows with the
    // role list. After this many attempts it stays in the pool unextracted.
    private const int MaxExtractAttempts = 3;

    private readonly RolesConfig _config;
    private readonly EffectiveRoles _roles;
    private readonly ScrapeClient _scraper;
    private readonly IngestAiClient _ai;
    private readonly PoolWriter _pool;
    private readonly IMongoCollection<BsonDocument> _runs;
    private readonly ILogger<IngestRunner> _log;

    public IngestRunner(
        RolesConfig config, EffectiveRoles roles, ScrapeClient scraper, IngestAiClient ai,
        PoolWriter pool, IMongoCollection<BsonDocument> runs, ILogger<IngestRunner> log)
    {
        _config = config;
        _roles = roles;
        _scraper = scraper;
        _ai = ai;
        _pool = pool;
        _runs = runs;
        _log = log;
    }

    // Longest run measured so far: 458s, 542s, 739s. Two hours is far clear of
    // that and still catches a death the same night.
    private static readonly TimeSpan OrphanAfter = TimeSpan.FromHours(2);

    /// <summary>
    /// Mark runs that nothing ever finished as failed (issue #90).
    /// </summary>
    /// <remarks>
    /// The record is written twice: <c>pending</c> on start, then
    /// <c>completed</c>/<c>failed</c> at the end. A process killed in between —
    /// OOM, a reboot, an evicted container — never writes the second, so the row
    /// stays <c>pending</c> forever and is indistinguishable from one that is
    /// running right now.
    ///
    /// The scraper used to sweep these on ITS startup, which was sound while it
    /// ran the ingest in-process. It is not any more: a scraper restart says
    /// nothing about whether an ingest died, and it could mark a live run
    /// failed. This process is the only one that knows, because it is the
    /// ingest.
    ///
    /// Age-based rather than a lock, because two ingests never overlap by
    /// design — one timer, one container.
    ///
    /// Scoped to <c>criteria_id: "pool"</c>, which is a deliberate limit rather
    /// than an oversight: nothing has created a criteria-driven run since Phase
    /// 0, and none is pending (measured: 211 completed, 11 failed, 1 cancelled,
    /// 0 pending). Sweeping rows this process did not write would mean deciding
    /// on behalf of a pipeline it knows nothing about.
    ///
    /// This is preventive, not remedial — but not theoretical either. One run
    /// has already been orphaned: a Python ingest interrupted at 12:42 on
    /// 2026-09-17 sat pending for an hour and forty minutes, and was only
    /// cleaned up because an unrelated deploy happened to restart the scraper,
    /// whose own reconciler then caught it. Without that deploy it would still
    /// be pending. That reconciler is deleted in this same phase, because a
    /// scraper restart says nothing about whether an ingest died — and worse,
    /// it could have marked a LIVE run failed.
    /// </remarks>
    private async Task SweepOrphanedRunsAsync(CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow - OrphanAfter;

        var swept = await _runs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq("criteria_id", "pool"),
                Builders<BsonDocument>.Filter.Eq("status", "pending"),
                Builders<BsonDocument>.Filter.Lt("started_at", cutoff)),
            Builders<BsonDocument>.Update
                .Set("status", "failed")
                .Set("error", "Orphaned — no process ever completed this run. "
                    + "Marked failed by a later ingest; see issue #90.")
                .Set("completed_at", DateTime.UtcNow),
            cancellationToken: ct);

        if (swept.ModifiedCount > 0)
            _log.LogWarning(
                "Swept {Count} orphaned pool run(s) to failed — they were left pending by a process "
                + "that died before finishing. A run that dies silently otherwise looks like one that worked.",
                swept.ModifiedCount);
    }

    public async Task<RunRecord> RunAsync(CancellationToken ct)
    {
        // Before claiming a row of our own, settle any left pending by a
        // process that died (issue #90).
        await SweepOrphanedRunsAsync(ct);

        var run = RunRecord.Start();
        await _runs.InsertOneAsync(run.ToDocument(), cancellationToken: ct);

        try
        {
            // Keep the API's view of "roles already being searched" current
            // before the run reads the grown half back out of the same
            // collection. The file is authoritative either way.
            await _roles.PublishBaselineAsync(_config, ct);

            var searchRoles = await _roles.ResolveAsync(_config, ct);
            _log.LogInformation("Pool run {RunId}: {Roles} role(s) x {Locations} location(s)",
                run.Id, searchRoles.Count, _config.Locations.Count);

            var scrape = await _scraper.ScrapeAsync(_config, searchRoles, ct);
            run.JobsScraped = scrape.Jobs.Count;
            run.SearchesTotal = scrape.Stats.SearchesTotal;
            run.SearchesFailed = scrape.Stats.SearchesFailed;
            run.SearchesEmpty = scrape.Stats.SearchesEmpty;

            var seenKeys = await UpsertAsync(run, scrape.Jobs, ct);
            var (missed, deactivated) = await _pool.AgeOutAsync(seenKeys, _config.MissedRunsBeforeInactive, ct);
            run.JobsMissed = missed;
            run.JobsMarkedInactive = deactivated;

            run.Status = "completed";
        }
        catch (Exception e)
        {
            _log.LogError(e, "Pool run {RunId} failed", run.Id);
            run.Status = "failed";
            run.Error = e.Message;
        }

        run.CompletedAt = DateTime.UtcNow;
        await _runs.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("id", run.Id),
            new BsonDocument("$set", run.ToDocument()),
            cancellationToken: ct);

        // The counters worth reading at a glance, and the two that catch a
        // silent failure: extracted should track new plus retried, and parsed
        // should track new. A run reporting new jobs with neither is the shape
        // the 401 regression had -- completed, plausible, and storing pool
        // documents with nothing to filter or score on.
        _log.LogInformation(
            "Pool run {RunId} {Status}: {Scraped} scraped, {New} new, {Known} refreshed, "
            + "{Extracted} extracted ({Retried} retried), {Parsed} parsed, {Inactive} marked inactive",
            run.Id, run.Status, run.JobsScraped, run.JobsNew, run.JobsAlreadyKnown,
            run.JobsExtracted, run.JobsExtractRetried, run.JobsParsed, run.JobsMarkedInactive);

        return run;
    }

    /// <summary>Fold this run's scrape into the pool. Returns every pool key seen.</summary>
    private async Task<HashSet<string>> UpsertAsync(RunRecord run, List<ScrapedJob> jobs, CancellationToken ct)
    {
        // Within one run the same listing can surface under several role
        // searches; first one wins, the rest are the same posting.
        var byKey = new Dictionary<string, ScrapedJob>();
        foreach (var job in jobs)
            byKey.TryAdd(PoolKey.For(job.JobUrl, job.Company, job.Title, job.DatePosted), job);

        if (byKey.Count == 0) return [];

        var now = DateTime.UtcNow;
        var existing = await _pool.ExistingKeysAsync(byKey.Keys, ct);

        run.JobsAlreadyKnown = await _pool.TouchAsync(existing, run.Id, now, ct);

        // Facts are never RE-computed for a job that has them. A job still
        // missing them gets a bounded number of further attempts.
        await RetryMissingFactsAsync(run, existing, now, ct);

        var newJobs = byKey.Where(kv => !existing.Contains(kv.Key)).ToList();
        if (newJobs.Count == 0) return [.. byKey.Keys];

        var payloads = newJobs.Select(kv => kv.Value).ToList();
        var facts = await ChunkedAsync(payloads, ExtractChunkSize,
            chunk => _ai.ExtractFactsAsync(chunk, ct));

        // The Analyst read, computed once here instead of once per user.
        // Failure is not fatal: the job is stored unparsed and the per-user
        // scan parses it inline, which is what happened before this existed.
        string? parseVersion = null;
        var parsed = await ChunkedAsync(payloads, ParseChunkSize, async chunk =>
        {
            var (result, version) = await _ai.ParseAsync(chunk, ct);
            if (version is not null) parseVersion = version;
            return result;
        });

        var docs = newJobs.Select(kv => PoolDocument.Build(
            kv.Value, kv.Key, run.Id, now,
            facts.GetValueOrDefault(kv.Value.Id),
            parsed.GetValueOrDefault(kv.Value.Id),
            parseVersion)).ToList();

        run.JobsNew = await _pool.InsertAsync(docs, ct);
        run.JobsExtracted += facts.Count;
        run.JobsParsed = parsed.Count;

        if (run.JobsNew > run.JobsExtracted)
            _log.LogWarning(
                "Pool run {RunId}: {Without} of {New} new jobs stored without facts — retried next run",
                run.Id, run.JobsNew - run.JobsExtracted, run.JobsNew);

        return [.. byKey.Keys];
    }

    /// <summary>
    /// Give jobs that entered the pool without facts another go — up to
    /// <see cref="MaxExtractAttempts"/>, then never again.
    /// </summary>
    private async Task RetryMissingFactsAsync(
        RunRecord run, IReadOnlyCollection<string> seenKeys, DateTime now, CancellationToken ct)
    {
        var candidates = await _pool.FactlessAsync(seenKeys, MaxExtractAttempts, ct);
        if (candidates.Count == 0) return;

        _log.LogInformation("Pool run {RunId}: retrying extraction for {Count} job(s) stored without facts",
            run.Id, candidates.Count);

        var asJobs = candidates.Select(d => new ScrapedJob
        {
            Id = Str(d, "id") ?? "",
            Title = Str(d, "title") ?? "",
            Company = Str(d, "company") ?? "",
            Location = Str(d, "location"),
            Description = Str(d, "description"),
        }).ToList();

        var facts = await ChunkedAsync(asJobs, ExtractChunkSize, chunk => _ai.ExtractFactsAsync(chunk, ct));

        int extracted = 0, abandoned = 0;
        foreach (var doc in candidates)
        {
            var jobId = Str(doc, "id");
            if (jobId is null) continue;

            var jobFacts = facts.GetValueOrDefault(jobId);
            if (jobFacts is not null) extracted++;
            else if (Attempts(doc) + 1 >= MaxExtractAttempts) abandoned++;

            await _pool.RecordExtractAttemptAsync(jobId, jobFacts, now, ct);
        }

        run.JobsExtractRetried = candidates.Count;
        run.JobsExtracted += extracted;
        run.JobsExtractAbandoned = abandoned;

        if (abandoned > 0)
            _log.LogWarning(
                "Pool run {RunId}: {Count} job(s) reached {Max} failed extraction attempts — kept in the "
                + "pool unextracted and never retried again (they appear with no facts to filter on)",
                run.Id, abandoned, MaxExtractAttempts);
    }

    /// <summary>
    /// Run a batched call over chunks, a couple at a time, and merge the maps.
    /// </summary>
    /// <remarks>
    /// Bounded concurrency so a big first run does not arrive at the API as one
    /// enormous burst — the same guardrail the scoring path has.
    /// </remarks>
    private static async Task<Dictionary<string, BsonDocument>> ChunkedAsync(
        IReadOnlyList<ScrapedJob> jobs, int chunkSize,
        Func<IReadOnlyList<ScrapedJob>, Task<Dictionary<string, BsonDocument>>> call)
    {
        var merged = new Dictionary<string, BsonDocument>();
        using var gate = new SemaphoreSlim(MaxConcurrentChunks);

        var chunks = jobs.Chunk(chunkSize).Select(async chunk =>
        {
            await gate.WaitAsync();
            try { return await call(chunk); }
            finally { gate.Release(); }
        });

        foreach (var result in await Task.WhenAll(chunks))
            foreach (var (key, value) in result)
                merged[key] = value;

        return merged;
    }

    private static string? Str(BsonDocument d, string name) =>
        d.TryGetValue(name, out var v) && v.IsString ? v.AsString : null;

    private static int Attempts(BsonDocument d) =>
        d.TryGetValue("extract_attempts", out var v) && v.IsNumeric ? v.ToInt32() : 0;
}
