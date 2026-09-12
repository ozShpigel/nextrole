using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

// Plain IMongoCollection, not UserScopedCollection, on purpose: PoolRole is
// shared-pool state and does not implement IUserOwned. The user ids on it are
// data (who still needs this role), not a scope.
public sealed class PoolRoleRepository : IPoolRoleRepository
{
    private readonly IMongoCollection<PoolRole> _roles;

    public PoolRoleRepository(IMongoCollection<PoolRole> roles) => _roles = roles;

    public async Task<List<PoolRole>> GetAllAsync(CancellationToken ct = default) =>
        await _roles.Find(FilterDefinition<PoolRole>.Empty).ToListAsync(ct);

    public async Task<ClaimOutcome> ClaimAsync(Guid userId, string role, CancellationToken ct = default)
    {
        var canonical = RoleCanonicalizer.Canonicalize(role);

        // Match on the canonical form of each stored role NAME, not on the _id.
        // The scraper mirrors baseline roles under its own simpler key, and
        // matching by id would mean the two services had to agree on a
        // canonicalisation algorithm across languages — a rule with nothing
        // holding it true. This way there is one implementation, here.
        var existing = await _roles.Find(FilterDefinition<PoolRole>.Empty).ToListAsync(ct);
        var match = existing.FirstOrDefault(r => RoleCanonicalizer.Canonicalize(r.Role) == canonical);

        var key = match?.Id ?? canonical;
        var storedAs = match?.Role ?? role.Trim();
        // A variant of a role already being searched: reported so the classifier
        // drifting toward synonyms is visible rather than silently absorbed.
        var collidedWith = match is not null && !string.Equals(match.Role, role.Trim(), StringComparison.Ordinal)
            ? match.Role
            : null;

        // Claim first, release second. The other order would briefly leave a
        // role with no users during a re-claim of the same role, and a daily
        // run landing in that window would drop it.
        await _roles.UpdateOneAsync(
            r => r.Id == key,
            Builders<PoolRole>.Update
                .SetOnInsert(r => r.Id, key)
                .SetOnInsert(r => r.Role, storedAs)
                .SetOnInsert(r => r.CreatedAt, DateTime.UtcNow)
                .Set(r => r.UpdatedAt, DateTime.UtcNow)
                .AddToSet(r => r.UserIds, userId),
            new UpdateOptions { IsUpsert = true },
            ct);

        var released = await RemoveUserFromAsync(userId, exceptKey: key, ct);
        return new ClaimOutcome(storedAs, collidedWith, released);
    }

    public Task<List<string>> ReleaseAsync(Guid userId, CancellationToken ct = default) =>
        RemoveUserFromAsync(userId, exceptKey: null, ct);

    private async Task<List<string>> RemoveUserFromAsync(Guid userId, string? exceptKey, CancellationToken ct)
    {
        var filter = Builders<PoolRole>.Filter.AnyEq(r => r.UserIds, userId);
        if (exceptKey is not null)
            filter = Builders<PoolRole>.Filter.And(filter, Builders<PoolRole>.Filter.Ne(r => r.Id, exceptKey));

        await _roles.UpdateManyAsync(
            filter,
            Builders<PoolRole>.Update.Pull(r => r.UserIds, userId).Set(r => r.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);

        // A grown role nobody needs is not searched, so it is not kept.
        // Deleting rather than flagging: an empty user list IS the "inactive"
        // state, and a second representation of it would be one more thing to
        // keep true.
        //
        // Baseline rows are exempt. They mirror the config file so the role
        // classifier can see what is already searched (roles.publish_baseline);
        // they carry no users by design, and deleting them would empty that
        // list on the first release and reintroduce role fragmentation.
        var abandoned = Builders<PoolRole>.Filter.And(
            Builders<PoolRole>.Filter.Size(r => r.UserIds, 0),
            Builders<PoolRole>.Filter.Ne(r => r.Baseline, true));
        var orphaned = await _roles.Find(abandoned).Project(r => r.Role).ToListAsync(ct);
        if (orphaned.Count > 0)
            await _roles.DeleteManyAsync(abandoned, ct);
        return orphaned;
    }
}
