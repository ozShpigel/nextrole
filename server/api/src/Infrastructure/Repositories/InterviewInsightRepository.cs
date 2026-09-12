using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

// One document per user, keyed by _id = userId — same shape as ResumeFileRepository.
public sealed class InterviewInsightRepository : IInterviewInsightRepository
{
    private readonly IMongoCollection<InterviewInsight> _collection;

    public InterviewInsightRepository(IMongoCollection<InterviewInsight> collection) => _collection = collection;

    public async Task<InterviewInsight?> GetAsync(Guid userId, CancellationToken ct = default)
    {
        return await _collection.Find(i => i.Id == userId).FirstOrDefaultAsync(ct);
    }

    public async Task<InterviewInsight> UpsertAsync(Guid userId, InterviewInsight insight, CancellationToken ct = default)
    {
        var doc = insight with { Id = userId };
        await _collection.ReplaceOneAsync(
            i => i.Id == userId, doc,
            new ReplaceOptions { IsUpsert = true }, ct);
        return doc;
    }
}
