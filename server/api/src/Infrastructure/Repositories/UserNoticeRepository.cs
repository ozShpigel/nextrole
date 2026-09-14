using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

// One document per user, keyed _id = userId: the id is the scope.
public sealed class UserNoticeRepository : IUserNoticeRepository
{
    private readonly IMongoCollection<UserNotices> _collection;

    public UserNoticeRepository(IMongoCollection<UserNotices> collection) => _collection = collection;

    public async Task<IReadOnlyList<UserNotice>> ListAsync(Guid userId, CancellationToken ct = default)
    {
        var doc = await _collection.Find(n => n.Id == userId).FirstOrDefaultAsync(ct);
        return doc?.Notices ?? [];
    }

    public Task AddAsync(Guid userId, UserNotice notice, CancellationToken ct = default) =>
        _collection.UpdateOneAsync(
            Builders<UserNotices>.Filter.Eq(n => n.Id, userId),
            Builders<UserNotices>.Update
                .SetOnInsert(n => n.Id, userId)
                .Push(n => n.Notices, notice),
            new UpdateOptions { IsUpsert = true },
            ct);

    public Task DismissAsync(Guid userId, string noticeId, CancellationToken ct = default) =>
        _collection.UpdateOneAsync(
            Builders<UserNotices>.Filter.Eq(n => n.Id, userId),
            Builders<UserNotices>.Update.PullFilter(n => n.Notices, x => x.Id == noticeId),
            cancellationToken: ct);
}
