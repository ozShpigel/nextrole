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
    /// <remarks>
    /// A role whose canonical form already exists reuses that row rather than
    /// adding a synonym of a search already running — see RoleCanonicalizer.
    /// </remarks>
    Task<ClaimOutcome> ClaimAsync(Guid userId, string role, CancellationToken ct = default);

    /// <summary>Removes this user from every role, deleting any left with none.</summary>
    Task<List<string>> ReleaseAsync(Guid userId, CancellationToken ct = default);
}

/// <param name="Role">The role as stored — the existing spelling when one matched.</param>
/// <param name="CollidedWith">
/// Set when the requested spelling differed from the one already stored, i.e. the
/// canonicaliser caught a variant. Null on an exact match or a genuinely new role.
/// </param>
/// <param name="ReleasedRoles">Roles deleted because this user was the last to need them.</param>
public sealed record ClaimOutcome(string Role, string? CollidedWith, List<string> ReleasedRoles);
