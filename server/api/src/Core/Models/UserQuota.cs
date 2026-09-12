using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// Per-user daily allowances. One document per user, keyed by _id = userId —
// the same one-per-user shape as the profile and résumé file, so there is no
// unscoped query to get wrong.
//
// Deliberately not derived by counting rows elsewhere: a résumé pack is
// upserted per application, so regenerating one leaves the row count
// unchanged and would let a user regenerate without limit.
public sealed record UserQuota
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; }

    // UTC date the counter belongs to, as yyyy-MM-dd. A plain string so the
    // "is this today's counter" test is an exact match rather than a range
    // query over a timestamp.
    public string PackDate { get; init; } = "";
    public int PackCount { get; init; }
}
