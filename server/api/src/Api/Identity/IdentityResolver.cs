using ApplicationTracker.Core.Identity;
using Microsoft.Extensions.Options;

namespace ApplicationTracker.Api.Identity;

// Resolves the userId for a request from whichever source this deployment is
// configured to use. Config is validated once at construction so a
// misconfigured instance fails at startup rather than silently serving every
// visitor the same (or the wrong) user's data.
public sealed class IdentityResolver
{
    // Where a minted id is parked for the rest of the request, so two reads of
    // IUserContext.UserId inside one request can never disagree.
    private const string HttpContextItemKey = "nextrole.userId";

    private readonly IdentityOptions _options;
    private readonly Guid _fixedUserId;

    public IdentityResolver(IOptions<IdentityOptions> options)
    {
        _options = options.Value;

        if (_options.Mode == IdentityMode.Fixed)
        {
            if (!Guid.TryParse(_options.FixedUserId, out _fixedUserId) || _fixedUserId == Guid.Empty)
                throw new InvalidOperationException(
                    "Identity:Mode is Fixed but Identity:FixedUserId is missing or not a valid non-empty GUID. " +
                    "Set it to the GUID of the single user this instance serves.");
        }
    }

    public IdentityMode Mode => _options.Mode;
    public string CookieName => _options.CookieName;

    // Owner that pre-multi-user documents (no userId, or a fixed singleton
    // `_id`) are migrated onto. On the private instance that is its real single
    // user. On a cookie instance there is no such user, so they are parked
    // under a well-known id nothing reads — kept rather than deleted.
    public Guid LegacyOwnerUserId =>
        _options.Mode == IdentityMode.Fixed ? _fixedUserId : UserIds.OrphanedLegacyData;

    // The raw cookie value, for the middleware to hand to
    // SessionIdentityResolver. Deliberately NOT parsed here any more: the
    // cookie is an opaque token now, and the only code allowed to decide what
    // it means is the session lookup.
    public string? ReadCookie(HttpContext? http) =>
        http?.Request.Cookies[_options.CookieName];

    // Parks the resolved id for the rest of the request so every read inside
    // one request agrees, and so Resolve stays synchronous for the 61 handlers
    // that take IUserContext.
    public static void Park(HttpContext http, Guid userId) =>
        http.Items[HttpContextItemKey] = userId;

    /// <summary>
    /// Record that a service client presented a credential that did not
    /// resolve, WITHOUT deciding yet whether that matters.
    /// </summary>
    /// <remarks>
    /// It matters only if the handler goes on to need a user. Refusing in the
    /// middleware instead — which is what shipped in #81 — refuses the
    /// user-independent calls too, and those legitimately act as nobody:
    /// job-facts and job-parse read no profile and score nothing. That
    /// regression stored 60 pool jobs with no extracted requirements before it
    /// was caught, silently, because the ingest treats a failed extraction as
    /// "retry next run" rather than as an error.
    ///
    /// So the refusal moves to the point of use. A handler that never reads
    /// IUserContext is unaffected; one that does gets a 401 instead of a
    /// freshly minted account. That is structural rather than a route list:
    /// a new user-scoped endpoint is covered without anyone remembering to add
    /// it, which is the property the route allowlist in nginx.conf does not have.
    /// </remarks>
    public static void ParkUnresolvedServiceIdentity(HttpContext http, string source) =>
        http.Items[HttpContextItemKey] = new UnresolvedServiceIdentity(source);

    public Guid Resolve(HttpContext? http)
    {
        if (_options.Mode == IdentityMode.Fixed) return _fixedUserId;

        if (http is not null && http.Items.TryGetValue(HttpContextItemKey, out var parked))
        {
            if (parked is Guid resolved) return resolved;

            // A service client whose credential did not resolve, now asking
            // who it is. This is the question it must not get an answer to.
            if (parked is UnresolvedServiceIdentity unresolved)
                throw new UnresolvedServiceIdentityException(unresolved.Source);
        }

        // Previously this minted a fresh id here. It must not any more.
        //
        // Minting outside the middleware is exactly the orphaned-write failure
        // in docs/multi-user.md: the request succeeds, the row is filed under
        // an id nobody will ever hold, and nothing logs a problem. With
        // sessions there is also nowhere to put such an id — no session
        // document exists for it, so the browser could never come back to it.
        //
        // If this throws, identity middleware did not run for this request, or
        // something is reading IUserContext outside a request. Both are bugs,
        // and both are far cheaper to find as a 500 than as data filed under a
        // phantom user.
        throw new InvalidOperationException(
            "Identity has not been resolved for this request. UseUserIdentityCookie must run "
            + "before anything reads IUserContext.UserId, and background work must take an "
            + "explicit userId rather than resolving one.");
    }
}

/// <summary>Parked for a service client whose credential did not resolve.</summary>
public sealed record UnresolvedServiceIdentity(string Source);

/// <summary>
/// Thrown when a handler asks who the user is and the answer would have been a
/// freshly minted account. Surfaced as a 401 by UseUserIdentityCookie.
/// </summary>
public sealed class UnresolvedServiceIdentityException(string source)
    : InvalidOperationException(
        $"Service client '{source}' presented no credential that resolves to a session, "
        + "and this request needs to know which user it is for.")
{
    public string Source { get; } = source;
}

// Scoped per-request view of the resolved id, so endpoints can take it as a
// handler parameter instead of reaching for HttpContext.
public sealed class HttpUserContext : IUserContext
{
    private readonly Lazy<Guid> _userId;

    public HttpUserContext(IdentityResolver resolver, IHttpContextAccessor accessor)
        => _userId = new Lazy<Guid>(() => resolver.Resolve(accessor.HttpContext));

    public Guid UserId => _userId.Value;
}
