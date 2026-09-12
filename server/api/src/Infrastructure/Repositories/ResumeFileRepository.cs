using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

// One document per user, keyed by _id = userId. There is no unscoped read to
// get wrong: the id IS the scope.
public sealed class ResumeFileRepository : IResumeFileRepository
{
    private readonly IMongoCollection<ResumeFile> _collection;

    public ResumeFileRepository(IMongoCollection<ResumeFile> collection) => _collection = collection;

    public async Task<ResumeFile?> GetAsync(Guid userId, CancellationToken ct = default)
    {
        return await _collection.Find(f => f.Id == userId).FirstOrDefaultAsync(ct);
    }

    public async Task<ResumeFile> UpsertAsync(Guid userId, ResumeFile file, CancellationToken ct = default)
    {
        var doc = file with { Id = userId };
        await _collection.ReplaceOneAsync(
            f => f.Id == userId, doc,
            new ReplaceOptions { IsUpsert = true }, ct);
        return doc;
    }
}
