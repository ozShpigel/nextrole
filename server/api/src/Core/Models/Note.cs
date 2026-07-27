using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

public sealed record Note
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; } = Guid.NewGuid();
    // Not `required`: CreateNote takes this from the route and overwrites
    // whatever the body carries, so JSON binding must not demand it.
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid ApplicationId { get; init; }
    public required string Content { get; init; }
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public NoteCategory? Category { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}

public enum NoteCategory
{
    Preparation,
    Research,
    Thoughts,
    FollowUp
}
