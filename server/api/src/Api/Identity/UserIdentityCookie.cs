using ApplicationTracker.Api.Identity;

namespace ApplicationTracker.Api.Identity;

/// <summary>
/// Resolves the <c>uid</c> cookie to a userId once per request, and issues a
/// cookie when the visitor needs one.
/// </summary>
/// <remarks>
/// This is the ONLY place a userId is decided in Cookie mode.
/// <see cref="IdentityResolver.Resolve"/> reads what this parks and throws if
/// it finds nothing, so a request that bypasses this middleware fails loudly
/// instead of quietly filing data under an id nobody holds.
///
/// The cookie carries an opaque session token, never a userId — see
/// docs/auth.md. Before sessions it carried the userId in the clear, which
/// meant anyone could set it to somebody else's id and read their account.
///
/// Runs unconditionally, so by the time anything cares who the user is, the
/// answer exists. A visitor who writes nothing leaves only a session document
/// behind, which the TTL collects.
///
/// No-ops entirely in Fixed mode, where identity comes from configuration and
/// there is nothing to persist in a browser.
/// </remarks>
public static class UserIdentityCookieExtensions
{
    /// <summary>
    /// How a service client announces itself: the scraper sends
    /// <c>ingest</c>, the mailbot <c>mailbot</c>. A browser never sends it.
    /// </summary>
    /// <remarks>
    /// Untrusted, like any request header — but it can only ever make a request
    /// stricter, so a browser that sent it would lock itself out rather than
    /// gain anything. That is the safe direction for a header nobody verifies.
    /// </remarks>
    public const string ServiceSourceHeader = "X-Source";

    /// <summary>
    /// A service client got a freshly minted identity, which means its
    /// credential did not resolve — an expired, revoked or absent session
    /// token, or a configuration that never set one.
    /// </summary>
    /// <remarks>
    /// Minting is right for a browser: an unusable cookie should look like a
    /// first visit. For a service client it is the orphaned-write failure in
    /// `AGENTS.md`, which has now shipped three times — twice from the scraper
    /// and once from the mailbot (issue #67, which read an empty account and
    /// reported <c>{"Success":true}</c> over 115 applications). Each time the
    /// write returned 2xx and landed under a user nobody holds.
    ///
    /// 401 rather than 403: the credential is the problem, and a service client
    /// can fix it by presenting a valid one. JSON rather than an empty body so
    /// a caller reading content-type gets an answer it can log, and so this is
    /// distinguishable from nginx serving the SPA (docs in `AGENTS.md`).
    ///
    /// Nothing is parked and the pipeline does not continue, so no handler can
    /// run with the minted id. The session document the mint already wrote is
    /// left to its TTL — deleting it here would be a write on an unauthenticated
    /// path, and an unclaimed session expires on its own.
    /// </remarks>
    private static async Task RefuseMintedServiceIdentity(HttpContext ctx, string source)
    {
        var log = ctx.RequestServices
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger("nextrole.identity");

        log.LogError(
            "Refused a request from service client {Source} ({Method} {Path}): its credential did "
            + "not resolve to a session, and minting one would file its writes under a user nobody "
            + "holds. Check the session token in that service's environment.",
            source, ctx.Request.Method, ctx.Request.Path);

        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsync(
            """{"error":"unresolved_service_identity","detail":"This request carried X-Source but no credential that resolves to a session. Refusing rather than minting a new account: see docs/multi-user.md."}""");
    }

    public static IApplicationBuilder UseUserIdentityCookie(this IApplicationBuilder app)
    {
        var resolver = app.ApplicationServices.GetRequiredService<IdentityResolver>();
        if (resolver.Mode != IdentityMode.Cookie) return app;

        return app.Use(async (ctx, next) =>
        {
            // A preflight carries no cookies and its response is not the one
            // the browser stores them from. Resolving here would mint a
            // throwaway session per preflight.
            if (HttpMethods.IsOptions(ctx.Request.Method))
            {
                await next();
                return;
            }

            var sessions = ctx.RequestServices.GetRequiredService<SessionIdentityResolver>();
            var resolved = await sessions.ResolveAsync(resolver.ReadCookie(ctx), ctx.RequestAborted);

            if (resolved.Minted && ctx.Request.Headers.TryGetValue(ServiceSourceHeader, out var source))
            {
                await RefuseMintedServiceIdentity(ctx, source.ToString());
                return;
            }

            IdentityResolver.Park(ctx, resolved.UserId);

            // Only when the browser needs one: a new visitor, or a legacy
            // cookie being upgraded. An already-good session is not rewritten
            // on every request.
            if (resolved.TokenToIssue is not null)
                Append(ctx, resolver.CookieName, resolved.TokenToIssue);

            await next();
        });
    }

    /// <summary>
    /// Writes the <c>uid</c> cookie. Shared by this middleware and by Google
    /// sign-in, which re-points an existing browser at a different session —
    /// two copies of these options would drift, and a sign-in that wrote a
    /// subtly different cookie (a shorter life, a narrower path) would look
    /// like it worked and then quietly log the user back out.
    /// </summary>
    public static void Append(HttpContext ctx, string cookieName, string sessionToken)
    {
        ctx.Response.Cookies.Append(cookieName, sessionToken, new CookieOptions
        {
            HttpOnly = true,                                  // never read by JS; there is no client-side use for it
            Secure = true,                                    // browsers still accept Secure cookies over http://localhost
            SameSite = SameSiteMode.Lax,
            Expires = DateTimeOffset.UtcNow.AddYears(1),
            Path = "/",
            // No Domain: host-only, scoped to the site the browser asked
            // for. nginx proxies the API under that same host, so the
            // cookie comes back on every later call to either service.
            IsEssential = true,
        });
    }

    /// <summary>Drops the cookie. The session document is deleted separately —
    /// clearing only the cookie would leave a live token that still resolves
    /// if anyone kept a copy.</summary>
    public static void Clear(HttpContext ctx, string cookieName) =>
        ctx.Response.Cookies.Delete(cookieName, new CookieOptions { Path = "/" });
}
