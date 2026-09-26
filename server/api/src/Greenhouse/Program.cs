using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Greenhouse;
using ApplicationTracker.Infrastructure.Greenhouse;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;
using System.Runtime.InteropServices;
using RabbitMQ.Client;

// The Greenhouse source. Two entry points, one image:
//
//   publish   one-shot, run by deploy/systemd/nextrole-greenhouse.timer.
//             Fans one message out per board token and exits.
//   consume   long-running. Takes one company at a time, acks after the write.
//
// This is a SECOND, INDEPENDENT source. It does not read or write
// discovered_jobs, it has no age-out, it scores nothing and it does no per-user
// work. The pool and its daily ingest are untouched by everything here.

var mode = args.FirstOrDefault()?.ToLowerInvariant();

var configuration = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json", optional: true)
    .AddEnvironmentVariables()
    .AddCommandLine(args)
    .Build();

using var loggerFactory = LoggerFactory.Create(b => b
    .AddConfiguration(configuration.GetSection("Logging"))
    .AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "HH:mm:ss "; })
    .SetMinimumLevel(LogLevel.Information));

var log = loggerFactory.CreateLogger("Greenhouse");

if (mode is not ("publish" or "consume"))
{
    log.LogCritical(
        "Usage: ApplicationTracker.Greenhouse <publish|consume>. Got {Mode}. "
        + "There is no default: 'publish' fans out a day's work and 'consume' does it, "
        + "and guessing wrong is either a day with no ingest or a second fan-out.",
        mode ?? "nothing");
    return 2;
}

