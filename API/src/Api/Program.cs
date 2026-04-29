using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using System.Text.Json.Serialization;
using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Infrastructure.AI;
using ApplicationTracker.Infrastructure.Profile;
using ApplicationTracker.Infrastructure.Repositories;
using Microsoft.AspNetCore.Mvc;
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

// Exposed so MongoProfileProvider can locate Data/professional-profile.md at runtime
builder.Configuration["ContentRoot"] = AppContext.BaseDirectory;

// MongoDB
var connectionString = builder.Configuration["MongoDB:ConnectionString"]
    ?? throw new InvalidOperationException("MongoDB:ConnectionString is not configured.");
var databaseName = builder.Configuration["MongoDB:DatabaseName"] ?? "job-tracker";

builder.Services.AddSingleton<IMongoClient>(_ => new MongoClient(connectionString));
builder.Services.AddSingleton(sp =>
{
    var client = sp.GetRequiredService<IMongoClient>();
    return client.GetDatabase(databaseName);
});

builder.Services.AddSingleton(sp =>
{
    var database = sp.GetRequiredService<IMongoDatabase>();
    return database.GetCollection<Application>("applications");
});
builder.Services.AddSingleton(sp =>
{
    var database = sp.GetRequiredService<IMongoDatabase>();
    return database.GetCollection<Interview>("interviews");
});
builder.Services.AddSingleton(sp =>
{
    var database = sp.GetRequiredService<IMongoDatabase>();
    return database.GetCollection<Note>("notes");
});
builder.Services.AddSingleton(sp =>
{
    var database = sp.GetRequiredService<IMongoDatabase>();
    return database.GetCollection<StatusUpdate>("statusUpdates");
});

// Repositories
builder.Services.AddScoped<IApplicationRepository>(sp =>
{
    var client = sp.GetRequiredService<IMongoClient>();
    var apps = sp.GetRequiredService<IMongoCollection<Application>>();
    var interviews = sp.GetRequiredService<IMongoCollection<Interview>>();
    var notes = sp.GetRequiredService<IMongoCollection<Note>>();
    var statusUpdates = sp.GetRequiredService<IMongoCollection<StatusUpdate>>();
    return new ApplicationRepository(client, apps, interviews, notes, statusUpdates);
});
builder.Services.AddScoped<IInterviewRepository>(sp =>
    new InterviewRepository(sp.GetRequiredService<IMongoCollection<Interview>>()));
builder.Services.AddScoped<INoteRepository>(sp =>
    new NoteRepository(sp.GetRequiredService<IMongoCollection<Note>>()));
builder.Services.AddScoped<IStatusUpdateRepository>(sp =>
    new StatusUpdateRepository(sp.GetRequiredService<IMongoCollection<StatusUpdate>>()));

// Job matching: profile lookup + Claude client + orchestration service
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<PromptBuilder>();
builder.Services.AddSingleton<IProfileProvider, MongoProfileProvider>();
builder.Services.AddHttpClient("anthropic", c => c.Timeout = TimeSpan.FromSeconds(300));
builder.Services.AddSingleton<IClaudeClient, ClaudeClient>();
builder.Services.AddScoped<IJobMatchService, ApplicationTracker.Core.Matching.JobMatchService>();

// JSON: accept enum values as strings
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
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
startupLogger.LogInformation("Database: {Db}", databaseName);
startupLogger.LogInformation("MongoDB connected: {Connected}", connectionString is not null);
startupLogger.LogInformation("URLs: {Urls}", builder.WebHost.GetSetting("urls") ?? "default");

// Middleware
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

// ============================================================
// APPLICATION ENDPOINTS
// ============================================================

app.MapPost("/api/applications", async (
    [FromBody] Application application,
    IApplicationRepository repo,
    IStatusUpdateRepository statusRepo,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    try
    {
        var created = await repo.CreateAsync(application, ct);

        await statusRepo.CreateAsync(new StatusUpdate
        {
            ApplicationId = created.Id,
            FromStatus = ApplicationStatus.Analyzing,
            ToStatus = created.Status,
            Note = "משרה נוספה למעקב"
        }, ct);

        logger.LogInformation("Application created: {Id} - {Title} at {Company}", created.Id, created.JobTitle, created.Company);
        return Results.Created($"/api/applications/{created.Id}", created);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error creating application");
        return Results.Problem("Error creating application");
    }
})
.WithName("CreateApplication")
.WithSummary("Create a new application");

app.MapGet("/api/applications", async (
    IApplicationRepository repo,
    CancellationToken ct) =>
{
    var apps = await repo.GetAllAsync(ct);
    return Results.Ok(apps);
})
.WithName("GetAllApplications")
.WithSummary("Get all applications");

