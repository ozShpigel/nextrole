using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

// The dynamically-grown half of the shared pool's role list. Not user-scoped —
// the pool is shared (docs/job-pool.md); see PoolRole for why user ids live on
// it anyway.
public interface IPoolRoleRepository
{
    Task<List<PoolRole>> GetAllAsync(CancellationToken ct = default);

    /// <summary>
    /// Records that this user needs this role, and removes them from every
    /// other role. A user needs exactly one role at a time, so claiming is also
    /// how the previous one is released.
    /// </summary>
    /// <returns>Roles deleted because this user was the last to need them.</returns>
    Task<List<string>> ClaimAsync(Guid userId, string role, CancellationToken ct = default);

    /// <summary>Removes this user from every role, deleting any left with none.</summary>
    Task<List<string>> ReleaseAsync(Guid userId, CancellationToken ct = default);
}
