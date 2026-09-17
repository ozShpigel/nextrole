using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

/// <summary>
/// <c>poolJobState</c>, one row per (user, job).
/// </summary>
/// <remarks>
/// Ported from the scraper's <c>app/services/pool_state.py</c>, which wrote
/// this collection from the moment the pool existed. The documents are shared
/// with that history, so the shapes here are copied, not designed: <c>_id</c>
/// is <c>"{userId}:{jobId}"</c>, the flags are <c>SavedToTracker</c> /
/// <c>Dismissed</c>, and the view marker is a nullable <c>ViewedAt</c>.
/// </remarks>
public sealed class PoolJobStateRepository : IPoolJobStateRepository
{
    private readonly UserScopedCollection<PoolJobState> _states;

    public PoolJobStateRepository(UserScopedCollection<PoolJobState> states) => _states = states;

    public async Task<bool> IsSavedAsync(Guid userId, string jobId, CancellationToken ct = default)
    {
        var row = await _states
            .Find(userId, x => x.Id == PoolJobState.KeyFor(userId, jobId))
            .FirstOrDefaultAsync(ct);
        return row?.SavedToTracker == true;
    }

    public Task MarkSavedAsync(Guid userId, string jobId, CancellationToken ct = default) =>
        SetAsync(userId, jobId, Builders<PoolJobState>.Update.Set(x => x.SavedToTracker, true), ct);

    public Task MarkDismissedAsync(Guid userId, string jobId, CancellationToken ct = default) =>
        SetAsync(userId, jobId, Builders<PoolJobState>.Update.Set(x => x.Dismissed, true), ct);

    /// <remarks>
    /// A pipeline update with <c>$ifNull</c>, not <c>$setOnInsert</c>. The row
    /// usually already exists — saving or dismissing writes it first — and
    /// <c>$setOnInsert</c> would then never fire, so the first view would go
    /// unrecorded for exactly the jobs a user engaged with most. Idempotent by
    /// construction, in one round trip, so the client may call it on every
    /// selection and a second open cannot move the first timestamp.
    /// </remarks>
    public async Task MarkViewedAsync(Guid userId, string jobId, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        PipelineDefinition<PoolJobState, PoolJobState> pipeline = new BsonDocument[]
        {
            new("$set", new BsonDocument
            {
                { "UserId", userId.ToString() },
                { "JobId", jobId },
                { "ViewedAt", new BsonDocument("$ifNull", new BsonArray { "$ViewedAt", now }) },
            }),
        };

        await _states.UpdateOneAsync(
            userId,
            Builders<PoolJobState>.Filter.Eq(x => x.Id, PoolJobState.KeyFor(userId, jobId)),
            Builders<PoolJobState>.Update.Pipeline(pipeline),
            new UpdateOptions { IsUpsert = true },
            ct);
    }

    public async Task<long> ClearSavedAsync(
        Guid userId, IReadOnlyCollection<string> jobIds, CancellationToken ct = default)
    {
        if (jobIds.Count == 0) return 0;

        var result = await _states.UpdateManyAsync(
            userId,
            x => jobIds.Contains(x.JobId),
            Builders<PoolJobState>.Update
                .Set(x => x.SavedToTracker, false)
                .Set(x => x.UpdatedAt, DateTime.UtcNow),
            ct: ct);

        return result.ModifiedCount;
    }

    public async Task<Dictionary<string, PoolJobState>> StateForAsync(
        Guid userId, IReadOnlyCollection<string> jobIds, CancellationToken ct = default)
    {
        if (jobIds.Count == 0) return [];

        var rows = await _states
            .Find(userId, x => jobIds.Contains(x.JobId))
            .ToListAsync(ct);

        // Last one wins, but there can only be one: _id is derived from
        // (userId, jobId), so the pair is unique by construction.
        return rows.ToDictionary(r => r.JobId);
    }

    // Upsert on the deterministic key, stamping the identity fields so an
    // inserted row is complete whichever flag created it.
    private Task SetAsync(Guid userId, string jobId, UpdateDefinition<PoolJobState> update, CancellationToken ct) =>
        _states.UpdateOneAsync(
            userId,
            Builders<PoolJobState>.Filter.Eq(x => x.Id, PoolJobState.KeyFor(userId, jobId)),
            Builders<PoolJobState>.Update.Combine(
                update,
                Builders<PoolJobState>.Update.Set(x => x.UserId, userId),
                Builders<PoolJobState>.Update.Set(x => x.JobId, jobId),
                Builders<PoolJobState>.Update.Set(x => x.UpdatedAt, DateTime.UtcNow)),
            new UpdateOptions { IsUpsert = true },
            ct);
}
