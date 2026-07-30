using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// The raw uploaded résumé file (PDF or TXT) — kept so the Profile page can
// show/re-download what you actually uploaded, separate from the parsed
// StructuredProfile fields it produced. Singleton (one current résumé),
// same shape as InterviewInsight.
public sealed record ResumeFile
{
    public const string SingletonId = "current";
    [BsonId] public string Id { get; init; } = SingletonId;
    public byte[] Bytes { get; init; } = [];
    public string FileName { get; init; } = "";
    public string ContentType { get; init; } = "";
    public DateTime UploadedAt { get; init; } = DateTime.UtcNow;
    // PDF only — lets the client build a custom pager instead of relying on
    // the browser's native PDF viewer chrome. Null if it couldn't be parsed.
    public int? PageCount { get; init; }
}
