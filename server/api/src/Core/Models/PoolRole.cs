using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// A role the shared pool's daily search covers because at least one user's
// profile falls under it (Step 6).
//
// Deliberately NOT user-scoped: this is a property of the shared pool, like the
// job documents themselves. It records WHICH users need the role only so the
// role can be dropped when the last of them stops needing it — "no active user
// needs it" is derived from an empty list, not from a separate liveness notion
// that would need its own upkeep.
//
// The roles in config/roles.json are the baseline and never appear here: they
// are human-authored, always searched, and cannot be dropped by user churn.
public sealed record PoolRole
{
    // Casefolded role name. Being the _id makes "one document per role" a
    // constraint rather than something the writer has to remember.
    [BsonId]
    public string Id { get; init; } = "";

    // The search term as written, e.g. "Data Engineer".
    public string Role { get; init; } = "";

    // Users whose profile currently places them under this role.
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public List<Guid> UserIds { get; init; } = new();

    // Mirrored from the scraper config file so the role classifier can prefer a
    // role that is already searched. Baseline rows carry no users and are never
    // dropped by user churn -- see roles.publish_baseline.
    public bool Baseline { get; init; }

    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; init; } = DateTime.UtcNow;

    public static string KeyFor(string role) => role.Trim().ToLowerInvariant();
}
