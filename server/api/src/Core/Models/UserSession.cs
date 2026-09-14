using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// What the `uid` cookie carries, once it stops carrying a userId.
//
// SCHEMA NOTE: this document is a cross-language contract. The scraper reads
// this collection directly to resolve identity (server/scraper/app/identity.py)
// because an API call per scraper request would make the API a hard dependency
// of the scraper's request path. Field names and semantics are not changeable
// from one side alone — see docs/auth.md, Phase 1.5.
//
// Deliberately NOT IUserOwned, for the same reason as GoogleIdentity: a session
// is looked up by its token *before* we know who the user is, so a userId
// filter cannot apply to the read that matters.
public sealed record UserSession
{
    // The opaque token the browser holds. 32 CSPRNG bytes, base64url — 256
    // bits, no structure, and never a userId. The whole point is that
    // possession proves nothing about identity until this document says so.
    [BsonId]
    public string Id { get; init; } = "";

    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid UserId { get; init; }

    public DateTime IssuedAt { get; init; } = DateTime.UtcNow;

    // Carries the TTL index. NOTE: the TTL is cleanup, not correctness —
    // Mongo's background monitor runs roughly every 60 seconds, so an expired
    // document lingers. Every read must also filter on this, or an expired
    // session stays usable for up to a minute after it should have died.
    public DateTime ExpiresAt { get; init; }

    // Sliding expiry, written back only when meaningfully stale — otherwise
    // every request becomes a write.
    public DateTime LastSeenAt { get; init; } = DateTime.UtcNow;

    // True for a session minted by the legacy-cookie grace path rather than a
    // fresh visit or a sign-in. Lets us see whether the grace path is still
    // carrying traffic before removing it at the three-month mark.
    public bool FromLegacyCookie { get; init; }

    // No client IP or user agent: personal data on a site with no privacy
    // policy, and nothing here depends on it.
}
