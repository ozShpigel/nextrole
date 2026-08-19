using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

/// <summary>
/// Demo-only startup routine: re-anchors the seeded discovery pool's
/// discovered_at to now so it never ages out of the Matches page's default
/// 14-day window between manual reseeds. Mirrors the scraper's own
/// refresh_seed_timestamps() (server/scraper/app/main.py), but for the
/// fake jobs the .NET Seeder writes directly (marked seed_marker: true).
/// A no-op if nothing was ever seeded.
/// </summary>
public static class DemoJobFreshnessInitializer
{
    public static async Task RefreshAsync(
        IMongoClient client, string trackerDatabaseName, ILogger logger, CancellationToken ct = default)
    {
        var jobsCol = client.GetDatabase(trackerDatabaseName).GetCollection<BsonDocument>("discovered_jobs");
        var filter = Builders<BsonDocument>.Filter.Eq("seed_marker", true);
        var update = Builders<BsonDocument>.Update.Set("discovered_at", DateTime.UtcNow);
        var result = await jobsCol.UpdateManyAsync(filter, update, cancellationToken: ct);
        logger.LogInformation("Demo job freshness: bumped discovered_at on {Count} seeded job(s)", result.ModifiedCount);
    }
}
