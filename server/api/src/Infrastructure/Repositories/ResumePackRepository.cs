using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class ResumePackRepository : IResumePackRepository
{
    private readonly IMongoCollection<ResumePack> _collection;

    public ResumePackRepository(IMongoCollection<ResumePack> collection) => _collection = collection;

    public async Task<ResumePack?> GetByApplicationIdAsync(Guid applicationId, CancellationToken ct = default)
    {
        return await _collection.Find(p => p.ApplicationId == applicationId).FirstOrDefaultAsync(ct);
    }

    public async Task<ResumePack> UpsertAsync(ResumePack pack, CancellationToken ct = default)
    {
        await _collection.ReplaceOneAsync(
            p => p.ApplicationId == pack.ApplicationId, pack,
            new ReplaceOptions { IsUpsert = true }, ct);
        return pack;
    }
}
