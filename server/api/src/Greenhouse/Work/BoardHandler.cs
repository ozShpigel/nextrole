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
/// <param name="Prefiltered">New jobs the pre-read filter kept out: not embedded, read or stored.</param>
public sealed record CompanyResult(
    int Fetched, int Skipped, int Embedded, long Closed, int TokensBilled, int Prefiltered = 0)
{
    public BsonDocument ToCounts() => new()
    {
        { "fetched", Fetched },
        { "skipped", Skipped },
        { "embedded", Embedded },
        { "closed", Closed },
        { "tokensBilled", TokensBilled },
        { "prefiltered", Prefiltered },
    };
}

/// <summary>
/// One board, start to finish. The unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Source-agnostic.</b> Everything that knows how a board is fetched is
/// behind <see cref="IJobSource"/>; everything here -- the hash skip, the
/// pre-read filter, embedding, the reads, the close diff -- is the same for
/// every source, so a guard added here protects all of them at once.
/// </para>
/// <para>
/// <b>Self-contained, idempotent, and it throws on failure.</b> Nothing in this
/// file knows a queue exists -- no AMQP type, no delivery tag, no ack. The
/// transport calls this and interprets the outcome; that is the only direction
/// the dependency runs. Driving it from a test means calling the method.
/// </para>
/// <para>
/// Idempotent because every write is keyed: the upsert is on
/// (boardKey, sourceJobId) behind a unique index, and the content hash
/// means a second run embeds nothing and writes nothing. Running it twice in a
/// row is the acceptance test, and killing it half-way and restarting reaches
/// the same rows -- the per-batch write is what makes the partial state valid
/// rather than torn.
/// </para>
/// </remarks>
public sealed class BoardHandler
{
    private readonly Dictionary<string, IJobSource> _sources;
    private readonly IEmbeddingClient _embeddings;
    private readonly IngestAiClient? _ai;
    private readonly IngestBatcher? _batcher;
    private readonly IJobStore _store;
    private readonly BoardsConfig _config;
    private readonly ILogger<BoardHandler> _log;
    private readonly PrefilterMode _prefilter;
    private readonly IDemand? _demand;
    private readonly bool _parseAtIngest;

    /// <summary>
    /// How many open jobs make an empty board response suspicious.
    /// </summary>
    /// <remarks>
    /// Above this, an empty response skips the close diff entirely. Below it,
    /// the diff runs -- a board with a handful of jobs genuinely can empty, and
    /// never closing those would leave them retrievable forever.
    /// </remarks>
    public const int EmptyResponseGuardThreshold = 10;

