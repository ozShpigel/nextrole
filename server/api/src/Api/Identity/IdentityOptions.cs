namespace ApplicationTracker.Api.Identity;

// How a request's userId is resolved. This is the one place in the codebase
// that knows which deployment it is running as; query, scoring and pack code
// receive a plain Guid and cannot tell the difference.
public enum IdentityMode
{
    // private.nextrole.cloud — single user, no cookie, id comes from config.
    Fixed,
    // nextrole.cloud — multi-user, id comes from the `uid` cookie.
    Cookie,
}

public sealed class IdentityOptions
{
    public const string SectionName = "Identity";

    public IdentityMode Mode { get; set; } = IdentityMode.Fixed;

    // Required when Mode = Fixed: the single user this instance serves.
    // Also the owner legacy (pre-multi-user) documents are migrated onto,
    // so the private instance's existing data stays with its real owner.
    public string? FixedUserId { get; set; }

    public string CookieName { get; set; } = "uid";

    // Session lifetime, sliding. Kept at a year to match the lifetime the
    // pre-sessions cookie already had, so introducing sessions does not
    // silently start expiring people. Whether an anonymous session — which
    // nobody can ever sign out of — deserves something shorter is an open
    // question in docs/auth.md.
    public int SessionLifetimeDays { get; set; } = 365;

    // Cutover: honour a pre-sessions cookie (the bare userId) once, by minting
    // a real session bound to that same userId. Without it, every existing
    // visitor is orphaned on deploy.
    //
    // A bool rather than a date, because a date in config expires silently and
    // nobody notices until someone complains. UserSession.FromLegacyCookie
    // records which sessions came through here, so the flag can be turned off
    // on evidence that the path is no longer carrying traffic rather than on a
    // guess. Target: three months (docs/auth.md).
    public bool AcceptLegacyGuidCookie { get; set; } = true;
}
