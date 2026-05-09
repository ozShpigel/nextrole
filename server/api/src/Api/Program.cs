using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using System.Text.Json.Serialization;
using ApplicationTracker.Api.Endpoints;
using ApplicationTracker.Api.Extensions;
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
    options.RejectionStatusCode = 429;
});

var app = builder.Build();

var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
startupLogger.LogInformation("=== ApplicationTracker starting ===");
startupLogger.LogInformation("Environment: {Env}", app.Environment.EnvironmentName);
startupLogger.LogInformation("MongoDB connected: {Connected}",
    builder.Configuration["MongoDB:ConnectionString"] is not null);
startupLogger.LogInformation("URLs: {Urls}", builder.WebHost.GetSetting("urls") ?? "default");

app.UseCors();
app.UseRateLimiter();

app.MapGet("/health", (ILogger<Program> logger) =>
{
    logger.LogInformation("Health check hit");
    return Results.Ok(new { status = "ok", timestamp = DateTime.UtcNow });
})
    .WithName("Health")
    .WithSummary("Liveness probe for orchestration and Job Match wake-up checks");

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
app.MapEmailParseEndpoints();

app.Run();
