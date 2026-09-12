using System.Text.Json.Serialization;
using ApplicationTracker.Core.Identity;
using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// Content-addressed store for one Claude Analyst/Evaluator call's raw
// prompt+response. Batch-scored jobs (up to 5 per Analyst/Evaluator call)
// share the exact same snapshot text — keying by a hash of the content
// means every application from the same batch dedupes to one persisted
// copy automatically, with no batch-id plumbing needed between the scraper
// and the API (which never shared that context to begin with).
public sealed record MatchSnapshot : IUserOwned
{
    [BsonId]
    public required string Id { get; init; } // SHA-256 hex of the four fields below
    // Owner. Set from the resolved request identity. [JsonIgnore] so a request
    // body can never claim one and a response can never leak one.
    [JsonIgnore]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid UserId { get; init; }
    public string? AnalystInput { get; init; }
    public string? AnalystOutput { get; init; }
    public string? EvaluatorInput { get; init; }
    public string? EvaluatorOutput { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}
