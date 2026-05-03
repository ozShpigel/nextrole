using ApplicationTracker.Core.Models;
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

        services.AddSingleton(sp =>
        {
            var database = sp.GetRequiredService<IMongoDatabase>();
            return database.GetCollection<Application>("applications");
        });
        services.AddSingleton(sp =>
        {
            var database = sp.GetRequiredService<IMongoDatabase>();
            return database.GetCollection<Interview>("interviews");
        });
        services.AddSingleton(sp =>
        {
            var database = sp.GetRequiredService<IMongoDatabase>();
            return database.GetCollection<Note>("notes");
        });
        services.AddSingleton(sp =>
        {
            var database = sp.GetRequiredService<IMongoDatabase>();
            return database.GetCollection<StatusUpdate>("statusUpdates");
        });

        return services;
    }
}