app.MapGet("/api/applications/{id:guid}", async (
    Guid id,
    IApplicationRepository appRepo,
    IInterviewRepository interviewRepo,
    INoteRepository noteRepo,
    IStatusUpdateRepository statusRepo,
    CancellationToken ct) =>
{
    var application = await appRepo.GetByIdAsync(id, ct);
    if (application is null) return Results.NotFound();

    var interviews = await interviewRepo.GetByApplicationIdAsync(id, ct);
    var notes = await noteRepo.GetByApplicationIdAsync(id, ct);
    var statusUpdates = await statusRepo.GetByApplicationIdAsync(id, ct);

    return Results.Ok(new
    {
        application,
        interviews,
        notes,
        statusUpdates
    });
})
.WithName("GetApplication")
.WithSummary("Get application with details");

app.MapPut("/api/applications/{id:guid}/status", async (
    Guid id,
    [FromBody] StatusUpdateRequest request,
    IApplicationRepository repo,
    IStatusUpdateRepository statusRepo,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    try
    {
        var app = await repo.GetByIdAsync(id, ct);
        if (app is null) return Results.NotFound();

        var oldStatus = app.Status;
        var updated = app with
        {
            Status = request.NewStatus,
            UpdatedAt = DateTime.UtcNow,
            AppliedAt = request.NewStatus == ApplicationStatus.Applied ? DateTime.UtcNow : app.AppliedAt
        };

        await repo.UpdateAsync(updated, ct);

        await statusRepo.CreateAsync(new StatusUpdate
        {
            ApplicationId = id,
            FromStatus = oldStatus,
            ToStatus = request.NewStatus,
            Note = request.Note
        }, ct);

        logger.LogInformation("Application {Id} status changed: {From} -> {To}", id, oldStatus, request.NewStatus);
        return Results.Ok(updated);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error updating application status");
        return Results.Problem("Error updating application status");
    }
})
.WithName("UpdateApplicationStatus")
.WithSummary("Update application status");

app.MapDelete("/api/applications/{id:guid}", async (
    Guid id,
    IApplicationRepository repo,
    CancellationToken ct) =>
{
    await repo.DeleteAsync(id, ct);
    return Results.NoContent();
})
.WithName("DeleteApplication")
.WithSummary("Delete application");

// ============================================================
// INTERVIEW ENDPOINTS
// ============================================================

app.MapPost("/api/applications/{id:guid}/interviews", async (
    Guid id,
    [FromBody] Interview interview,
    IApplicationRepository appRepo,
    IInterviewRepository repo,
    CancellationToken ct) =>
{
    var app = await appRepo.GetByIdAsync(id, ct);
    if (app is null) return Results.NotFound();

    var created = interview with { ApplicationId = id };
    await repo.CreateAsync(created, ct);
    return Results.Created($"/api/interviews/{created.Id}", created);
})
.WithName("CreateInterview")
.WithSummary("Add interview to application");

app.MapPut("/api/interviews/{id:guid}", async (
    Guid id,
    [FromBody] Interview interview,
    IInterviewRepository repo,
    CancellationToken ct) =>
{
    var existing = await repo.GetByIdAsync(id, ct);
    if (existing is null) return Results.NotFound();

    var updated = interview with { Id = id, ApplicationId = existing.ApplicationId };
    await repo.UpdateAsync(updated, ct);
    return Results.Ok(updated);
})
.WithName("UpdateInterview")
.WithSummary("Update interview");

app.MapDelete("/api/interviews/{id:guid}", async (
    Guid id,
    IInterviewRepository repo,
    CancellationToken ct) =>
{
    await repo.DeleteAsync(id, ct);
    return Results.NoContent();
})
.WithName("DeleteInterview")
.WithSummary("Delete interview");

// ============================================================
// NOTE ENDPOINTS
// ============================================================

app.MapPost("/api/applications/{id:guid}/notes", async (
    Guid id,
    [FromBody] Note note,
    IApplicationRepository appRepo,
    INoteRepository repo,
    CancellationToken ct) =>
{
    var app = await appRepo.GetByIdAsync(id, ct);
    if (app is null) return Results.NotFound();

    var created = note with { ApplicationId = id };
    await repo.CreateAsync(created, ct);
    return Results.Created($"/api/notes/{created.Id}", created);
})
.WithName("CreateNote")
.WithSummary("Add note to application");

