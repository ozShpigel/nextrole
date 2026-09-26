using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// A request for an ingest run NOW, because a profile save brought a function or
// location nobody had before.
//
// With the pre-read filter on, the postings that user wants were skipped by
// every earlier run -- nobody wanted them then -- so without this the first
// user of a new kind sees a near-empty board until the next daily run. The API
// writes the request (PoolDemandRepository reports what was new); the
// Greenhouse consumer claims pending requests, runs every board with live
// reads, and closes them when the run's boards are done. Matches reads
// "is my request still open" to show that roles are being collected.
public sealed record DemandTrigger
{
    public const string CollectionName = "greenhouse_triggers";

    // How long an open request still counts as collecting. A run takes
    // minutes; this only stops a request a dead consumer never closed from
    // showing "collecting" forever.
    public static readonly TimeSpan CollectingWindow = TimeSpan.FromHours(2);

    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; init; } = ObjectId.GenerateNewId().ToString();

    [BsonRepresentation(BsonType.String)]
    public Guid UserId { get; init; }

    // What was new, prefixed by kind: "function:sales", "location:berlin".
    public List<string> Values { get; init; } = new();

    public DateTime RequestedAt { get; init; }

    // Set by the consumer when it claims the request into a run.
    public string? RunId { get; init; }
    public DateTime? ClaimedAt { get; init; }

    // Set when the run's boards are all done -- or when the request is closed
    // without a run (Outcome says why).
    public DateTime? DoneAt { get; init; }
    public string? Outcome { get; init; }
}

// The consumer's heartbeat, which the API reads before telling a user roles
// are being collected: only a live consumer with the pre-read filter ON will
// ever act on a request. In log mode nothing is skipped, so there is nothing
// to collect -- and a consumer that is down would leave "collecting" up for
// the whole window.
public sealed record ConsumerHeartbeat
{
    public const string CollectionName = "greenhouse_consumer";
    public const string SingletonId = "consumer";

    // A heartbeat older than this is a consumer that is not running.
    public static readonly TimeSpan FreshFor = TimeSpan.FromMinutes(2);

    [BsonId]
    public string Id { get; init; } = SingletonId;

    // Greenhouse:Prefilter as the consumer parsed it: "Off", "Log" or "On".
    public string Prefilter { get; init; } = "";

    public DateTime SeenAt { get; init; }

    public bool IsActingOnRequests(DateTime now) => Prefilter == "On" && now - SeenAt < FreshFor;
}