    public BoardHandler(
        IEnumerable<IJobSource> sources, IEmbeddingClient embeddings, IJobStore store,
        BoardsConfig config, ILogger<BoardHandler> log, IngestAiClient? ai = null,
        IngestBatcher? batcher = null, PrefilterMode prefilter = PrefilterMode.Off,
        IDemand? demand = null, bool parseAtIngest = true)
    {
        // Greenhouse:ParseAtIngest. True here so a handler built without it
        // behaves as before; Program defaults the real one to false: the first
        // user to score a posting parses it, and the scan stores the parse for
        // everyone after (IPoolJobRepository.SaveParsesAsync).
        _parseAtIngest = parseAtIngest;
        // Greenhouse:Prefilter. Off here so a handler built without it behaves
        // exactly as before; Program defaults the real one to Log.
        _prefilter = prefilter;
        _demand = demand;
        // Set when Greenhouse:UseBatchApi is on: the same two reads go through
        // the Message Batches API at half the price and are collected later.
        // Null keeps the live path below, unchanged.
        _batcher = batcher;
        _sources = sources.ToDictionary(s => s.Name, StringComparer.Ordinal);
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

    /// <param name="liveReads">
    /// Read new postings with live calls even when the batch API is configured:
    /// a triggered run, with a user waiting (<see cref="CompanyMessage.Live"/>).
    /// </param>
    public async Task<CompanyResult> HandleBoardAsync(
        BoardConfig board, CancellationToken ct = default, bool liveReads = false)
    {
        ArgumentNullException.ThrowIfNull(board);
        // Config load refuses an unknown source, so a miss here is a build that
        // registered fewer sources than it validates -- a bug, and loud.
        var source = _sources.TryGetValue(board.Source, out var s)
            ? s
            : throw new InvalidOperationException(
                $"Board {board.Key}: no source named '{board.Source}' is registered.");

        var runId = Guid.NewGuid().ToString();
        var now = DateTime.UtcNow;

        // GUARD 1: never diff on a failed fetch.
        //
        // Every source throws on a failure it can see (Greenhouse: a non-2xx,
        // an unparseable body, a meta.total/job-count mismatch). Because it
        // throws, control never reaches the diff below -- the guard is
        // structural rather than a flag somebody has to remember to check. A
        // 429, a 500 and a truncated 5 MB response all leave this board's
        // stored jobs exactly as they were. What a source cannot prove whole,
        // it reports as Complete = false, and the diff is skipped below.
        var listing = await source.ListAsync(board, ct);

        var (postings, present) = ListedPostings(board, listing);

        var storedHashes = await _store.StoredHashesAsync(board.Key, ct);
        bool IsNew(string id) => !storedHashes.ContainsKey(id);

        // The pre-read filter, in two stages (docs/plans/two-stage-prefilter.md).
        // Only NEW postings are ever filtered: a stored one was already paid
        // for, and dropping it would stop its presence touch and leave it to
        // the close diff. A skipped posting is not stored, so it is neither
        // touched nor closed below -- and the next run sees it as new and asks
        // again. Skips apply only when Greenhouse:Prefilter is On; Log decides
        // and logs at both stages and skips nothing, not even a detail request.
        var rules = await PrefilterRulesAsync(board, ct);

        // Stage 1, on the listing's own data: what it skips costs no detail
        // request. A rule with nothing to go on passes -- no date is read, a
        // location that resolves to nothing is read.
        var listingSkips = Decide(rules, postings.Where(p => IsNew(p.SourceJobId)));
        var skippedAtListing = Applied(listingSkips);
        var toRead = skippedAtListing.Count > 0
            ? [.. postings.Where(p => !skippedAtListing.Contains(p.SourceJobId))]
            : postings;

        var jobs = await ReadDetailsAsync(board, source, toRead, ct);

        // Stage 2, the same rule on the detail's data: the exact date, the full
        // location list. Only what stage 1 KEPT -- so Log mode never decides,
        // or counts, one posting twice. For Greenhouse the detail is the
        // listing and this decides exactly what stage 1 did.
        var decidedAtListing = listingSkips.Select(x => x.Posting.SourceJobId).ToHashSet(StringComparer.Ordinal);
        var detailSkips = Decide(rules, jobs
            .Where(j => IsNew(j.SourceJobId) && !decidedAtListing.Contains(j.SourceJobId))
            .Select(j => j.Source.Listed));
        var skippedAtDetail = Applied(detailSkips);
        if (skippedAtDetail.Count > 0)
            jobs = [.. jobs.Where(j => !skippedAtDetail.Contains(j.SourceJobId))];

        var prefiltered = skippedAtListing.Count + skippedAtDetail.Count;
        await ReportPrefilterAsync(board, rules, postings, storedHashes, listingSkips, detailSkips, ct);

        var changed = new List<GreenhouseJob>();
        var unchanged = new List<string>();

        foreach (var job in jobs)
        {
            // The skip. An unchanged hash costs neither an embedding nor a
            // content write -- only the presence touch below.
            if (storedHashes.TryGetValue(job.SourceJobId, out var stored)
                && stored == job.ContentHash
                && stored.Length > 0)
                unchanged.Add(job.SourceJobId);
            else
                changed.Add(job);
        }

        _log.LogInformation(
            "Board {Board}: {Total} job(s) -- {Changed} to embed, {Unchanged} unchanged, {Prefiltered} prefiltered",
            board.Token, postings.Count, changed.Count, unchanged.Count, prefiltered);

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
                    $"Batch {i + 1} of board '{board.Token}': {result.Vectors.Count} vectors "
                    + $"for {batch.Count} jobs. Refusing to write a misaligned batch.");

            var paired = batch.Zip(result.Vectors, (job, vector) => (Job: job, Vector: vector)).ToList();

            // WRITTEN PER BATCH, not at the end. If batch 5 of 8 throws, the
            // first four are durable and their embeddings are already paid for.
            await _store.UpsertBatchAsync(paired, runId, now, ct);

            embedded += batch.Count;
            tokens += result.TotalTokens;

            _log.LogInformation(
                "Board {Board}: batch {N}/{Total} -- {Count} job(s), {Tokens} tokens billed",
                board.Token, i + 1, batches.Count, batch.Count, result.TotalTokens);
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
        if (_batcher is not null && !(liveReads && _ai is not null))
        {
            await SubmitBatchedReadsAsync(board, changed, now, ct);
        }
        else if (_ai is not null && changed.Count > 0)
        {
            await RunIngestAiAsync(board, ToIngestJobs(changed), now, ct);
        }

        // ...and then the ones the hash skip can never reach: postings stored
        // before this ran at all. A run with no Api:BaseUrl, or with the API
        // down, leaves facts and parse missing, and an unchanged hash means
        // nothing ever looks at them again. Without this sweep the only repair
        // is the company editing their own posting text.
        if (_ai is not null && _batcher is null)
        {
            await BackfillIngestAiAsync(board, now, ct);
            await ReReadFactsAsync(board, now, ct);
        }

        // Presence for the ones we skipped. Also clears closedAt, so a job that
        // closed and came back unchanged reopens without being re-embedded.
        await _store.TouchAsync(board.Key, unchanged, runId, now, ct);

        await StampLogoAsync(board, ct);

        // The diff is driven by the LISTING, never by what was read in full: a
        // posting whose detail failed is still on the board, and must not be
        // closed for our failure to read it.
        //
        // GUARD 2 is inside CloseMissingAsync: an empty response against a large
        // stored count logs and skips the diff rather than closing the board.
        long closed = 0;
        if (listing.Complete)
            closed = await _store.CloseMissingAsync(
                board.Key, [.. present], EmptyResponseGuardThreshold, now, ct);
        else
            _log.LogWarning(
                "Board {Board}: the {Source} listing could not be proven complete ({Listed} listed, board total {Total}); "
                + "closing nothing this run",
                board.Token, source.Name, listing.Postings.Count, listing.Total?.ToString() ?? "not given");

        return new CompanyResult(present.Count, unchanged.Count, embedded, closed, tokens, prefiltered);
    }

