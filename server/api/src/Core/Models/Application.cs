using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

public sealed record Application
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string JobTitle { get; init; }
    public required string Company { get; init; }
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public required ApplicationStatus Status { get; init; }
    public int? MatchScore { get; init; }
    public string? MatchVerdict { get; init; }
    public string? JobDescription { get; init; }
    public string? MatchAnalysis { get; init; }
    // Reference into the matchSnapshots collection (see MatchSnapshot) — set by
    // ApplicationEndpoints' POST handler from the four raw fields below, never
    // stored directly on this document. Batch-scored jobs share one snapshot;
    // storing the text here instead would duplicate it once per application.
    public string? SnapshotId { get; init; }
    // Transient: the incoming create request carries the raw Claude
    // prompt/response text so it can be hashed and upserted into
    // matchSnapshots, but it's never written to the applications collection
    // itself — [BsonIgnore] keeps it out of the persisted document (and out
    // of GET responses, since those come back from Mongo).
    [BsonIgnore]
    public string? AnalystSnapshotInput { get; init; }
    [BsonIgnore]
    public string? AnalystSnapshotOutput { get; init; }
    [BsonIgnore]
    public string? EvaluatorSnapshotInput { get; init; }
    [BsonIgnore]
    public string? EvaluatorSnapshotOutput { get; init; }
    public string? CompanyNews { get; init; }
    public string? GlassdoorData { get; init; }
    public string? CompanySummary { get; init; }
    public string? WhyWorkHere { get; init; }
    public string? JobUrl { get; init; }
    public string? CompanyLogo { get; init; }
    public string? Salary { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime? AppliedAt { get; init; }
    public DateTime UpdatedAt { get; init; } = DateTime.UtcNow;
}

public enum ApplicationStatus
{
    Analyzing,
    DecidedToApply,
    Applied,
    PhoneScreen,
    TechnicalInterview,
    FinalRound,
    OfferReceived,
    Accepted,
    Rejected,
    Withdrawn
}
