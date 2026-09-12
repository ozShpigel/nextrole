using System.Text.Json.Serialization;
using ApplicationTracker.Core.Identity;
using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// One user's score for one job in the shared pool.
//
// Scores cannot live on the pool document itself: the pool is shared and a
// score is an opinion about one candidate. This is the per-user half —
// discovered_jobs holds what the posting says, jobScores holds what it is
// worth to a given user.
//
// Its existence is also the bookkeeping for "score only what is new": a pool
// job with no row here for this user has never been scored for them, which is
// a more durable question than "was it added since they last looked" (it also
// covers a job that only started matching after a profile edit).
public sealed record JobScore : IUserOwned
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public string Id { get; init; } = "";

    [JsonIgnore]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid UserId { get; init; }

    // discovered_jobs.id — the shared pool's own job id, not a Mongo _id.
    public string JobId { get; init; } = "";

    public int? Score { get; init; }
    public string? Verdict { get; init; }
    public bool? ShouldApply { get; init; }
    // The full MatchResponse as stored JSON, same shape discovered_jobs.match_analysis used.
    public string? MatchAnalysis { get; init; }
    // Set when scoring failed for this job: the row still exists so the job is
    // not re-scored on every visit, but it carries no verdict.
    public string? Error { get; init; }
    public DateTime ScoredAt { get; init; } = DateTime.UtcNow;

    // (userId, jobId) is the real identity; the _id is just a deterministic
    // rendering of it so an upsert cannot create two rows for the same pair.
    public static string KeyFor(Guid userId, string jobId) => $"{userId}:{jobId}";
}