    /// <summary>
    /// The listing's postings this run works on, and every listed id.
    /// </summary>
    /// <returns>
    /// The postings, one per id, and every listed id -- the second is what the
    /// close diff sees, so a posting skipped or unread this run stays open.
    /// </returns>
    /// <remarks>
    /// The board's own id is stored as it is, whatever its shape. Only a blank
    /// one is dropped, with a warning: it cannot be keyed, as the board client
    /// already drops a Greenhouse job with no id. Two postings with one id in a
    /// response cannot both be upserted -- an unordered bulk write of two
    /// upserts on one unique key races itself -- so the last one wins, here,
    /// deterministically.
    /// </remarks>
    private (List<ListedPosting> Postings, List<string> Present) ListedPostings(BoardConfig board, Listing listing)
    {
        var byId = new Dictionary<string, ListedPosting>(StringComparer.Ordinal);
        var order = new List<string>();
        var badIds = 0;

        foreach (var posting in listing.Postings)
        {
            if (string.IsNullOrWhiteSpace(posting.SourceJobId))
            {
                badIds++;
                continue;
            }
            if (!byId.ContainsKey(posting.SourceJobId)) order.Add(posting.SourceJobId);
            byId[posting.SourceJobId] = posting;
        }

        if (badIds > 0)
            _log.LogWarning("Board {Board}: dropped {Count} posting(s) with no id", board.Token, badIds);

        return ([.. order.Select(id => byId[id])], order);
    }

