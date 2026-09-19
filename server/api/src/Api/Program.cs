using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using System.Text.Json.Serialization;
using ApplicationTracker.Api;
using ApplicationTracker.Api.Endpoints;
using ApplicationTracker.Api.Identity;
using Microsoft.Extensions.Options;
using ApplicationTracker.Api.Extensions;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Infrastructure.Pdf;
using ApplicationTracker.Infrastructure.Repositories;
using MongoDB.Driver;
using Scalar.AspNetCore;
using QuestPDF.Infrastructure;

QuestPDF.Settings.License = LicenseType.Community;
ResumeFonts.Register();

var builder = WebApplication.CreateBuilder(args);

var envPath = Path.Combine(builder.Environment.ContentRootPath, ".env");
if (File.Exists(envPath))
{
    var envVars = new Dictionary<string, string?>();
    foreach (var line in File.ReadAllLines(envPath))
    {
        var trimmed = line.Trim();
        if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;
        var sep = trimmed.IndexOf('=');
        if (sep <= 0) continue;
        var key = trimmed[..sep].Replace("__", ":");
        envVars[key] = trimmed[(sep + 1)..];
    }
    builder.Configuration.AddInMemoryCollection(envVars);
}

builder.Services.AddMongoCollections(builder.Configuration);
builder.Services.AddApplicationServices(builder.Configuration);
// The Greenhouse source's READ side only -- ICandidateJobStore over
// $vectorSearch. Ingestion is a separate process; this registers nothing that
// writes. Absent entirely when no embedding key is configured, so an
// unconfigured deployment starts normally rather than failing per request.
builder.Services.AddGreenhouseRetrieval(builder.Configuration);

// JSON: accept enum values as strings
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

// OpenAPI
builder.Services.AddOpenApi();

// CORS — configurable origins via CorsOrigins (comma-separated).
// Defaults to restrictive (no origins) in production; set to "*" explicitly for dev.
var rawOrigins = builder.Configuration["CorsOrigins"] ?? "";
var corsOrigins = rawOrigins
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (corsOrigins.Length == 1 && corsOrigins[0] == "*")
            // A wildcard origin and credentials are mutually exclusive per the
            // CORS spec, so a "*" deploy cannot carry the uid cookie. Both the
            // dev proxy and the deployed nginx put the client and the API on one
            // origin, where CORS does not apply at all -- list real origins here
            // only if you genuinely serve them cross-origin.
            policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
        else if (corsOrigins.Length > 0)
            policy.WithOrigins(corsOrigins).AllowAnyMethod().AllowAnyHeader().AllowCredentials();
    });
});

// Rate limiting — protect the AI-scoring endpoint from unbounded usage
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("match", cfg =>
    {
        cfg.PermitLimit = 10;
        cfg.Window = TimeSpan.FromMinutes(1);
        cfg.QueueLimit = 0;
    });
    // Batched ingest-time scoring gets its own bucket, separate from the
    // interactive "match" bucket above — a discovery run scoring dozens of
    // jobs in batches of 5 must never starve the manual Score-a-Job page.
    // Sized to the scraper's own concurrency (Semaphore(2) over batches) —
    // a starting estimate, not yet measured against a real run.
    options.AddFixedWindowLimiter("discovery", cfg =>
    {
        cfg.PermitLimit = 20;
        cfg.Window = TimeSpan.FromMinutes(1);
        cfg.QueueLimit = 0;
    });
    // Mock interview is conversational — one call per turn (5–8 per session)
    // plus a debrief — so it needs more headroom than the scoring endpoint.
    options.AddFixedWindowLimiter("mock", cfg =>
    {
        cfg.PermitLimit = 40;
        cfg.Window = TimeSpan.FromMinutes(1);
        cfg.QueueLimit = 0;
    });
    // Interview Insights synthesis is a "regenerate" click, not a hot loop —
    // same order-of-magnitude cost as a single match call.
    options.AddFixedWindowLimiter("insights", cfg =>
    {
        cfg.PermitLimit = 10;
        cfg.Window = TimeSpan.FromMinutes(1);
        cfg.QueueLimit = 0;
    });
    // Generate Pack is a per-application "regenerate" click, same shape as insights —
    // plain cost control, no user-facing quota UI (single-user tool).
    options.AddFixedWindowLimiter("pack", cfg =>
    {
        cfg.PermitLimit = 10;
        cfg.Window = TimeSpan.FromMinutes(1);
        cfg.QueueLimit = 0;
    });
    // Translate-analysis is a per-application, one-shot "translate" click
    // (result is cached on the application document, never re-called once it
    // succeeds) — same cost shape as insights/pack.
    options.AddFixedWindowLimiter("translate", cfg =>
    {
        cfg.PermitLimit = 10;
        cfg.Window = TimeSpan.FromMinutes(1);
        cfg.QueueLimit = 0;
    });
    // Company summary and why-work-here are per-application "generate" clicks,
    // the same cost shape as insights/pack -- and the only two Claude-calling
    // endpoints that shipped with no bucket at all. Note this covers the HTTP
    // path only: EnrichOnInterviewingAsync calls the same Claude methods
    // in-process, where no limiter applies.
    options.AddFixedWindowLimiter("enrich", cfg =>
    {
        cfg.PermitLimit = 10;
        cfg.Window = TimeSpan.FromMinutes(1);
        cfg.QueueLimit = 0;
    });
    options.RejectionStatusCode = 429;
});

