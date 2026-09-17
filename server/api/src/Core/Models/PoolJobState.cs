using System.Text.Json.Serialization;
using ApplicationTracker.Core.Identity;
using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

/// <summary>
/// One user's relationship to one pool job, other than its score.
/// </summary>
/// <remarks>
/// <c>Dismissed</c> and <c>SavedToTracker</c> used to live on the
/// <c>discovered_jobs</c> document, which was correct while there was one user
/// and wrong the moment there were two: the pool is shared, so a dismiss hid
/// the posting for everybody. They are opinions a person holds about a posting,
/// exactly like a score, so they live in a per-user row keyed by
/// (userId, jobId) — the same shape <see cref="JobScore"/> uses.
///
/// Separate from <c>jobScores</c> rather than two more fields on it, because
/// the scoring path upserts whole score documents and would overwrite anything
/// written here. Two collections never written by the same code beat one
/// collection with an ordering hazard.
///
/// The field names are not a free choice: the scraper has been writing this
/// collection since the pool existed (<c>app/services/pool_state.py</c>), and
/// these must match its documents exactly. <c>UserId</c> is stored as a string
/// there, which is what <c>BsonRepresentation(String)</c> on a Guid produces.
/// </remarks>
public sealed record PoolJobState : IUserOwned
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public string Id { get; init; } = "";

    [JsonIgnore]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid UserId { get; init; }

    /// <summary>discovered_jobs.id — the shared pool's own job id, not a Mongo _id.</summary>
    public string JobId { get; init; } = "";

    [BsonIgnoreIfNull]
    public bool? SavedToTracker { get; init; }

    [BsonIgnoreIfNull]
    public bool? Dismissed { get; init; }

    /// <summary>
    /// When this user FIRST opened the job's detail panel; null if never.
    /// A timestamp rather than a bool or a counter: same storage, and it
    /// separates "scored today, opened three weeks later" from "never opened".
    /// Never overwritten once set.
    /// </summary>
    [BsonIgnoreIfNull]
    public DateTime? ViewedAt { get; init; }

    [BsonIgnoreIfNull]
    public DateTime? UpdatedAt { get; init; }

    // (userId, jobId) is the real identity; the _id is a deterministic
    // rendering of it so an upsert cannot create two rows for the same pair.
    // Must stay byte-identical to pool_state.py's `_key`.
    public static string KeyFor(Guid userId, string jobId) => $"{userId}:{jobId}";
}
