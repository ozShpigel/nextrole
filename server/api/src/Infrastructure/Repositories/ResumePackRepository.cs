using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class ResumePackRepository : IResumePackRepository
{
    private readonly UserScopedCollection<ResumePack> _collection;

    public ResumePackRepository(UserScopedCollection<ResumePack> collection) => _collection = collection;

    public async Task<ResumePack?> GetByApplicationIdAsync(Guid userId, Guid applicationId, CancellationToken ct = default)
    {
        return await _collection.Find(userId, p => p.ApplicationId == applicationId).FirstOrDefaultAsync(ct);
    }

    public async Task<ResumePack> UpsertAsync(Guid userId, ResumePack pack, CancellationToken ct = default)
    {
        var owned = pack with { UserId = userId };
        await _collection.ReplaceOneAsync(
            userId, p => p.ApplicationId == owned.ApplicationId, owned,
            new ReplaceOptions { IsUpsert = true }, ct);
        return owned;
    }
}