var app = builder.Build();

var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
startupLogger.LogInformation("=== ApplicationTracker starting ===");
startupLogger.LogInformation("Environment: {Env}", app.Environment.EnvironmentName);
startupLogger.LogInformation("MongoDB connected: {Connected}",
    builder.Configuration["MongoDB:ConnectionString"] is not null);
startupLogger.LogInformation("URLs: {Urls}", builder.WebHost.GetSetting("urls") ?? "default");

// Migration is fatal, indexes are best-effort, and the order matters: the
// per-user unique indexes cannot build while pre-multi-user documents still
// have no UserId. An API that could not migrate must not serve requests -- it
// would answer with a view of the database that does not match what is in it --
// so MigrateOrThrowAsync retries a few connection failures and then brings the
// process down for the orchestrator to restart.
var identity = app.Services.GetRequiredService<ApplicationTracker.Api.Identity.IdentityResolver>();
startupLogger.LogInformation(
    "Identity mode: {Mode} (legacy documents are owned by {UserId})",
    identity.Mode, identity.LegacyOwnerUserId);

await UserScopeMigrationInitializer.MigrateOrThrowAsync(
    app.Services.GetRequiredService<IMongoClient>(),
    builder.Configuration["MongoDB:DatabaseName"] ?? "job-tracker",
    builder.Configuration["MongoDB:ProfileDatabase"] ?? builder.Configuration["MongoDB:Database"] ?? "jobmatch",
    identity.LegacyOwnerUserId,
    startupLogger);

// FATAL, unlike the index block below. Every index down there is deduplication:
// lose one and you get duplicate rows and a cleanup job. This one is half of a
// security guard. GoogleIdentityRepository.TryLinkAsync arbitrates the
// first-sign-in race by catching a duplicate-key rejection, and _id uniqueness
// only covers one side of it — without uniq_googlesub, two concurrent sign-ins
// with the SAME Google account link it to two different userIds, and which
// account that person lands in afterwards is arbitrary. An API that cannot
// enforce that must not serve requests, because the failure is silent and the
// damage is to who owns what.
// Fatal: a half-configured claim is a configuration mistake, and the dangerous
// half (ClaimUserId with no ClaimEmail) would arm an account takeover for
// whoever signs in first. Same posture as IdentityResolver refusing a Fixed
// instance with no FixedUserId.
app.Services.GetRequiredService<IOptions<GoogleAuthOptions>>().Value.Validate();

await new GoogleIdentityRepository(
    app.Services.GetRequiredService<IMongoCollection<GoogleIdentity>>())
    .EnsureIndexesAsync();

// Also fatal. The TTL is only cleanup — expiry is enforced in the query — but
// idx_userid is what sign-out-everywhere and the merge repoint rely on, and an
// unindexed collection scan over sessions on every merge is not something to
// discover in production.
await new UserSessionRepository(
    app.Services.GetRequiredService<IMongoCollection<UserSession>>())
    .EnsureIndexesAsync();

try
{
    await ApplicationIndexInitializer.EnsureIndexesAsync(
        app.Services.GetRequiredService<IMongoCollection<Application>>(),
        app.Services.GetRequiredService<IMongoCollection<Interview>>(),
        app.Services.GetRequiredService<IMongoCollection<Note>>(),
        app.Services.GetRequiredService<IMongoCollection<StatusUpdate>>(),
        app.Services.GetRequiredService<IMongoCollection<TrackedEmail>>(),
        app.Services.GetRequiredService<IMongoCollection<MatchSnapshot>>(),
        app.Services.GetRequiredService<IMongoCollection<ResumePack>>(),
        app.Services.GetRequiredService<IMongoCollection<MockInterviewSession>>(),
        startupLogger);
}
catch (Exception ex)
{
    // Best-effort on purpose: a missing index costs uniqueness guarantees and
    // query speed, not user isolation, so it must not stop the API serving.
    // Loud on purpose too: without uniq_user_company_jobtitle_ci the tracker
    // dedupe reverts to a check-then-act race, and duplicate applications
    // accumulate silently rather than surfacing as an error anyone sees.
    startupLogger.LogError(ex,
        "INDEX ENSURE FAILED — continuing startup WITHOUT the per-user unique indexes. "
        + "Application and message dedupe are now best-effort and duplicates can accumulate. "
        + "Fix the cause and restart.");
}

