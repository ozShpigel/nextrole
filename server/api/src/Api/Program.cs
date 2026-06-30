using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using System.Text.Json.Serialization;
using ApplicationTracker.Api.Endpoints;
using ApplicationTracker.Api.Extensions;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Infrastructure.Repositories;
using MongoDB.Driver;
using Scalar.AspNetCore;

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
    // Mock interview is conversational — one call per turn (5–8 per session)
    // plus a debrief — so it needs more headroom than the scoring endpoint.
    options.AddFixedWindowLimiter("mock", cfg =>
    {
        cfg.PermitLimit = 40;
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

app.UseCors();
app.UseRateLimiter();

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
        "/api/match", "/api/match/parse", "/api/match/batch",
        "/api/match/profile/normalize", "/api/match/profile/normalize-file",
        "/api/mock-interview/turn",
        "/api/mock-interview/debrief", "/api/emails/parse",
    };
    app.Use(async (ctx, next) =>
    {
        var method = ctx.Request.Method;
        var mutating = HttpMethods.IsPost(method) || HttpMethods.IsPut(method)
            || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);
        if (mutating && !analysisAllowlist.Contains(ctx.Request.Path.Value ?? ""))
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
app.MapNoteEndpoints();
app.MapStatsEndpoints();
app.MapMatchEndpoints();
app.MapMockInterviewEndpoints();
app.MapEmailParseEndpoints();

app.Run();
