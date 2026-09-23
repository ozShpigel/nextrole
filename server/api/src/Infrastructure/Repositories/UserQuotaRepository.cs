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

    /// <inheritdoc />
    /// <remarks>
    /// Same three conditional writes as the pack claim, over the score
    /// counter, with one difference: it claims a BLOCK of n rather than one,
    /// and grants a partial block at the ceiling.
    ///
    /// The partial grant is why this reads the remaining headroom before
    /// claiming it. A read-then-claim is a race — two scroll batches can both
    /// see the same headroom — so the claim itself still carries the
    /// `ScoreCount + n &lt;= limit` condition, and the read only decides how
    /// large an n to attempt. Losing the race means a smaller grant, never an
    /// overspend.
    /// </remarks>
    public async Task<int> TryConsumeScoreBudgetAsync(
        Guid userId, int jobs, int dailyLimit, CancellationToken ct = default)
    {
        if (jobs <= 0 || dailyLimit <= 0) return 0;

        var today = Today();

        for (var attempt = 0; attempt < 3; attempt++)
        {
            var used = await ScoresUsedTodayAsync(userId, ct);
            var want = Math.Min(jobs, dailyLimit - used);
            if (want <= 0) return 0;

            // Today's counter exists and has room for the whole block.
            var inc = await _quotas.UpdateOneAsync(
                q => q.Id == userId && q.ScoreDate == today && q.ScoreCount <= dailyLimit - want,
                Builders<UserQuota>.Update.Inc(q => q.ScoreCount, want),
                cancellationToken: ct);
            if (inc.ModifiedCount == 1) return want;

            // No counter for today yet -> claim the day at `want`.
            try
            {
                var claimed = await _quotas.UpdateOneAsync(
                    q => q.Id == userId && q.ScoreDate != today,
                    Builders<UserQuota>.Update
                        .Set(q => q.ScoreDate, today)
                        .Set(q => q.ScoreCount, want)
                        .SetOnInsert(q => q.Id, userId),
                    new UpdateOptions { IsUpsert = true },
                    ct);
                if (claimed.ModifiedCount == 1 || claimed.UpsertedId is not null) return want;
            }
            catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                // Lost the upsert race; the loop retries against the counter
                // the winner just created.
            }
        }

        return 0;
    }

    /// <inheritdoc />
    public async Task<int> ScoresUsedTodayAsync(Guid userId, CancellationToken ct = default)
    {
        var doc = await _quotas.Find(q => q.Id == userId).FirstOrDefaultAsync(ct);
        return doc is not null && doc.ScoreDate == Today() ? doc.ScoreCount : 0;
    }
}