    /// <summary>The postings read in full, ready to hash, embed and store.</summary>
    /// <remarks>
    /// A posting whose detail could not be read is skipped this run and retried
    /// next run; it is still in the listing, so the close diff leaves it open.
    /// Sequential: detail requests arrive with the first source that needs
    /// them, and so does their concurrency and politeness (docs/plans/multi-source-ingest.md).
    /// </remarks>
    private async Task<List<GreenhouseJob>> ReadDetailsAsync(
        BoardConfig board, IJobSource source, IReadOnlyList<ListedPosting> postings, CancellationToken ct)
    {
        var jobs = new List<GreenhouseJob>(postings.Count);
        var unread = 0;

        foreach (var posting in postings)
        {
            var detail = posting.Detail ?? await source.DetailAsync(board, posting, ct);
            if (detail is null)
            {
                unread++;
                continue;
            }
            jobs.Add(GreenhouseJob.From(source.Name, board.Token, detail));
        }

        if (unread > 0)
            _log.LogWarning(
                "Board {Board}: {Count} posting(s) could not be read in full; skipped this run and left open",
                board.Token, unread);

        return jobs;
    }

    /// <summary>How many example titles a prefilter log line carries.</summary>
    private const int PrefilterExamples = 8;

    /// <summary>What the filter decides with, read once per board run for both stages.</summary>
    private sealed record PrefilterRules(
        ServedPlaces Served, IReadOnlyCollection<string>? Accepted, IReadOnlyList<string> Wanted, int Learned);

    private sealed record PrefilterDecision(ListedPosting Posting, PrefilterSkip Skip);

    /// <summary>The rules for this run, or null when the filter is off or could not decide.</summary>
    /// <remarks>
    /// Never throws: a filter that cannot decide reads everything, which is
    /// where it started.
    /// </remarks>
    private async Task<PrefilterRules?> PrefilterRulesAsync(BoardConfig board, CancellationToken ct)
    {
        if (_prefilter == PrefilterMode.Off) return null;

        try
        {
            IReadOnlyList<string> wanted = _demand is null ? [] : await _demand.WantedFunctionsAsync(ct);
            IReadOnlyList<string> learned = _demand is null ? [] : await _demand.WantedLocationsAsync(ct);
            // The configured locations plus every user's own: a user in a new
            // city is served from the next run, with no edit to boards.json.
            var served = _config.ServedLocations.Count == 0
                ? ServedPlaces.None   // no configured list = no location filtering; learned terms must not switch it on
                : ServedPlaces.From(_config.ServedLocations.Concat(learned));
            // No recorded demand constrains nothing: reading everything is the
            // state before this filter existed, never a worse one.
            var accepted = wanted.Count > 0 ? Prefilter.Accepted(wanted) : null;
            return new PrefilterRules(served, accepted, wanted, learned.Count);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogError(e, "Board {Board}: the pre-read filter failed; reading every posting", board.Token);
            return null;
        }
    }

    /// <summary>The postings this rule would skip, with why. Empty with no rules.</summary>
    private static List<PrefilterDecision> Decide(PrefilterRules? rules, IEnumerable<ListedPosting> fresh) =>
        rules is null
            ? []
            : [.. fresh
                .Select(p => (Posting: p, Skip: Prefilter.Decide(p, rules.Served, rules.Accepted)))
                .Where(x => x.Skip is not null)
                .Select(x => new PrefilterDecision(x.Posting, x.Skip!))];

    /// <summary>The ids actually skipped -- always empty unless the mode is On.</summary>
    private HashSet<string> Applied(List<PrefilterDecision> decisions) =>
        _prefilter == PrefilterMode.On
            ? decisions.Select(d => d.Posting.SourceJobId).ToHashSet(StringComparer.Ordinal)
            : [];

