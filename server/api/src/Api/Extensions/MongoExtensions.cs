using ApplicationTracker.Core.Models;
using ApplicationTracker.Infrastructure.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Api.Extensions;

public static class MongoExtensions
{
    public static IServiceCollection AddMongoCollections(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration["MongoDB:ConnectionString"]
            ?? throw new InvalidOperationException("MongoDB:ConnectionString is not configured.");
        var databaseName = configuration["MongoDB:DatabaseName"] ?? "job-tracker";

        services.AddSingleton<IMongoClient>(_ => new MongoClient(connectionString));
        services.AddSingleton(sp =>
        {
            var client = sp.GetRequiredService<IMongoClient>();
            return client.GetDatabase(databaseName);
        });

        // Raw handles stay registered because index creation and the
        // cross-user migration legitimately span users. Everything else takes
        // the UserScopedCollection wrapper registered alongside each one, which
        // has no overload that skips the userId filter.
        Register<Application>(services, "applications");
        Register<Interview>(services, "interviews");
        Register<Note>(services, "notes");
        Register<StatusUpdate>(services, "statusUpdates");
        Register<MockInterviewSession>(services, "mockInterviewSessions");
        Register<ResumePack>(services, "resumePacks");
        Register<TrackedEmail>(services, "messages");
        Register<MatchSnapshot>(services, "matchSnapshots");

        Register<JobScore>(services, "jobScores");
        // Per-user state over the shared pool. Written by the scraper since the
        // pool existed (app/services/pool_state.py); the API took the write path
        // over in Phase 1 of docs/scraper-slimming.md, so the field names in
        // PoolJobState are that history, not a fresh design.
        Register<PoolJobState>(services, "poolJobState");

        // One document per user, keyed by _id = userId: no separate userId
        // field, so there is no unscoped query shape to guard against.
        services.AddSingleton(sp =>
            sp.GetRequiredService<IMongoDatabase>().GetCollection<InterviewInsight>("interviewInsights"));
        services.AddSingleton(sp =>
            sp.GetRequiredService<IMongoDatabase>().GetCollection<UserQuota>("userQuotas"));
        services.AddSingleton(sp =>
            sp.GetRequiredService<IMongoDatabase>().GetCollection<GoogleIdentity>("googleIdentity"));

        // Keyed by an opaque token, not a userId — it is looked up before we
        // know who the user is. Read by the scraper too (docs/auth.md).
        services.AddSingleton(sp =>
            sp.GetRequiredService<IMongoDatabase>().GetCollection<UserSession>("sessions"));

        services.AddSingleton(sp =>
            sp.GetRequiredService<IMongoDatabase>().GetCollection<UserNotices>("userNotices"));

        // Shared-pool state, like discovered_jobs: the role list the daily
        // run searches, grown and pruned by who is using the product.
        services.AddSingleton(sp =>
            sp.GetRequiredService<IMongoDatabase>().GetCollection<PoolRole>("pool_roles"));

        // Shared-pool state too: the job functions users are pursuing, which
        // the Greenhouse ingest reads to decide what is worth paying to read.
        services.AddSingleton(sp =>
            sp.GetRequiredService<IMongoDatabase>().GetCollection<PoolFunction>(PoolFunction.CollectionName));

        // The shared job pool the scraper writes. Not user-scoped on purpose
        // (docs/job-pool.md) and read as BsonDocument, since the scraper owns
        // its schema.
        services.AddSingleton(sp =>
            sp.GetRequiredService<IMongoDatabase>().GetCollection<MongoDB.Bson.BsonDocument>("discovered_jobs"));

        return services;
    }

    private static void Register<T>(IServiceCollection services, string collectionName)
        where T : Core.Identity.IUserOwned
    {
        services.AddSingleton(sp =>
            sp.GetRequiredService<IMongoDatabase>().GetCollection<T>(collectionName));
        services.AddSingleton(sp =>
            new UserScopedCollection<T>(sp.GetRequiredService<IMongoCollection<T>>()));
    }
}
