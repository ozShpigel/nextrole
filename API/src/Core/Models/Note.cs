using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

public sealed record Note
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; } = Guid.NewGuid();
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public required Guid ApplicationId { get; init; }
    public required string Content { get; init; }
    public string? Category { get; init; } // "Preparation", "Research", "Thoughts", "Follow-up"
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}