app.MapPut("/api/notes/{id:guid}", async (
    Guid id,
    [FromBody] Note note,
    INoteRepository repo,
    CancellationToken ct) =>
{
    var existing = await repo.GetByIdAsync(id, ct);
    if (existing is null) return Results.NotFound();

    var updated = note with { Id = id, ApplicationId = existing.ApplicationId };
    await repo.UpdateAsync(updated, ct);
    return Results.Ok(updated);
})
.WithName("UpdateNote")
.WithSummary("Update note");

app.MapDelete("/api/notes/{id:guid}", async (
    Guid id,
    INoteRepository repo,
    CancellationToken ct) =>
{
    await repo.DeleteAsync(id, ct);
    return Results.NoContent();
})
.WithName("DeleteNote")
.WithSummary("Delete note");

// ============================================================
// STATS ENDPOINT
// ============================================================

app.MapGet("/api/stats", async (
    IApplicationRepository repo,
    CancellationToken ct) =>
{
    var apps = await repo.GetAllSummariesAsync(ct);
    var total = apps.Count;
    var withScore = apps.Where(a => a.MatchScore.HasValue).ToList();
    var avgScore = withScore.Count > 0 ? (int)withScore.Average(a => a.MatchScore!.Value) : 0;

    var applied = apps.Count(a => a.Status >= ApplicationStatus.Applied);
    var heardBack = apps.Count(a =>
        a.Status is ApplicationStatus.PhoneScreen or ApplicationStatus.TechnicalInterview
        or ApplicationStatus.FinalRound or ApplicationStatus.OfferReceived
        or ApplicationStatus.Accepted or ApplicationStatus.Rejected);
    var responseRate = applied > 0 ? (int)(heardBack * 100.0 / applied) : 0;

    var inProgress = apps.Count(a =>
        a.Status is not ApplicationStatus.Rejected
        and not ApplicationStatus.Withdrawn
        and not ApplicationStatus.Accepted);

    var statusBreakdown = apps
        .GroupBy(a => a.Status)
        .ToDictionary(g => g.Key.ToString(), g => g.Count());

    return Results.Ok(new
    {
        total,
        inProgress,
        avgScore,
        responseRate,
        applied,
        heardBack,
        statusBreakdown
    });
})
.WithName("GetStats")
.WithSummary("Get application statistics");

// ============================================================
// TIMELINE ENDPOINT
// ============================================================

app.MapGet("/api/applications/{id:guid}/timeline", async (
    Guid id,
    IStatusUpdateRepository statusRepo,
    IInterviewRepository interviewRepo,
    INoteRepository noteRepo,
    CancellationToken ct) =>
{
    var statusUpdates = await statusRepo.GetByApplicationIdAsync(id, ct);
    var interviews = await interviewRepo.GetByApplicationIdAsync(id, ct);
    var notes = await noteRepo.GetByApplicationIdAsync(id, ct);

    var timeline = new List<TimelineItem>();

    foreach (var s in statusUpdates)
        timeline.Add(new TimelineItem("status", s.Timestamp) { FromStatus = s.FromStatus, ToStatus = s.ToStatus, Note = s.Note });

    foreach (var i in interviews)
        timeline.Add(new TimelineItem("interview", i.ScheduledAt) { InterviewType = i.Type, Interviewer = i.Interviewer, Completed = i.Completed, Notes = i.Notes });

    foreach (var n in notes)
        timeline.Add(new TimelineItem("note", n.CreatedAt) { Content = n.Content, Category = n.Category });

    timeline.Sort((a, b) => a.Date.CompareTo(b.Date));
    return Results.Ok(timeline);
})
.WithName("GetTimeline")
.WithSummary("Get application timeline");

// ============================================================
// UPCOMING INTERVIEWS
// ============================================================

app.MapGet("/api/interviews/upcoming", async (
    IInterviewRepository repo,
    IApplicationRepository appRepo,
    CancellationToken ct) =>
{
    var interviews = await repo.GetUpcomingAsync(10, ct);
    var appIds = interviews.Select(i => i.ApplicationId).Distinct();
    var apps = (await appRepo.GetByIdsAsync(appIds, ct)).ToDictionary(a => a.Id);

    var result = interviews.Select(i => new
    {
        interview = i,
        jobTitle = apps.TryGetValue(i.ApplicationId, out var a) ? a.JobTitle : null,
        company = apps.TryGetValue(i.ApplicationId, out var b) ? b.Company : null
    });

    return Results.Ok(result);
})
.WithName("GetUpcomingInterviews")
.WithSummary("Get upcoming interviews");

// ============================================================
// EXISTS CHECK (for JobMatchService integration)
// ============================================================

