using System.Text.Json.Serialization;
using ApplicationTracker.Core.Identity;
using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

public sealed record StatusUpdate : IUserOwned
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; } = Guid.NewGuid();
    // Owner. Set from the resolved request identity. [JsonIgnore] so a request
    // body can never claim one and a response can never leak one.
    [JsonIgnore]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid UserId { get; init; }
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public required Guid ApplicationId { get; init; }
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public required ApplicationStatus FromStatus { get; init; }
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public required ApplicationStatus ToStatus { get; init; }
    public string? Note { get; init; }
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;
}
