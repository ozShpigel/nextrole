namespace ApplicationTracker.Core.Identity;

// Every user-scoped document carries the id of the user who owns it. The
// interface exists so UserScopedCollection<T> can AND a `userId` equality
// filter onto every query without each repository remembering to — a missed
// filter would serve another user's rows, so it is enforced structurally
// rather than by convention.
//
// Documents that are one-per-user (profile, resumeFile, interviewInsights)
// deliberately do NOT implement this: their `_id` IS the userId, so there is
// no separate field to filter on and no way to write an unscoped query.
public interface IUserOwned
{
    Guid UserId { get; }
}

// Well-known user ids.
public static class UserIds
{
    // Owner of record for documents written before multi-user, on an instance
    // that has no configured single user (Identity:Mode = Cookie). Nothing
    // reads this user: there is no anonymous or demo path into it. It exists
    // so the migration can give orphaned rows an owner instead of deleting
    // them, and so they can be found again later if anyone wants them.
    public static readonly Guid OrphanedLegacyData = new("00000000-0000-0000-0000-000000000001");
}

// The resolved owner of the current request. Resolution is the ONLY place that
// knows whether the id came from a cookie or from fixed configuration — see
// IdentityOptions. Everything downstream takes a plain Guid.
public interface IUserContext
{
    Guid UserId { get; }
}
