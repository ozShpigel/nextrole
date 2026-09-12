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


    public Guid Resolve(HttpContext? http)
    {
        if (_options.Mode == IdentityMode.Fixed) return _fixedUserId;

        var raw = http?.Request.Cookies[_options.CookieName];
        if (Guid.TryParse(raw, out var fromCookie) && fromCookie != Guid.Empty)
            return fromCookie;

        // No usable cookie: this visitor is new to us, so they get a fresh id.
        // Minting it does NOT create any document — a bot or a bounce leaves
        // nothing behind; the first row appears only when a CV is uploaded.
        // Issuing the cookie that makes this id stick beyond the current
        // request is the next step's job.
        if (http is null) return Guid.NewGuid();

        if (http.Items.TryGetValue(HttpContextItemKey, out var parked) && parked is Guid existing)
            return existing;

        var minted = Guid.NewGuid();
        http.Items[HttpContextItemKey] = minted;
        return minted;
    }
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
