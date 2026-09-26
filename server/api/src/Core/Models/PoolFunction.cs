using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// A job function (JobFunctions.All) at least one user's profile is pursuing.
//
// Read by the Greenhouse ingest's pre-read filter: a posting whose title or
// department clearly belongs to a function nobody here wants is not paid for
// (docs/greenhouse.md -> "The pre-read filter"). Deliberately NOT user-scoped,
// like PoolRole: it is a property of the shared pool, and it records WHICH users
// want the function only so it can leave when the last of them does.
public sealed record PoolFunction
{
    public const string CollectionName = "pool_functions";

    // The function itself, e.g. "infrastructure". Being the _id makes "one
    // document per function" a constraint rather than a convention.
    [BsonId]
    public string Id { get; init; } = "";

    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public List<Guid> UserIds { get; init; } = new();

    public DateTime UpdatedAt { get; init; } = DateTime.UtcNow;
}