// The shared pool's indexes. Deliberately OUTSIDE the best-effort try above:
// the TTL index deletes rows, so a pool left unprotected by it is not a
// degraded service but a wrong one, and PoolIndexInitializer throws rather than
// logs for that case. It also refuses a TTL expiry that cannot be applied
// (issue #68), which is why a value it cannot change stops the API instead of
// expiring documents on a schedule nobody chose.
//
// Moved here from the scraper in Phase 3b of docs/scraper-slimming.md. It runs
// in the API because the API is always up, while the ingest runs for ten
// minutes a day -- and the indexes must exist before either writes.
await PoolIndexInitializer.EnsureAsync(
    app.Services.GetRequiredService<IMongoCollection<MongoDB.Bson.BsonDocument>>(),
    app.Services.GetRequiredService<IMongoCollection<PoolJobState>>()
        .Database.GetCollection<MongoDB.Bson.BsonDocument>("poolJobState"),
    startupLogger);

app.UseCors();
app.UseRateLimiter();

// Optional shared-secret gate for a privately *hosted* instance: when ApiKey is
// set, every request must carry a matching X-Api-Key header. Predates sign-in,
// and is a gate on the whole instance rather than a per-user one — it was how a
// Fixed-mode deployment kept strangers out when there was no login at all. The
// public instance leaves it unset; it authenticates users instead (docs/auth.md). /health stays open
// for external uptime/health checks (nothing in this repo's deploy config wires one
// up automatically today, but gating it behind the key would break one if added);
// /api/config only reveals identityMode, which is observable from the outside
// anyway.
var apiKeySecret = builder.Configuration["ApiKey"];
if (!string.IsNullOrEmpty(apiKeySecret))
{
    var expectedKey = System.Text.Encoding.UTF8.GetBytes(apiKeySecret);
    var openPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "/health", "/api/config",
    };
    app.Use(async (ctx, next) =>
    {
        if (HttpMethods.IsOptions(ctx.Request.Method) || openPaths.Contains(ctx.Request.Path.Value ?? ""))
        {
            await next();
            return;
        }
        var provided = System.Text.Encoding.UTF8.GetBytes(ctx.Request.Headers["X-Api-Key"].ToString());
        if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(provided, expectedKey))
        {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await ctx.Response.WriteAsJsonAsync(new { error = "Missing or invalid API key." });
            return;
        }
        await next();
    });
    startupLogger.LogInformation("API key auth enabled — requests require X-Api-Key");
}

app.MapGet("/health", (ILogger<Program> logger) =>
{
    logger.LogInformation("Health check hit");
    return Results.Ok(new { status = "ok", timestamp = DateTime.UtcNow });
})
    .WithName("Health")
    .WithSummary("Liveness probe for orchestration and Job Match wake-up checks");

// identityMode is here for SERVICE clients, not the browser. A client that must
// act AS a user has to know whether this instance expects it to present a
// session token, and before this there was nothing it could ask: the mailbot
// pointed at a Cookie-mode instance, sent no token, got a fresh empty account
// and a perfectly ordinary 200, and reported a successful sync of nothing
// (issue #67). Not a disclosure -- Cookie mode announces itself by setting a
// uid cookie on every response, and Fixed mode by never doing so.
app.MapGet("/api/config", (IdentityResolver identity) => Results.Ok(new
{
    identityMode = identity.Mode.ToString(),
}))
    .WithName("GetClientConfig")
    .WithSummary("Public client config (demo mode, identity mode)");

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.UseUserIdentityCookie();

app.MapAuthEndpoints();
app.MapNoticeEndpoints();
app.MapApplicationEndpoints();
app.MapInterviewEndpoints();
app.MapInterviewInsightsEndpoints();
app.MapResumePackEndpoints();
app.MapNoteEndpoints();
app.MapMessageEndpoints();
app.MapStatsEndpoints();
app.MapMatchEndpoints();
app.MapPoolEndpoints();
app.MapMockInterviewEndpoints();
app.MapEmailParseEndpoints();

app.Run();