app.MapGet("/api/applications/exists", async (
    [FromQuery] string company,
    [FromQuery] string jobTitle,
    IApplicationRepository repo,
    CancellationToken ct) =>
{
    var exists = await repo.ExistsAsync(company, jobTitle, ct);
    return Results.Ok(exists);
})
.WithName("ApplicationExists")
.WithSummary("Check if application exists by company and job title");

// ============================================================
// JOB MATCH ENDPOINTS (merged from JobMatchService)
// ============================================================

app.MapPost("/api/match", async (
    [FromBody] MatchRequest request,
    IJobMatchService jobMatchService,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request?.JobDescription))
    {
        logger.LogWarning("Invalid match request: JobDescription is null or empty");
        return Results.BadRequest(new { error = "JobDescription is required" });
    }

    if (request.JobDescription.Length > 50_000)
    {
        return Results.BadRequest(new { error = "JobDescription exceeds maximum length of 50,000 characters" });
    }

    try
    {
        var response = await jobMatchService.AnalyzeMatchAsync(request, ct);
        return Results.Ok(response);
    }
    catch (InvalidOperationException ex) when (ex.Message.Contains("ApiKey"))
    {
        logger.LogError(ex, "Anthropic API key not configured");
        return Results.Problem(
            detail: "Anthropic API key is not configured. Please set Anthropic:ApiKey in configuration.",
            statusCode: 500);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error processing match request");
        return Results.Problem(detail: "An error occurred while processing the request", statusCode: 500);
    }
})
.RequireRateLimiting("match")
.WithName("AnalyzeJobMatch")
.WithSummary("Analyze job match");

app.MapGet("/api/match/profile", async (
    IProfileProvider provider,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    try
    {
        var doc = await provider.GetProfileDocumentAsync(ct);
        return Results.Ok(new
        {
            content = doc.Content,
            scoring_config = doc.ScoringConfig,
            analyst_prompt = doc.AnalystPrompt,
            evaluator_prompt = doc.EvaluatorPrompt,
            analyst_prompt_is_override = doc.AnalystIsOverride,
            evaluator_prompt_is_override = doc.EvaluatorIsOverride,
            updated_at = doc.UpdatedAt
        });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to load profile");
        return Results.Problem("An internal error occurred.", statusCode: 500);
    }
})
.WithName("GetProfile")
.WithSummary("Get the stored professional profile, scoring config, and prompts");

app.MapPut("/api/match/profile", async (
    [FromBody] UpdateProfileRequest request,
    IProfileProvider provider,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    if (request is null)
        return Results.BadRequest(new { error = "request body is required" });

    if (request.Content is null
        && request.ScoringConfig is null
        && request.AnalystPrompt is null
        && request.EvaluatorPrompt is null)
    {
        return Results.BadRequest(new { error = "at least one field must be provided" });
    }

    try
    {
        await provider.UpsertProfileAsync(
            request.Content,
            request.ScoringConfig,
            request.AnalystPrompt,
            request.EvaluatorPrompt,
            ct);
        var updated = await provider.GetProfileDocumentAsync(ct);
        return Results.Ok(new
        {
            content = updated.Content,
            scoring_config = updated.ScoringConfig,
            analyst_prompt = updated.AnalystPrompt,
            evaluator_prompt = updated.EvaluatorPrompt,
            analyst_prompt_is_override = updated.AnalystIsOverride,
            evaluator_prompt_is_override = updated.EvaluatorIsOverride,
            updated_at = updated.UpdatedAt
        });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to update profile");
        return Results.Problem("An internal error occurred.", statusCode: 500);
    }
})
.WithName("UpdateProfile")
.WithSummary("Update profile, scoring config, and/or prompts (all fields optional)");

app.Run();

// ============================================================
// REQUEST DTOs
// ============================================================

public record StatusUpdateRequest
{
    public required ApplicationStatus NewStatus { get; init; }
    public string? Note { get; init; }
}

public sealed record TimelineItem(string Type, DateTime Date)
{
    public ApplicationStatus? FromStatus { get; init; }
    public ApplicationStatus? ToStatus { get; init; }
    public string? Note { get; init; }
    public InterviewType? InterviewType { get; init; }
    public string? Interviewer { get; init; }
    public bool? Completed { get; init; }
    public string? Notes { get; init; }
    public string? Content { get; init; }
    public NoteCategory? Category { get; init; }
}

public sealed record UpdateProfileRequest
{
    [JsonPropertyName("content")]
    public string? Content { get; init; }

    [JsonPropertyName("scoring_config")]
    public Dictionary<string, object?>? ScoringConfig { get; init; }

    [JsonPropertyName("analyst_prompt")]
    public string? AnalystPrompt { get; init; }

    [JsonPropertyName("evaluator_prompt")]
    public string? EvaluatorPrompt { get; init; }
}