    /// <summary>
    /// One log line for both stages, then the checks of the rule against the
    /// labels Claude already put on stored postings.
    /// </summary>
    /// <remarks>Never throws: the checks are measurement, not part of the run.</remarks>
    private async Task ReportPrefilterAsync(
        BoardConfig board, PrefilterRules? rules, IReadOnlyList<ListedPosting> postings,
        IReadOnlyDictionary<string, string> stored, List<PrefilterDecision> atListing,
        List<PrefilterDecision> atDetail, CancellationToken ct)
    {
        if (rules is null) return;

        try
        {
            var fresh = postings.Count(p => !stored.ContainsKey(p.SourceJobId));
            List<PrefilterDecision> skips = [.. atListing, .. atDetail];

            if (fresh > 0)
                _log.LogInformation(
                    "Board {Board}: pre-read filter ({Mode}) -- {Skipped} of {New} new posting(s) {Verb} "
                    + "({AtListing} from the listing, {AtDetail} after the detail): "
                    + "{ByAge} older than {MaxAge} days, "
                    + "{ByLocation} outside served locations ({Configured} configured + {Learned} from profiles), "
                    + "{ByFunction} a function nobody wants (wanted: {Wanted}). E.g. {Examples}",
                    board.Token, _prefilter, skips.Count, fresh,
                    _prefilter == PrefilterMode.On ? "skipped" : "would be skipped",
                    atListing.Count, atDetail.Count,
                    skips.Count(x => x.Skip.Reason == PrefilterSkip.Age), PoolBrowseQuery.MaxAgeDays,
                    skips.Count(x => x.Skip.Reason == PrefilterSkip.Location),
                    _config.ServedLocations.Count, rules.Learned,
                    skips.Count(x => x.Skip.Reason == PrefilterSkip.Function),
                    rules.Wanted.Count > 0 ? string.Join(", ", rules.Wanted) : "none recorded, so no function filtering",
                    string.Join(" | ", skips.Take(PrefilterExamples)
                        .Select(x => $"{x.Posting.Title} [{x.Skip.Reason}: {x.Skip.Detail}]")));

            await CheckGuessesAsync(board, postings, stored, rules.Accepted, rules.Served, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogError(e, "Board {Board}: the pre-read filter checks failed", board.Token);
        }
    }

    /// <summary>
    /// The location rule's measurement: of the stored postings it would skip,
    /// how many Claude placed somewhere served when it read the whole posting.
    /// </summary>
    /// <remarks>
    /// "Would hide" is a skip whose extracted location names a served term or a
    /// served country. That has to read ~0 before the filter acts, exactly like
    /// the function check.
    /// </remarks>
    private void CheckLocations(
        BoardConfig board, IReadOnlyList<ListedPosting> storedJobs,
        IReadOnlyDictionary<string, StoredFacts> facts, ServedPlaces served)
    {
        if (served.IsEmpty) return;

        var skipped = storedJobs
            .Select(j => (Job: j, Elsewhere: Prefilter.LocationSkip(
                new[] { j.Location }.Concat(j.Offices), served)))
            .Where(x => x.Elsewhere is not null)
            .ToList();

        var labelled = skipped
            .Select(x => (x.Job, Claude: facts.GetValueOrDefault(x.Job.SourceJobId)?.Location))
            .Where(x => !string.IsNullOrWhiteSpace(x.Claude))
            .ToList();
        var wouldHide = labelled
            .Where(x => Prefilter.InServedLocation([x.Claude], served))
            .ToList();

        _log.LogInformation(
            "Board {Board}: pre-read filter location check -- {Skipped} of {Stored} stored posting(s) "
            + "resolve to countries nobody is in, {Labelled} with a location from Claude, {WouldHide} of "
            + "those placed somewhere served (would hide). Would hide: {Examples}",
            board.Token, skipped.Count, storedJobs.Count, labelled.Count, wouldHide.Count,
            string.Join(" | ", wouldHide.Take(PrefilterExamples).Select(x =>
                $"{x.Job.Title} [board: {x.Job.Location}, Claude: {x.Claude}]")));
    }

    /// <summary>
    /// The measurement that has to come before the filter acts: the title and
    /// department guess, against the functions Claude read from the whole
    /// posting, on postings already stored.
    /// </summary>
    /// <remarks>
    /// "Wrong" is a guess the stored label does not contain. "Would hide" is
    /// the part of that which matters: a wrong guess that would have skipped a
    /// posting some user's filter shows. That number has to be read as ~0
    /// before Greenhouse:Prefilter goes to On.
    /// </remarks>
    private async Task CheckGuessesAsync(
        BoardConfig board, IReadOnlyList<ListedPosting> jobs, IReadOnlyDictionary<string, string> stored,
        IReadOnlyCollection<string>? accepted, ServedPlaces served, CancellationToken ct)
    {
        var storedJobs = jobs.Where(j => stored.ContainsKey(j.SourceJobId)).ToList();
        if (storedJobs.Count == 0) return;

        var facts = await _store.StoredFactsAsync(
            board.Key, [.. storedJobs.Select(j => j.SourceJobId)], ct);

        CheckLocations(board, storedJobs, facts, served);

        var guessed = storedJobs
            .Select(j => (Job: j, Guess: Prefilter.GuessFunction(
                j.Title, j.Departments)))
            .Where(x => x.Guess is not null)
            .ToList();
        if (guessed.Count == 0) return;

        string[] LabelOf(ListedPosting j) => facts.GetValueOrDefault(j.SourceJobId)?.Functions ?? [];

        var labelled = guessed.Where(x => LabelOf(x.Job).Length > 0).ToList();
        var wrong = labelled.Where(x => !LabelOf(x.Job).Contains(x.Guess!)).ToList();
        var wouldHide = accepted is null
            ? null
            : (int?)wrong.Count(x => !accepted.Contains(x.Guess!)
                                     && JobFunctions.Matches(LabelOf(x.Job), [.. accepted]));

        _log.LogInformation(
            "Board {Board}: pre-read filter check -- {Guessed} stored posting(s) guessed from title/department, "
            + "{Labelled} labelled by Claude: {Right} right, {Wrong} wrong, {WouldHide} wrong in a way that "
            + "would hide a wanted posting. Wrong: {Examples}",
            board.Token, guessed.Count, labelled.Count, labelled.Count - wrong.Count, wrong.Count,
            wouldHide?.ToString() ?? "n/a (no demand recorded)",
            string.Join(" | ", wrong.Take(PrefilterExamples).Select(x =>
                $"{x.Job.Title} [guessed {x.Guess}, labelled {string.Join("+", LabelOf(x.Job))}]")));
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

    // The board's own job id is the correlation key: the string the endpoints
    // take is the stored sourceJobId, so results map back with no conversion.
    private static List<IngestJob> ToIngestJobs(IReadOnlyList<GreenhouseJob> jobs) =>
        [.. jobs.Select(j => new IngestJob(
            j.SourceJobId,
            j.Source.Listed.Title ?? "",
            j.Source.Company,
            j.Source.Listed.Location,
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
        BoardConfig board, IReadOnlyList<GreenhouseJob> changed, DateTime now, CancellationToken ct)
    {
        try
        {
            var both = ToIngestJobs(changed);
            var seen = both.Select(j => j.JobId).ToHashSet();

            var backlog = await _store.NeedingIngestAiAsync(board.Key, BackfillBatchSize, ct);
            both.AddRange(backlog.Where(p => seen.Add(p.SourceJobId)).Select(ToIngestJob));

            var reread = await _store.NeedingFactsReReadAsync(board.Key, BackfillBatchSize, ct);
            var factsOnly = reread.Where(p => seen.Add(p.SourceJobId)).Select(ToIngestJob).ToList();

            var facts = await _batcher!.SubmitAsync(board.Key, AiBatchRecord.Facts, [.. both, .. factsOnly], now, ct);
            // No parse batch with ParseAtIngest off -- and so no parse marker,
            // so the posting is visible as soon as its facts land.
            var parses = _parseAtIngest
                ? await _batcher.SubmitAsync(board.Key, AiBatchRecord.Parse, both, now, ct)
                : 0;

            if (facts + parses > 0)
                _log.LogInformation(
                    "Board {Board}: submitted {Facts} facts read(s) and {Parses} parse(s) as batches "
                    + "({Changed} changed, {Backlog} never read, {ReRead} re-read)",
                    board.Token, facts, parses, changed.Count, backlog.Count, factsOnly.Count);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogError(e, "Board {Board}: could not submit the batched reads; they are owed again next run", board.Token);
        }
    }

    private static IngestJob ToIngestJob(StoredJobContent p) =>
        new(p.SourceJobId, p.Title, p.Company, p.Location, p.Content);

    /// <summary>
    /// Run the ingest AI reads over postings that have never had them.
    /// </summary>
    /// <remarks>
    /// Reads the stored content rather than the board response, so it repairs a
    /// posting whose text has not changed since it was stored. Deliberately
    /// does NOT re-embed: the vectors are valid and already paid for, and only
    /// the reads are missing.
    /// </remarks>
    private async Task BackfillIngestAiAsync(BoardConfig board, DateTime now, CancellationToken ct)
    {
        List<IngestJob> aiJobs;
        try
        {
            var pending = await _store.NeedingIngestAiAsync(board.Key, BackfillBatchSize, ct);
            if (pending.Count == 0) return;

            _log.LogInformation(
                "Board {Board}: {Count} stored posting(s) have never had the ingest AI reads; backfilling",
                board.Token, pending.Count);

            aiJobs = [.. pending.Select(p => new IngestJob(
                p.SourceJobId, p.Title, p.Company, p.Location, p.Content))];
        }
        catch (Exception e)
        {
            // Selecting the backlog is not worth failing a company over: the
            // board has already been fetched, embedded and written.
            _log.LogError(e, "Board {Board}: could not select postings needing the ingest AI reads", board.Token);
            return;
        }

        await RunIngestAiAsync(board, aiJobs, now, ct);
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
    private async Task ReReadFactsAsync(BoardConfig board, DateTime now, CancellationToken ct)
    {
        try
        {
            var pending = await _store.NeedingFactsReReadAsync(board.Key, BackfillBatchSize, ct);
            if (pending.Count == 0) return;

            _log.LogInformation(
                "Board {Board}: {Count} stored posting(s) have facts from before requirement groups; re-reading the facts",
                board.Token, pending.Count);

            List<IngestJob> jobs = [.. pending.Select(p => new IngestJob(
                p.SourceJobId, p.Title, p.Company, p.Location, p.Content))];

            var facts = await ChunkedAsync(jobs, IngestAiClient.FactsChunkSize,
                chunk => _ai!.ExtractFactsAsync(chunk, ct));

            var saved = await _store.SaveIngestAiAsync(
                board.Key, facts, new Dictionary<string, BsonDocument>(), null, now, ct);

            _log.LogInformation(
                "Board {Board}: re-read {Facts} fact read(s) over {Rows} row(s)",
                board.Token, facts.Count, saved);
        }
        catch (Exception e)
        {
            _log.LogError(e, "Board {Board}: the facts re-read failed; the old facts stay in place", board.Token);
        }
    }

    private async Task RunIngestAiAsync(
        BoardConfig board, IReadOnlyList<IngestJob> aiJobs, DateTime now, CancellationToken ct)
    {
        if (aiJobs.Count == 0) return;

        try
        {
            var facts = await ChunkedAsync(aiJobs, IngestAiClient.FactsChunkSize,
                chunk => _ai!.ExtractFactsAsync(chunk, ct));

            // The parse is ~2/3 of a posting's read cost and only the
            // Evaluator uses it -- so with ParseAtIngest off it is left to the
            // first user who scores the posting, and never paid for the ones
            // nobody scores.
            string? parseVersion = null;
            var parsed = !_parseAtIngest
                ? new Dictionary<string, BsonDocument>()
                : await ChunkedAsync(aiJobs, IngestAiClient.ParseChunkSize, async chunk =>
                {
                    var (result, version) = await _ai!.ParseAsync(chunk, ct);
                    if (version is not null) parseVersion = version;
                    return result;
                });

            var saved = await _store.SaveIngestAiAsync(
                board.Key, facts, parsed, parseVersion, now, ct);

            _log.LogInformation(
                "Board {Board}: stored {Facts} fact read(s) and {Parsed} parse(s) over {Rows} row(s)",
                board.Token, facts.Count, parsed.Count, saved);
        }
        catch (Exception e)
        {
            _log.LogError(e,
                "Board {Board}: the ingest AI passes failed; jobs are stored without facts or a parse "
                + "and the per-user scan will parse them inline", board.Token);
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
    private async Task StampLogoAsync(BoardConfig board, CancellationToken ct)
    {
        var logo = _config.LogoUrlFor(board);
        try
        {
            var stamped = await _store.StampCompanyLogoAsync(board.Key, logo, ct);
            if (stamped > 0)
                _log.LogInformation("Board {Board}: set the company logo on {Count} row(s)", board.Token, stamped);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogError(e, "Board {Board}: could not set the company logo", board.Token);
        }
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
