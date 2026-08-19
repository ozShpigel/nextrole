using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using System.Text.Json.Serialization;
using ApplicationTracker.Api.Endpoints;
using ApplicationTracker.Api.Extensions;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Infrastructure.Repositories;
using MongoDB.Driver;
using Scalar.AspNetCore;
using QuestPDF.Infrastructure;

QuestPDF.Settings.License = LicenseType.Community;

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
            policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
        else if (corsOrigins.Length > 0)
            policy.WithOrigins(corsOrigins).AllowAnyMethod().AllowAnyHeader();
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
    options.RejectionStatusCode = 429;
});

var app = builder.Build();

var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
startupLogger.LogInformation("=== ApplicationTracker starting ===");
startupLogger.LogInformation("Environment: {Env}", app.Environment.EnvironmentName);
startupLogger.LogInformation("MongoDB connected: {Connected}",
    builder.Configuration["MongoDB:ConnectionString"] is not null);
startupLogger.LogInformation("URLs: {Urls}", builder.WebHost.GetSetting("urls") ?? "default");

// Enforce the (Company, JobTitle) uniqueness invariant: clear any existing duplicate
// rows, then build the unique index. Failure here must not brick startup, so it's
// best-effort — the app still serves if Mongo is briefly unreachable at boot.
try
{
    await ApplicationIndexInitializer.EnsureIndexesAsync(
        app.Services.GetRequiredService<IMongoCollection<Application>>(),
        app.Services.GetRequiredService<IMongoCollection<Interview>>(),
        app.Services.GetRequiredService<IMongoCollection<Note>>(),
        app.Services.GetRequiredService<IMongoCollection<StatusUpdate>>(),
        startupLogger);
}
catch (Exception ex)
{
    startupLogger.LogError(ex, "Failed to ensure application indexes — continuing startup");
}

// Demo-only: keep the Seeder's fake discovery pool inside the Matches page's
// default 14-day window without needing a manual reseed after every restart.
if (builder.Configuration.GetValue<bool>("DemoMode"))
{
    try
    {
        await DemoJobFreshnessInitializer.RefreshAsync(
            app.Services.GetRequiredService<IMongoClient>(),
            builder.Configuration["MongoDB:DatabaseName"] ?? "job-tracker",
            startupLogger);
    }
    catch (Exception ex)
    {
        startupLogger.LogError(ex, "Failed to refresh demo job freshness — continuing startup");
    }
}

app.UseCors();
app.UseRateLimiter();

// Optional shared-secret gate for a privately *hosted* instance (no auth otherwise —
// single-tenant by design): when ApiKey is set, every request must carry a matching
// X-Api-Key header. The demo and local instances leave it unset. /health stays open
// for Render health checks; /api/config only reveals demoMode.
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

// DEMO_MODE — for the public demo instance: the job tracker is read-only.
// AI analyses (non-persisting) stay enabled; every other write returns 403, so
// visitors can explore the seeded fictional data without polluting it. Off by
// default (private/local instance behaves normally).
var demoMode = builder.Configuration.GetValue<bool>("DemoMode");
if (demoMode)
{
    // Non-persisting analysis endpoints stay writable (exact-path match — a prefix
    // on "/api/match" would wrongly allow PUT /api/match/profile).
    var analysisAllowlist = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "/api/match", "/api/match/title-triage", "/api/match/seniority-classify",
        "/api/match/discovery-score-batch", "/api/match/enrich-narrative",
        // normalize-file removed — it now persists the uploaded ResumeFile, so
        // it must 403 in demo like every other write; normalize (paste-text)
        // stays allowlisted since it's still purely ephemeral analysis.
        "/api/match/profile/normalize",
        "/api/mock-interview/turn",
        "/api/mock-interview/debrief", "/api/emails/parse",
    };
    // Generate Pack is the one *persisting* write allowed in demo — a
    // deliberate exception to "AI analyses stay enabled, everything else
    // 403s": it's the headline feature, cost is capped by the shared "pack"
    // rate limit (10/min, same as production), and the worst case of two
    // visitors regenerating the same seeded application's pack at once is
    // cosmetic (fictional data, last write wins). Matched by path pattern
    // since the id is dynamic; POST only — PUT on the same path is the
    // no-AI manual-edit route and stays blocked like every other write.
    var resumePackGeneratePath = new System.Text.RegularExpressions.Regex(
        @"^/api/applications/[0-9a-fA-F-]{36}/pack$",
        System.Text.RegularExpressions.RegexOptions.Compiled);
    app.Use(async (ctx, next) =>
    {
        var method = ctx.Request.Method;
        var mutating = HttpMethods.IsPost(method) || HttpMethods.IsPut(method)
            || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);
        var path = ctx.Request.Path.Value ?? "";
        var isAllowedGeneratePack = HttpMethods.IsPost(method) && resumePackGeneratePath.IsMatch(path);
        // Matches page "Add": allow POST /api/applications only for the
        // scraper's own save-from-discovery call, identified by the
        // X-Source header it already attaches to every scraper→API request
        // (ClaudeClient.cs uses the same header to route Anthropic billing —
        // never sent by the browser client). This is the same endpoint the
        // client's "Import Job" feature posts to directly for arbitrary
        // pasted URLs/descriptions, which must stay blocked (unbounded
        // scraping/AI cost, no cap) — the header keeps that path 403ing
        // while letting an already-scored seeded job get saved via Add.
        var isAllowedDiscoverySave = HttpMethods.IsPost(method) && path.Equals("/api/applications", StringComparison.OrdinalIgnoreCase)
            && ctx.Request.Headers["X-Source"].ToString() == "ingest";
        if (mutating && !analysisAllowlist.Contains(path) && !isAllowedGeneratePack && !isAllowedDiscoverySave)
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            await ctx.Response.WriteAsJsonAsync(new { error = "This is a read-only demo." });
            return;
        }
        await next();
    });
    startupLogger.LogInformation("DEMO_MODE enabled — tracker writes are disabled");
}

app.MapGet("/health", (ILogger<Program> logger) =>
{
    logger.LogInformation("Health check hit");
    return Results.Ok(new { status = "ok", timestamp = DateTime.UtcNow });
})
    .WithName("Health")
    .WithSummary("Liveness probe for orchestration and Job Match wake-up checks");

// Lets the client surface a read-only banner without guessing from 403s.
app.MapGet("/api/config", () => Results.Ok(new { demoMode }))
    .WithName("GetClientConfig")
    .WithSummary("Public client config (e.g. demo mode)");

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.MapApplicationEndpoints();
app.MapInterviewEndpoints();
app.MapInterviewInsightsEndpoints();
app.MapResumePackEndpoints();
app.MapNoteEndpoints();
app.MapMessageEndpoints();
app.MapStatsEndpoints();
app.MapMatchEndpoints();
app.MapMockInterviewEndpoints();
app.MapEmailParseEndpoints();

app.Run();
