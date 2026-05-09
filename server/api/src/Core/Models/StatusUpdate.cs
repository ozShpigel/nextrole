using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

public sealed record StatusUpdate
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; } = Guid.NewGuid();
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public required Guid ApplicationId { get; init; }
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public required ApplicationStatus FromStatus { get; init; }
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public required ApplicationStatus ToStatus { get; init; }
    public string? Note { get; init; }
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;
}
