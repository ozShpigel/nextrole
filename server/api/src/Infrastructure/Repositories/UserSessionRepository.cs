using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class UserSessionRepository : IUserSessionRepository
{
    private readonly IMongoCollection<UserSession> _collection;

    public UserSessionRepository(IMongoCollection<UserSession> collection) => _collection = collection;

    public async Task<UserSession?> FindActiveAsync(string token, DateTime nowUtc, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(token)) return null;

        // ExpiresAt is in the FILTER, not checked after the fact. Mongo's TTL
        // monitor runs about once a minute, so the collection reliably contains
        // documents that are already dead; relying on the index to have removed
        // them would leave a window where an expired session still signs
        // someone in.
        var filter = Builders<UserSession>.Filter.And(
            Builders<UserSession>.Filter.Eq(s => s.Id, token),
            Builders<UserSession>.Filter.Gt(s => s.ExpiresAt, nowUtc));

        return await _collection.Find(filter).FirstOrDefaultAsync(ct);
    }

    public async Task<UserSession> CreateAsync(UserSession session, CancellationToken ct = default)
    {
        await _collection.InsertOneAsync(session, cancellationToken: ct);
        return session;
    }

    public Task TouchAsync(string token, DateTime lastSeenUtc, DateTime expiresUtc, CancellationToken ct = default) =>
        _collection.UpdateOneAsync(
            Builders<UserSession>.Filter.Eq(s => s.Id, token),
            Builders<UserSession>.Update
                .Set(s => s.LastSeenAt, lastSeenUtc)
                .Set(s => s.ExpiresAt, expiresUtc),
            cancellationToken: ct);

    public Task DeleteAsync(string token, CancellationToken ct = default) =>
        _collection.DeleteOneAsync(Builders<UserSession>.Filter.Eq(s => s.Id, token), ct);

    public async Task<long> DeleteAllForUserAsync(Guid userId, CancellationToken ct = default)
    {
        var result = await _collection.DeleteManyAsync(
            Builders<UserSession>.Filter.Eq(s => s.UserId, userId), ct);
        return result.DeletedCount;
    }

    public async Task<long> ReassignUserAsync(Guid fromUserId, Guid toUserId, CancellationToken ct = default)
    {
        // Idempotent by construction: once this runs nothing matches
        // fromUserId, so a re-run after a partial merge is a no-op rather than
        // a correction (docs/auth.md, Phase 1.6).
        var result = await _collection.UpdateManyAsync(
            Builders<UserSession>.Filter.Eq(s => s.UserId, fromUserId),
            Builders<UserSession>.Update.Set(s => s.UserId, toUserId),
            cancellationToken: ct);
        return result.ModifiedCount;
    }

    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        // TTL: cleanup only. expireAfterSeconds 0 means "delete once ExpiresAt
        // is in the past", which is the standard shape for an absolute-deadline
        // TTL. Correctness comes from the filter in FindActiveAsync.
        await _collection.Indexes.CreateOneAsync(
            new CreateIndexModel<UserSession>(
                Builders<UserSession>.IndexKeys.Ascending(s => s.ExpiresAt),
                new CreateIndexOptions { Name = "ttl_expiresat", ExpireAfter = TimeSpan.Zero }),
            cancellationToken: ct);

        // Sign-out-everywhere and the merge repoint both query by user.
        await _collection.Indexes.CreateOneAsync(
            new CreateIndexModel<UserSession>(
                Builders<UserSession>.IndexKeys.Ascending(s => s.UserId),
                new CreateIndexOptions { Name = "idx_userid" }),
            cancellationToken: ct);
    }
}
