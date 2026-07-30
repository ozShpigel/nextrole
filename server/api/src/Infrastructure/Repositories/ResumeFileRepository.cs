using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class ResumeFileRepository : IResumeFileRepository
{
    private readonly IMongoCollection<ResumeFile> _collection;

    public ResumeFileRepository(IMongoCollection<ResumeFile> collection) => _collection = collection;

    public async Task<ResumeFile?> GetAsync(CancellationToken ct = default)
    {
        return await _collection.Find(f => f.Id == ResumeFile.SingletonId).FirstOrDefaultAsync(ct);
    }

    public async Task<ResumeFile> UpsertAsync(ResumeFile file, CancellationToken ct = default)
    {
        var doc = file with { Id = ResumeFile.SingletonId };
        await _collection.ReplaceOneAsync(
            f => f.Id == ResumeFile.SingletonId, doc,
            new ReplaceOptions { IsUpsert = true }, ct);
        return doc;
    }
}
