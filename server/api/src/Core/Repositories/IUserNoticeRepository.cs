using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

// Notices outstanding for one user, keyed by userId (UserNotices.Id IS the userId).
public interface IUserNoticeRepository
{
    Task<IReadOnlyList<UserNotice>> ListAsync(Guid userId, CancellationToken ct = default);
    Task AddAsync(Guid userId, UserNotice notice, CancellationToken ct = default);
    Task DismissAsync(Guid userId, string noticeId, CancellationToken ct = default);
}
