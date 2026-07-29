using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class InterviewInsightRepository : IInterviewInsightRepository
{
    private readonly IMongoCollection<InterviewInsight> _collection;

    public InterviewInsightRepository(IMongoCollection<InterviewInsight> collection) => _collection = collection;

    public async Task<InterviewInsight?> GetAsync(CancellationToken ct = default)
    {
        return await _collection.Find(i => i.Id == InterviewInsight.SingletonId).FirstOrDefaultAsync(ct);
    }

    public async Task<InterviewInsight> UpsertAsync(InterviewInsight insight, CancellationToken ct = default)
    {
        var doc = insight with { Id = InterviewInsight.SingletonId };
        await _collection.ReplaceOneAsync(
            i => i.Id == InterviewInsight.SingletonId, doc,
            new ReplaceOptions { IsUpsert = true }, ct);
        return doc;
    }
}
