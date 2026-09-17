using ApplicationTracker.Api.Identity;
using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Identity;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using ApplicationTracker.Infrastructure.AI;
using ApplicationTracker.Infrastructure.Pdf;
using ApplicationTracker.Infrastructure.Profile;
using ApplicationTracker.Infrastructure.Listings;
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

        // Identity: the one place that knows whether this deployment reads a
        // cookie or a fixed configured id. Everything downstream takes a Guid.
        services.Configure<IdentityOptions>(configuration.GetSection(IdentityOptions.SectionName));
        services.AddSingleton<IdentityResolver>();
        services.AddScoped<IUserContext, HttpUserContext>();

        // Sessions: the cookie carries an opaque token, and this is what turns
        // it into a userId (docs/auth.md, Phase 1.5).
        services.AddScoped<IUserSessionRepository>(sp =>
            new UserSessionRepository(sp.GetRequiredService<IMongoCollection<UserSession>>()));
        services.AddScoped<SessionIdentityResolver>();

        services.AddScoped<IUserNoticeRepository>(sp =>
            new UserNoticeRepository(sp.GetRequiredService<IMongoCollection<UserNotices>>()));

        // Spans both databases: the singletons it moves live in jobmatch while
        // everything else is in job-tracker (docs/auth.md, Phase 1.6).
        services.AddScoped(sp =>
        {
            var client = sp.GetRequiredService<IMongoClient>();
            var profileDb = configuration["MongoDB:ProfileDatabase"] ?? configuration["MongoDB:Database"] ?? "jobmatch";
            return new UserMergeService(
                sp.GetRequiredService<IMongoDatabase>(),
                client.GetDatabase(profileDb),
                sp.GetRequiredService<ILogger<UserMergeService>>());
        });

        // Optional Google sign-in (docs/auth.md). Absent credentials leave it
        // simply unavailable — /api/auth/* 404s and the client hides the link —
        // rather than failing startup, matching how Gmail degrades in the
        // mailbot.
        services.Configure<GoogleAuthOptions>(configuration.GetSection(GoogleAuthOptions.SectionName));
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<GoogleAuthOptions>>().Value);
        services.AddScoped<IGoogleIdentityRepository>(sp =>
            new GoogleIdentityRepository(sp.GetRequiredService<IMongoCollection<GoogleIdentity>>()));
        services.AddScoped<GoogleSignInResolver>();
        services.AddHttpClient();

        // Repositories
        services.AddScoped<IApplicationRepository>(sp =>
        {
            var client = sp.GetRequiredService<IMongoClient>();
            var apps = sp.GetRequiredService<UserScopedCollection<Application>>();
            var interviews = sp.GetRequiredService<UserScopedCollection<Interview>>();
            var notes = sp.GetRequiredService<UserScopedCollection<Note>>();
            var statusUpdates = sp.GetRequiredService<UserScopedCollection<StatusUpdate>>();
            var resumePacks = sp.GetRequiredService<UserScopedCollection<ResumePack>>();
            return new ApplicationRepository(client, apps, interviews, notes, statusUpdates, resumePacks);
        });
        services.AddScoped<IInterviewRepository>(sp =>
            new InterviewRepository(sp.GetRequiredService<UserScopedCollection<Interview>>()));
        services.AddScoped<INoteRepository>(sp =>
            new NoteRepository(sp.GetRequiredService<UserScopedCollection<Note>>()));
        services.AddScoped<IStatusUpdateRepository>(sp =>
            new StatusUpdateRepository(sp.GetRequiredService<UserScopedCollection<StatusUpdate>>()));
        services.AddScoped<IMockInterviewRepository>(sp =>
            new MockInterviewRepository(sp.GetRequiredService<UserScopedCollection<MockInterviewSession>>()));
        services.AddScoped<IInterviewInsightRepository>(sp =>
            new InterviewInsightRepository(sp.GetRequiredService<IMongoCollection<InterviewInsight>>()));
        services.AddScoped<IResumePackRepository>(sp =>
            new ResumePackRepository(sp.GetRequiredService<UserScopedCollection<ResumePack>>()));
        services.AddScoped<ITrackedEmailRepository>(sp =>
            new TrackedEmailRepository(sp.GetRequiredService<UserScopedCollection<TrackedEmail>>()));
        services.AddScoped<IMatchSnapshotRepository>(sp =>
            new MatchSnapshotRepository(sp.GetRequiredService<UserScopedCollection<MatchSnapshot>>()));
        services.AddScoped<IJobScoreRepository>(sp =>
            new JobScoreRepository(sp.GetRequiredService<UserScopedCollection<JobScore>>()));

        services.AddScoped<IPoolJobStateRepository>(sp =>
            new PoolJobStateRepository(sp.GetRequiredService<UserScopedCollection<PoolJobState>>()));

        services.AddScoped<IPoolBrowseService, PoolBrowseService>();
        services.AddScoped<IUserQuotaRepository>(sp =>
            new UserQuotaRepository(sp.GetRequiredService<IMongoCollection<UserQuota>>()));
        services.AddScoped<IPoolRoleRepository>(sp =>
            new PoolRoleRepository(sp.GetRequiredService<IMongoCollection<PoolRole>>()));
        services.AddScoped<IPoolJobRepository>(sp =>
            new PoolJobRepository(sp.GetRequiredService<IMongoCollection<MongoDB.Bson.BsonDocument>>()));
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
        services.AddTransient<AnthropicThinkingHandler>();
        // The handler caps adaptive thinking on the claude-*-5 models, which the
        // SDK cannot express and which otherwise burn the whole max_tokens budget
        // on thinking and return no text at all — see AnthropicThinkingHandler.
        services.AddHttpClient("anthropic", c => c.Timeout = TimeSpan.FromSeconds(300))
            .AddHttpMessageHandler<AnthropicThinkingHandler>();
        // ClaudeClient is a singleton but needs the current request's X-Source
        // header (per-caller API key selection, see ClaudeClient.ResolveClient) —
        // IHttpContextAccessor is the standard way to reach that from a singleton.
        services.AddHttpContextAccessor();
        services.AddSingleton<IClaudeClient, ClaudeClient>();
        // The API's one call into the scraper: fetching a posting by URL needs
        // jobspy, and jobspy is Python. Nothing else about importing a job does.
        //
        // An explicit timeout, not the 100s default: this fetches up to five
        // LinkedIn pages one after another for a waiting user. Long enough for
        // that, short enough that a blocked scraper fails the request rather
        // than holding a browser connection open.
        services.AddHttpClient<IListingsClient, ListingsClient>(c =>
        {
            c.BaseAddress = new Uri(configuration["Scraper:BaseUrl"] ?? "http://scraper:8080");
            c.Timeout = TimeSpan.FromSeconds(120);
        });

        services.AddScoped<IJobMatchService, JobMatchService>();
        services.AddScoped<IPoolScanService, PoolScanService>();
        services.AddScoped<IPoolRoleService, PoolRoleService>();

        return services;
    }
}
