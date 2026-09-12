using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// The raw uploaded résumé file (PDF or TXT) — kept so the Profile page can
// show/re-download what you actually uploaded, separate from the parsed
// StructuredProfile fields it produced. One per user, same shape as
// InterviewInsight.
public sealed record ResumeFile
{
    // One résumé per user, so the user's id IS the document id: there is no
    // separate userId field to filter on, and no way to write a lookup that
    // forgets to scope itself. (Was a fixed "current" singleton before
    // multi-user.)
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; }
    public byte[] Bytes { get; init; } = [];
    public string FileName { get; init; } = "";
    public string ContentType { get; init; } = "";
    public DateTime UploadedAt { get; init; } = DateTime.UtcNow;
    // PDF only — lets the client build a custom pager instead of relying on
    // the browser's native PDF viewer chrome. Null if it couldn't be parsed.
    public int? PageCount { get; init; }
}
