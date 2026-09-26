using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

// Plain IMongoCollection, not UserScopedCollection, on purpose -- same reason as
// PoolRoleRepository: shared-pool state, and the user ids on it are data (who
// still wants this function), not a scope.
public sealed class PoolFunctionRepository : IPoolFunctionRepository
{
    private readonly IMongoCollection<PoolFunction> _functions;

    public PoolFunctionRepository(IMongoCollection<PoolFunction> functions) => _functions = functions;

    public async Task SyncAsync(Guid userId, IReadOnlyCollection<string> functions, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;

        // Claim first, release second. The other order would briefly leave a
        // function with no users on a re-save, and an ingest reading in that
        // window would skip its postings.
        foreach (var function in functions)
        {
            await _functions.UpdateOneAsync(
                f => f.Id == function,
                Builders<PoolFunction>.Update
                    .SetOnInsert(f => f.Id, function)
                    .Set(f => f.UpdatedAt, now)
                    .AddToSet(f => f.UserIds, userId),
                new UpdateOptions { IsUpsert = true },
                ct);
        }

        var released = Builders<PoolFunction>.Filter.And(
            Builders<PoolFunction>.Filter.AnyEq(f => f.UserIds, userId),
            Builders<PoolFunction>.Filter.Nin(f => f.Id, functions));
        await _functions.UpdateManyAsync(
            released,
            Builders<PoolFunction>.Update.Pull(f => f.UserIds, userId).Set(f => f.UpdatedAt, now),
            cancellationToken: ct);

        // An empty user list IS "nobody wants it" -- no second representation.
        await _functions.DeleteManyAsync(Builders<PoolFunction>.Filter.Size(f => f.UserIds, 0), ct);
    }
}
