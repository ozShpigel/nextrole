using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

// Sessions are keyed by their token. Like IGoogleIdentityRepository this sits
// before user scoping rather than inside it: resolving a token is how we learn
// who the user is.
public interface IUserSessionRepository
{
    // Returns null for an unknown, malformed OR expired token. Expiry is
    // enforced in the query and not left to the TTL monitor, which runs on its
    // own schedule and would otherwise leave a dead session usable.
    Task<UserSession?> FindActiveAsync(string token, DateTime nowUtc, CancellationToken ct = default);

    Task<UserSession> CreateAsync(UserSession session, CancellationToken ct = default);

    // Sliding expiry. Called only when the stored values are meaningfully
    // stale, so a busy session does not turn every read into a write.
    Task TouchAsync(string token, DateTime lastSeenUtc, DateTime expiresUtc, CancellationToken ct = default);

    // Sign-out. Deleting is the point: a session that is merely marked dead
    // still resolves if the flag is ever missed.
    Task DeleteAsync(string token, CancellationToken ct = default);

    // Sign out everywhere — and the thing that makes a merge possible without
    // logging the user out of their other devices, since those sessions can be
    // repointed rather than dropped (docs/auth.md, Phase 1.6).
    Task<long> DeleteAllForUserAsync(Guid userId, CancellationToken ct = default);
    Task<long> ReassignUserAsync(Guid fromUserId, Guid toUserId, CancellationToken ct = default);

    Task EnsureIndexesAsync(CancellationToken ct = default);
}
