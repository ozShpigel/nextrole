using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

// One document per user, keyed by _id = userId — no unscoped query shape.
public sealed class UserQuotaRepository : IUserQuotaRepository
{
    private readonly IMongoCollection<UserQuota> _quotas;

    public UserQuotaRepository(IMongoCollection<UserQuota> quotas) => _quotas = quotas;

    private static string Today() => DateTime.UtcNow.ToString("yyyy-MM-dd");

    /// <remarks>
    /// Three conditional writes rather than read-then-write, so two pack
    /// requests arriving together cannot both see "2 used" and both proceed.
    /// Each step is a single atomic update whose filter carries the condition:
    ///   1. today's counter exists and is under the limit  -> increment it;
    ///   2. no counter for today yet                       -> claim the day at 1;
    ///   3. someone else claimed the day in between        -> retry step 1 once.
    /// Falling through all three means the limit really is used up.
    /// </remarks>
    public async Task<bool> TryConsumePackAsync(Guid userId, int dailyLimit, CancellationToken ct = default)
    {
        var today = Today();

        if (await TryIncrementAsync(userId, today, dailyLimit, ct)) return true;

        try
        {
            var claimed = await _quotas.UpdateOneAsync(
                q => q.Id == userId && q.PackDate != today,
                Builders<UserQuota>.Update
                    .Set(q => q.PackDate, today)
                    .Set(q => q.PackCount, 1)
                    .SetOnInsert(q => q.Id, userId),
                new UpdateOptions { IsUpsert = true },
                ct);
            if (claimed.ModifiedCount == 1 || claimed.UpsertedId is not null) return true;
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // The upsert lost a race: a concurrent request created today's
            // counter a moment ago. Fall through and try to increment it.
        }

        return await TryIncrementAsync(userId, today, dailyLimit, ct);
    }

    private async Task<bool> TryIncrementAsync(Guid userId, string today, int dailyLimit, CancellationToken ct)
    {
        var result = await _quotas.UpdateOneAsync(
            q => q.Id == userId && q.PackDate == today && q.PackCount < dailyLimit,
            Builders<UserQuota>.Update.Inc(q => q.PackCount, 1),
            cancellationToken: ct);
        return result.ModifiedCount == 1;
    }

    public async Task<int> PacksUsedTodayAsync(Guid userId, CancellationToken ct = default)
    {
        var doc = await _quotas.Find(q => q.Id == userId).FirstOrDefaultAsync(ct);
        return doc is not null && doc.PackDate == Today() ? doc.PackCount : 0;
    }
}
