using ApplicationTracker.PoolIngest;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

// The shared job pool's daily ingest. One-shot: it runs, it exits, and the exit
// code is what the systemd timer sees — the mailbot's pattern, not a service.
//
// Nothing listens on a port. Nothing here reads a profile or scores anything:
// the pool is common to every user (docs/job-pool.md), and scoring is per user
// and on demand in the API.

var configuration = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json", optional: true)
    .AddEnvironmentVariables()
    .Build();

using var loggerFactory = LoggerFactory.Create(b => b
    .AddConfiguration(configuration.GetSection("Logging"))
    .AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "HH:mm:ss "; })
    .SetMinimumLevel(LogLevel.Information));

var log = loggerFactory.CreateLogger("PoolIngest");

try
{
    var mongoUri = Require(configuration, "MongoDB:ConnectionString");
    var databaseName = configuration["MongoDB:Database"] ?? "job-tracker";
    var apiBaseUrl = Require(configuration, "Api:BaseUrl");
    var scraperBaseUrl = Require(configuration, "Scraper:BaseUrl");
    var rolesPath = configuration["Roles:ConfigPath"] ?? "config/roles.json";

    var settings = MongoClientSettings.FromConnectionString(mongoUri);
    var database = new MongoClient(settings).GetDatabase(databaseName);
    var jobs = database.GetCollection<BsonDocument>("discovered_jobs");
    var runs = database.GetCollection<BsonDocument>("discovery_runs");
    var poolRoles = database.GetCollection<BsonDocument>("pool_roles");

    var rolesConfig = RolesConfig.Load(rolesPath, log);

    // A scrape of a dozen roles paces 8-20s between searches and runs for
    // MINUTES. HttpClient's default timeout is 100 seconds, which would abort
    // every run part-way through and surface as a TaskCanceledException that
    // reads like the scraper being down — while the scraper carried on
    // scraping, so the two services' logs would not even agree.
    //
    // No proxy is in this path: PoolIngest reaches the scraper by Docker DNS,
    // container to container, so this timeout is the only limit that applies.
    var scrapeHttp = new HttpClient
    {
        BaseAddress = new Uri(scraperBaseUrl),
        Timeout = TimeSpan.FromMinutes(30),
    };

    // The AI calls are batched and Claude-backed; the Python client used 180s
    // for facts and 240s for parse. One ceiling above both, since a chunk that
    // times out is retried on a later run rather than here.
    var apiHttp = new HttpClient
    {
        BaseAddress = new Uri(apiBaseUrl),
        Timeout = TimeSpan.FromMinutes(10),
    };
    // A shared-secret gate that selects no user, and a source tag for billing.
    // Deliberately NO session token: every call this process makes is
    // user-independent, so it acts as nobody. Presenting an identity it does
    // not need is how the mailbot ended up writing into a minted account.
    if (configuration["Api:ApiKey"] is { Length: > 0 } apiKey)
        apiHttp.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
    apiHttp.DefaultRequestHeaders.Add("X-Source", "ingest");

    var runner = new IngestRunner(
        rolesConfig,
        new EffectiveRoles(poolRoles, loggerFactory.CreateLogger<EffectiveRoles>()),
        new ScrapeClient(scrapeHttp, loggerFactory.CreateLogger<ScrapeClient>()),
        new IngestAiClient(apiHttp, loggerFactory.CreateLogger<IngestAiClient>()),
        new PoolWriter(jobs, loggerFactory.CreateLogger<PoolWriter>()),
        runs,
        loggerFactory.CreateLogger<IngestRunner>());

    using var cancellation = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) => { e.Cancel = true; cancellation.Cancel(); };

    var run = await runner.RunAsync(cancellation.Token);

    // Exit non-zero on a failed run so a cron failure is visible instead of a
    // green tick over a run that ingested nothing.
    return run.Status == "completed" ? 0 : 1;
}
catch (Exception e)
{
    // Configuration and connection failures land here, before there is a run
    // record to mark failed. Still non-zero, for the same reason.
    log.LogCritical(e, "Pool ingest could not start");
    return 1;
}

static string Require(IConfiguration configuration, string key) =>
    configuration[key] is { Length: > 0 } value
        ? value
        : throw new InvalidOperationException(
            $"{key} is not configured. Set it in .env.pool-ingest — this process cannot guess it, "
            + "and a default would point the daily ingest at the wrong place silently.");
