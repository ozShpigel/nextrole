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

        // One document per user, keyed by _id = userId: no separate userId
        // field, so there is no unscoped query shape to guard against.
        services.AddSingleton(sp =>
            sp.GetRequiredService<IMongoDatabase>().GetCollection<InterviewInsight>("interviewInsights"));

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
