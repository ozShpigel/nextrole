using ApplicationTracker.Core.Models;
using ApplicationTracker.Infrastructure.Repositories;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

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
    var apps = sp.GetRequiredService<IMongoCollection<Application>>();
    var interviews = sp.GetRequiredService<IMongoCollection<Interview>>();
    var notes = sp.GetRequiredService<IMongoCollection<Note>>();
    var statusUpdates = sp.GetRequiredService<IMongoCollection<StatusUpdate>>();
    return new ApplicationRepository(apps, interviews, notes, statusUpdates);
});
builder.Services.AddScoped<IInterviewRepository>(sp =>
    new InterviewRepository(sp.GetRequiredService<IMongoCollection<Interview>>()));
builder.Services.AddScoped<INoteRepository>(sp =>
    new NoteRepository(sp.GetRequiredService<IMongoCollection<Note>>()));
builder.Services.AddScoped<IStatusUpdateRepository>(sp =>
    new StatusUpdateRepository(sp.GetRequiredService<IMongoCollection<StatusUpdate>>()));

// JSON: accept enum values as strings
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
});

// OpenAPI
builder.Services.AddOpenApi();

// CORS — configurable origins via CorsOrigins (comma-separated). "*" opens
// it up for dev; in prod this should be the public frontend URL so the SPA
// can call the tracker directly from the browser.
var corsOrigins = (builder.Configuration["CorsOrigins"] ?? "*")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (corsOrigins.Length == 1 && corsOrigins[0] == "*")
            policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
        else
            policy.WithOrigins(corsOrigins).AllowAnyMethod().AllowAnyHeader();
    });
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
    var apps = await repo.GetAllAsync(ct);
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

    var timeline = new List<object>();

    foreach (var s in statusUpdates)
        timeline.Add(new { type = "status", date = s.Timestamp, s.FromStatus, s.ToStatus, s.Note });

    foreach (var i in interviews)
        timeline.Add(new { type = "interview", date = i.ScheduledAt, i.Type, i.Interviewer, i.Completed, i.Notes });

    foreach (var n in notes)
        timeline.Add(new { type = "note", date = n.CreatedAt, n.Content, n.Category });

    var sorted = timeline.OrderBy(t => ((dynamic)t).date).ToList();
    return Results.Ok(sorted);
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

    var result = new List<object>();
    foreach (var interview in interviews)
    {
        var app = await appRepo.GetByIdAsync(interview.ApplicationId, ct);
        result.Add(new
        {
            interview,
            jobTitle = app?.JobTitle,
            company = app?.Company
        });
    }

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

app.Run();

// ============================================================
// REQUEST DTOs
// ============================================================

public record StatusUpdateRequest
{
    public required ApplicationStatus NewStatus { get; init; }
    public string? Note { get; init; }
}
