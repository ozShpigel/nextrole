using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using ApplicationTracker.Infrastructure.AI;
using ApplicationTracker.Infrastructure.Pdf;
using ApplicationTracker.Infrastructure.Profile;
using ApplicationTracker.Infrastructure.Repositories;
using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace ApplicationTracker.Api.Extensions;

public static class ServiceExtensions
{
    public static IServiceCollection AddApplicationServices(this IServiceCollection services, IConfiguration configuration)
    {
        // Exposed so MongoProfileProvider can locate Data/sample-profile.json at runtime
        configuration["ContentRoot"] = AppContext.BaseDirectory;

        // Repositories
        services.AddScoped<IApplicationRepository>(sp =>
        {
            var client = sp.GetRequiredService<IMongoClient>();
            var apps = sp.GetRequiredService<IMongoCollection<Application>>();
            var interviews = sp.GetRequiredService<IMongoCollection<Interview>>();
            var notes = sp.GetRequiredService<IMongoCollection<Note>>();
            var statusUpdates = sp.GetRequiredService<IMongoCollection<StatusUpdate>>();
            var resumePacks = sp.GetRequiredService<IMongoCollection<ResumePack>>();
            return new ApplicationRepository(client, apps, interviews, notes, statusUpdates, resumePacks);
        });
        services.AddScoped<IInterviewRepository>(sp =>
            new InterviewRepository(sp.GetRequiredService<IMongoCollection<Interview>>()));
        services.AddScoped<INoteRepository>(sp =>
            new NoteRepository(sp.GetRequiredService<IMongoCollection<Note>>()));
        services.AddScoped<IStatusUpdateRepository>(sp =>
            new StatusUpdateRepository(sp.GetRequiredService<IMongoCollection<StatusUpdate>>()));
        services.AddScoped<IMockInterviewRepository>(sp =>
            new MockInterviewRepository(sp.GetRequiredService<IMongoCollection<MockInterviewSession>>()));
        services.AddScoped<IInterviewInsightRepository>(sp =>
            new InterviewInsightRepository(sp.GetRequiredService<IMongoCollection<InterviewInsight>>()));
        services.AddScoped<IResumePackRepository>(sp =>
            new ResumePackRepository(sp.GetRequiredService<IMongoCollection<ResumePack>>()));
        services.AddScoped<ITrackedEmailRepository>(sp =>
            new TrackedEmailRepository(sp.GetRequiredService<IMongoCollection<TrackedEmail>>()));
        services.AddSingleton<IResumePdfRenderer, QuestPdfResumeRenderer>();

        // ResumeFile lives in the "jobmatch" DB alongside the profile (same
        // MongoDB:ProfileDatabase resolution MongoProfileProvider uses) — not
        // job-tracker where MongoExtensions' other collections live.
        services.AddSingleton(sp =>
        {
            var client = sp.GetRequiredService<IMongoClient>();
            var dbName = configuration["MongoDB:ProfileDatabase"] ?? configuration["MongoDB:Database"] ?? "jobmatch";
            return client.GetDatabase(dbName).GetCollection<ResumeFile>("resumeFile");
        });
        services.AddScoped<IResumeFileRepository>(sp =>
            new ResumeFileRepository(sp.GetRequiredService<IMongoCollection<ResumeFile>>()));

        // Read-only scoring configuration (Options pattern). Prompts default from
        // PromptSeeds (code); scoring config values live in appsettings "Scoring".
        // Both override per-deploy via env vars (Prompts__*, Scoring__*). Also
        // expose the resolved values as plain singletons so consumers in the Core
        // project can inject them without taking a Microsoft.Extensions.Options
        // dependency.
        services.Configure<PromptOptions>(configuration.GetSection("Prompts"));
        services.Configure<ScoringConfig>(configuration.GetSection("Scoring"));
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<PromptOptions>>().Value);
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<ScoringConfig>>().Value);

        // Job matching: profile lookup + Claude client + orchestration service
        services.AddMemoryCache();
        services.AddSingleton<PromptBuilder>();
        services.AddSingleton<IProfileProvider, MongoProfileProvider>();
        services.AddHttpClient("anthropic", c => c.Timeout = TimeSpan.FromSeconds(300));
        services.AddSingleton<IClaudeClient, ClaudeClient>();
        services.AddScoped<IJobMatchService, JobMatchService>();

        return services;
    }
}
