using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// Things the user has to be told, which happened while they were not looking.
//
// Server-side rather than a client toast, because the event that creates one —
// a merge on sign-in — happens during a redirect, and the page that would have
// shown a toast is the one being navigated away from. A notice has to survive
// that, and the reload after it, and the user opening the site on their laptop
// tomorrow instead.
//
// One document per user, keyed _id = userId, holding the outstanding notices.
// Not IUserOwned: the id is the scope.
public sealed record UserNotices
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; }

    public List<UserNotice> Notices { get; init; } = [];
}

// [BsonNoId] because the driver's Id convention applies to nested types too:
// without it this Id serialises as `_id` INSIDE the array element. That
// round-trips correctly and PullFilter renders the same field, so nothing
// breaks — but anyone querying `Notices.Id` by hand gets nothing back and
// concludes the id was never stored. It is a trap with no upside.
[BsonNoId]
public sealed record UserNotice
{
    // Client-visible id, used to dismiss.
    public string Id { get; init; } = Guid.NewGuid().ToString("N");

    // What kind of thing happened. The client renders copy per kind rather
    // than displaying server-authored prose, so the wording stays in the
    // frontend where the design tokens are.
    public string Kind { get; init; } = "";

    // Free-form per kind. For a parked singleton: which collections were
    // parked, and the retired userId they are parked under — enough to find
    // them again, which is the difference between "parked" and "lost".
    public Dictionary<string, string> Data { get; init; } = [];

    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}

public static class NoticeKinds
{
    // A sign-in merged an anonymous session into an existing account, and one
    // or more one-per-user documents could not move because the account
    // already had its own.
    public const string SingletonParked = "singleton_parked";
}
