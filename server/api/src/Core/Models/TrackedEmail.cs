using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// A Gmail message the mailbot parsed as job-related and (usually) tied to an
// application — the persisted record behind the client's Messages tab. Named
// TrackedEmail rather than "Message": Anthropic.SDK.Messaging.Message is
// already in scope alongside ApplicationTracker.Core.Models in ClaudeClient.cs,
// so a same-named type here would make every bare `Message` there ambiguous.
// The mailbot's daily sync window overlaps previous runs on purpose, and
// re-sync re-walks a company's full history, so GmailMessageId is the dedupe
// key: the repository upserts on it rather than inserting blindly.
public sealed record TrackedEmail
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string GmailMessageId { get; init; }
    // Null when the parser recognized the email as job-related but couldn't be
    // tied to a tracked application (company match failed) — still surfaced so
    // a mis-match is visible instead of silently dropped.
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid? ApplicationId { get; init; }
    public required string Company { get; init; }
    public string? JobTitle { get; init; }
    public required string Subject { get; init; }
    public required string From { get; init; }
    // ApplicationReceived / InterviewScheduled / Rejected / OfferReceived / FollowUp
    // — mirrors EmailUpdate.UpdateType on the mailbot side (kept as a plain string,
    // not an enum, so a new parser-emitted type never 400s the write).
    public required string UpdateType { get; init; }
    // Short excerpt for the list view — not the full (up to 50K char) body.
    public required string Snippet { get; init; }
    public DateTime ReceivedAt { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    // Client-side read state, set via PATCH /api/messages/{id}/read when the
    // Messages tab opens a row. Defaults false for every mailbot-written email;
    // the repository preserves it across upserts (mailbot's re-sync overwrites
    // everything else about the row but has no opinion on read state).
    public bool IsRead { get; init; } = false;
}