try
{
    var mongoUri = Require(configuration, "MongoDB:ConnectionString");
    var databaseName = configuration["MongoDB:Database"] ?? "job-tracker";
    var rabbitUri = Require(configuration, "Rabbit:Uri");
    var companiesPath = configuration["Companies:ConfigPath"] ?? "config/companies.json";

    // Model and dimensions are shared configuration, bound identically by the
    // API (GreenhouseEmbeddingOptions). They are NOT in companies.json, which
    // the API cannot read -- see that file's _limits_comment.
    var embedding = configuration.GetSection(GreenhouseEmbeddingOptions.SectionName)
        .Get<GreenhouseEmbeddingOptions>() ?? new GreenhouseEmbeddingOptions();
    // Validated in the `consume` branch only. Publishing writes ledger rows and
    // messages and embeds nothing, so demanding a billed API key to fan out a
    // day's work would fail the daily timer over a credential it never uses.

    var companies = CompaniesConfig.Load(companiesPath);

    var database = new MongoClient(MongoClientSettings.FromConnectionString(mongoUri))
        .GetDatabase(databaseName);

    var jobs = database.GetCollection<BsonDocument>(GreenhouseJobFields.Collection);
    var runs = database.GetCollection<BsonDocument>(GreenhouseJobFields.RunsCollection);

    var ledger = new RunLedger(runs, loggerFactory.CreateLogger<RunLedger>());

    // NOT `using`. ProcessExit fires while the process is tearing down, which
    // is AFTER a `using` at this scope has already disposed the source -- so
    // Cancel() threw ObjectDisposedException and a SUCCESSFUL publish exited
    // non-zero. systemd would have reported a failed job every day while the
    // run itself was fine. Leaking a CancellationTokenSource at process exit
    // costs nothing; misreporting the exit code costs the whole signal.
    var cancellation = new CancellationTokenSource();

    void RequestShutdown()
    {
        try
        {
            if (!cancellation.IsCancellationRequested) cancellation.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // Already torn down. Nothing left to cancel, and throwing here
            // would replace a real exit code with this.
        }
    }

    Console.CancelKeyPress += (_, e) => { e.Cancel = true; RequestShutdown(); };

    // SIGTERM is how Docker stops the long-running consumer, and how a deploy
    // recreates it.
    //
    // ProcessExit is NOT enough and was measured not to be: the container
    // exited 143 (128+SIGTERM) with the shutdown line never printed, because
    // ProcessExit runs too late when the main thread is parked in Task.Delay,
    // and it has a short budget before the runtime tears down regardless.
    // Setting Cancel = true here claims the signal, so the app unwinds its own
    // way and exits 0 -- the difference between a consumer that was stopped and
    // one that was killed, which is otherwise indistinguishable to whoever
    // reads the exit code.
    //
    // Nothing is lost either way: an in-flight company is never acked, so the
    // broker redelivers it and the hash skip makes the redo nearly free. This
    // buys a clean exit code and a log line that says what happened.
    using var sigterm = PosixSignalRegistration.Create(PosixSignal.SIGTERM, context =>
    {
        context.Cancel = true;
        RequestShutdown();
    });

    var ct = cancellation.Token;

    var factory = new ConnectionFactory
    {
        Uri = new Uri(rabbitUri),
        // The consumer is long-running against a broker that may restart under
        // it. Without this it would exit on the first blip and rely on Docker
        // to bring it back, losing whatever it was mid-way through.
        AutomaticRecoveryEnabled = true,
        TopologyRecoveryEnabled = true,
    };

    await using var connection = await factory.CreateConnectionAsync("greenhouse", ct);

    await ledger.EnsureIndexesAsync(ct);

    if (mode == "publish")
    {
        var runId = Guid.NewGuid().ToString();

        var publisher = new CompanyPublisher(
            connection, ledger, loggerFactory.CreateLogger<CompanyPublisher>());

        var published = await publisher.PublishAsync(companies.Companies, runId, ct);

        // Non-zero if any company could not be dispatched, so a cron failure is
        // visible rather than a green tick over a partial fan-out.
        return published == companies.Companies.Count ? 0 : 1;
    }

    // consume -- the only mode that embeds, and so the only one that needs a key.
    embedding.Validate();

    var store = new JobStore(jobs, loggerFactory.CreateLogger<JobStore>());
    await store.EnsureIndexesAsync(ct);

    var boardHttp = new HttpClient
    {
        BaseAddress = new Uri(configuration["Greenhouse:BoardBaseUrl"] ?? "https://boards-api.greenhouse.io/"),
        // Measured: the largest board tested (665 jobs, 5.1 MB with
        // content=true) arrives in under two seconds. Two minutes is room for a
        // slow link, not for a hung request -- a board that takes longer than
        // this is a failure, and a failure is what must happen, because the
        // alternative is the consumer parked on one company indefinitely.
        Timeout = TimeSpan.FromMinutes(2),
    };
    boardHttp.DefaultRequestHeaders.UserAgent.ParseAdd("nextrole-greenhouse/1.0");

    var voyageHttp = new HttpClient
    {
        BaseAddress = new Uri(embedding.BaseUrl),
        Timeout = TimeSpan.FromMinutes(5),
    };
    voyageHttp.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", embedding.ApiKey);

    // The API is where every Claude call lives (AGENTS.md). This process holds
    // no Anthropic key and presents NO session token: job-facts and job-parse
    // read no profile and score nothing, so it acts as nobody. Presenting an
    // identity it does not need is how the mailbot ended up writing into a
    // freshly minted account (#67).
    //
    // Optional: without Api:BaseUrl the ingest still runs and still embeds --
    // jobs are simply stored without facts or a parse, and the per-user scan
    // parses them inline. Degraded, not broken.
    IngestAiClient? ingestAi = null;
    if (configuration["Api:BaseUrl"] is { Length: > 0 } apiBaseUrl)
    {
        var apiHttp = new HttpClient
        {
            BaseAddress = new Uri(apiBaseUrl),
            // Batched Claude calls behind it. One ceiling above both passes,
            // since a chunk that times out is retried on a later run.
            Timeout = TimeSpan.FromMinutes(10),
        };
        if (configuration["Api:ApiKey"] is { Length: > 0 } apiKey)
            apiHttp.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
        apiHttp.DefaultRequestHeaders.Add("X-Source", "ingest");

        ingestAi = new IngestAiClient(apiHttp, loggerFactory.CreateLogger<IngestAiClient>());
    }
    else
    {
        log.LogWarning(
            "Api:BaseUrl is not set: jobs will be stored without extracted facts or a parse, "
            + "and every per-user scan will pay to parse them inline");
    }

    // The Message Batches path for the two reads (IngestBatcher): same answers,
    // half the price, collected minutes to hours later. The batcher exists
    // whenever the reads do, so the collector below always runs -- switching
    // Greenhouse:UseBatchApi off must not strand open batches, whose postings
    // stay hidden from the candidate search until they are collected. The flag
    // only decides whether NEW reads are submitted as batches.
    IngestBatcher? batcher = null;
    var useBatchApi = configuration.GetValue("Greenhouse:UseBatchApi", false);
    if (ingestAi is not null)
    {
        var batchStore = new AiBatchStore(database.GetCollection<BsonDocument>(GreenhouseJobFields.AiBatchesCollection));
        await batchStore.EnsureIndexesAsync(ct);
        batcher = new IngestBatcher(ingestAi, store, batchStore, loggerFactory.CreateLogger<IngestBatcher>());
        log.LogInformation("Ingest reads: {Mode}", useBatchApi
            ? "Message Batches (half price, collected every " + BatchCollectInterval.TotalMinutes + " min)"
            : "live calls");
    }

    // The pre-read filter (docs/greenhouse.md). Log by default: it reports what
    // it would skip, and checks its guesses against stored labels, but skips
    // nothing until that has been read and this is set to On. An unknown value
    // is fatal rather than guessed -- guessing On skips postings unmeasured.
    var prefilterSetting = configuration["Greenhouse:Prefilter"] ?? nameof(PrefilterMode.Log);
    if (!Enum.TryParse<PrefilterMode>(prefilterSetting, ignoreCase: true, out var prefilter)
        || !Enum.IsDefined(prefilter))
        throw new InvalidOperationException(
            $"Greenhouse:Prefilter is '{prefilterSetting}'. Expected off, log or on.");
    log.LogInformation("Pre-read filter: {Mode}, {Locations} served location(s)",
        prefilter, companies.ServedLocations.Count);

    // Off by default: the ingest reads facts only, and the first user to score
    // a posting parses it (stored for everyone after). Parsing at ingest is
    // batched at half price but paid for every posting read; on demand is
    // full price but paid only for postings someone scores -- cheaper while
    // fewer than about half of them ever are. Flip it on if that stops holding.
    var parseAtIngest = configuration.GetValue("Greenhouse:ParseAtIngest", false);
    log.LogInformation("Parse at ingest: {ParseAtIngest}", parseAtIngest ? "on" : "off (parsed by the first scorer)");

    var handler = new CompanyHandler(
        new BoardClient(boardHttp, loggerFactory.CreateLogger<BoardClient>()),
        new VoyageEmbeddingClient(voyageHttp, embedding, loggerFactory.CreateLogger<VoyageEmbeddingClient>()),
        store,
        companies,
        loggerFactory.CreateLogger<CompanyHandler>(),
        ingestAi,
        useBatchApi ? batcher : null,
        prefilter,
        PoolDemandReader.For(database),
        parseAtIngest);

    var consumer = new CompanyConsumer(
        connection, handler, ledger, loggerFactory.CreateLogger<CompanyConsumer>());

    var collector = batcher is null ? Task.CompletedTask : CollectForeverAsync(batcher, ct);

    // Runs requested by profile saves that brought a new function or location
    // (DemandTriggers). Every board, live reads, at most one per cooldown.
    var triggerPublisher = new CompanyPublisher(connection, ledger, loggerFactory.CreateLogger<CompanyPublisher>());
    var triggers = new DemandTriggers(
        database,
        (runId, token) => triggerPublisher.PublishAsync(companies.Companies, runId, token, live: true),
        prefilter,
        loggerFactory.CreateLogger<DemandTriggers>());
    var triggerLoop = TriggerForeverAsync(triggers, log, ct);

    await consumer.RunAsync(ct);
    await collector;
    await triggerLoop;
    return 0;
}
catch (Exception e)
{
    log.LogCritical(e, "Greenhouse {Mode} could not start", mode);
    return 1;
}

