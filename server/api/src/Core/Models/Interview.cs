using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

public sealed record Interview
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; } = Guid.NewGuid();
    // Not `required`: the interview endpoints take this from the route and
    // overwrite whatever the body carries, so JSON binding must not demand it.
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid ApplicationId { get; init; }
    public required DateTime ScheduledAt { get; init; }
    // Optional end time (null when the email/source gives no end). Never inferred.
    public DateTime? EndsAt { get; init; }
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
