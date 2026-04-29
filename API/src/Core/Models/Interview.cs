using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

public sealed record Interview
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; } = Guid.NewGuid();
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public required Guid ApplicationId { get; init; }
    public required DateTime ScheduledAt { get; init; }
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public required InterviewType Type { get; init; }
    public string? Interviewer { get; init; }
    public string? Topics { get; init; }
    public string? Notes { get; init; }
    public string? Feedback { get; init; }
    public bool Completed { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}

public enum InterviewType
{
    Phone,
    Technical,
    Final,
    HR
}
