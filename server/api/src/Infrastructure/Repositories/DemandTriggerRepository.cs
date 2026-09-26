using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

// Plain IMongoCollection: the requests are ingest plumbing the consumer reads
// across users, not user-owned data -- DemandTrigger does not implement
// IUserOwned. The user's reads here still filter on their own id explicitly.
public sealed class DemandTriggerRepository : IDemandTriggerRepository
{
    private readonly IMongoCollection<DemandTrigger> _triggers;
    private readonly IMongoCollection<ConsumerHeartbeat> _consumer;

    public DemandTriggerRepository(
        IMongoCollection<DemandTrigger> triggers, IMongoCollection<ConsumerHeartbeat> consumer)
    {
        _triggers = triggers;
        _consumer = consumer;
    }

    public static DemandTriggerRepository For(IMongoDatabase database) => new(
        database.GetCollection<DemandTrigger>(DemandTrigger.CollectionName),
        database.GetCollection<ConsumerHeartbeat>(ConsumerHeartbeat.CollectionName));

    public Task RequestAsync(Guid userId, IReadOnlyCollection<string> newValues, CancellationToken ct = default) =>
        // Written whatever the consumer's mode: it closes requests it will not
        // act on, and deciding that here would copy its configuration into a
        // second service.
        _triggers.InsertOneAsync(new DemandTrigger
        {
            UserId = userId,
            Values = [.. newValues],
            RequestedAt = DateTime.UtcNow,
        }, cancellationToken: ct);

    public async Task<bool> IsCollectingAsync(Guid userId, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;

        var open = await _triggers
            .Find(t => t.UserId == userId && t.DoneAt == null && t.RequestedAt > now - DemandTrigger.CollectingWindow)
            .AnyAsync(ct);
        if (!open) return false;

        var consumer = await _consumer
            .Find(c => c.Id == ConsumerHeartbeat.SingletonId)
            .FirstOrDefaultAsync(ct);
        return consumer?.IsActingOnRequests(now) == true;
    }
}
