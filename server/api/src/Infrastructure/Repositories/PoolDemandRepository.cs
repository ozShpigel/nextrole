using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

// Plain IMongoCollection, not UserScopedCollection, on purpose -- same reason as
// PoolRoleRepository: shared-pool state, and the user ids on it are data (who
// still wants this value), not a scope.
public sealed class PoolDemandRepository : IPoolDemandRepository
{
    private readonly IMongoCollection<PoolDemand> _functions;
    private readonly IMongoCollection<PoolDemand> _locations;

    public PoolDemandRepository(IMongoCollection<PoolDemand> functions, IMongoCollection<PoolDemand> locations)
    {
        _functions = functions;
        _locations = locations;
    }

    public static PoolDemandRepository For(IMongoDatabase database) => new(
        database.GetCollection<PoolDemand>(PoolDemand.FunctionsCollection),
        database.GetCollection<PoolDemand>(PoolDemand.LocationsCollection));

    public async Task<IReadOnlyList<string>> SyncAsync(
        Guid userId, IReadOnlyCollection<string> functions, IReadOnlyCollection<string> locations,
        CancellationToken ct = default)
    {
        var added = await SyncOneAsync(_functions, userId, functions, ct);
        var addedLocations = await SyncOneAsync(_locations, userId, locations, ct);
        return [.. added.Select(v => "function:" + v), .. addedLocations.Select(v => "location:" + v)];
    }

    // Returns the values this call created -- the upsert inserted them, so no
    // user had them a moment ago.
    private static async Task<List<string>> SyncOneAsync(
        IMongoCollection<PoolDemand> collection, Guid userId, IReadOnlyCollection<string> values, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var added = new List<string>();

        // Claim first, release second. The other order would briefly leave a
        // value with no users on a re-save, and an ingest reading in that
        // window would skip its postings.
        foreach (var value in values)
        {
            var result = await collection.UpdateOneAsync(
                d => d.Id == value,
                Builders<PoolDemand>.Update
                    .SetOnInsert(d => d.Id, value)
                    .Set(d => d.UpdatedAt, now)
                    .AddToSet(d => d.UserIds, userId),
                new UpdateOptions { IsUpsert = true },
                ct);
            if (result.UpsertedId is not null) added.Add(value);
        }

        var released = Builders<PoolDemand>.Filter.And(
            Builders<PoolDemand>.Filter.AnyEq(d => d.UserIds, userId),
            Builders<PoolDemand>.Filter.Nin(d => d.Id, values));
        await collection.UpdateManyAsync(
            released,
            Builders<PoolDemand>.Update.Pull(d => d.UserIds, userId).Set(d => d.UpdatedAt, now),
            cancellationToken: ct);

        // An empty user list IS "nobody wants it" -- no second representation.
        await collection.DeleteManyAsync(Builders<PoolDemand>.Filter.Size(d => d.UserIds, 0), ct);
        return added;
    }
}
