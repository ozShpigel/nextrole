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