// Polls open batches until shutdown. Each pass is cheap when nothing is
// pending -- one Mongo query -- and a batch usually ends within the hour.
static async Task CollectForeverAsync(IngestBatcher batcher, CancellationToken ct)
{
    // Shutdown cancels mid-collect as readily as mid-delay. Either way it is a
    // stop, not a failure: letting it escape would turn a clean exit into a
    // non-zero one, the misreport the ProcessExit note above exists to avoid.
    try
    {
        while (!ct.IsCancellationRequested)
        {
            await batcher.CollectAsync(DateTime.UtcNow, ct);
            await Task.Delay(BatchCollectInterval, ct);
        }
    }
    catch (OperationCanceledException)
    {
    }
}

// Looks for ingest requests until shutdown. One pass is a heartbeat and two
// small queries. A failed pass is logged and retried next interval: a request
// left pending is picked up then, never lost.
static async Task TriggerForeverAsync(DemandTriggers triggers, ILogger log, CancellationToken ct)
{
    try
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await triggers.TickAsync(DateTime.UtcNow, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogError(e, "Ingest request pass failed; retrying in {Seconds}s",
                    DemandTriggers.PollInterval.TotalSeconds);
            }
            await Task.Delay(DemandTriggers.PollInterval, ct);
        }
    }
    catch (OperationCanceledException)
    {
    }
}

static string Require(IConfiguration configuration, string key) =>
    configuration[key] is { Length: > 0 } value
        ? value
        : throw new InvalidOperationException(
            $"{key} is not configured. Set it in .env.greenhouse -- this process cannot guess it, "
            + "and a default would point the ingest at the wrong place silently.");

partial class Program
{
    private static readonly TimeSpan BatchCollectInterval = TimeSpan.FromMinutes(5);
}
