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
}
