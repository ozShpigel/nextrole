namespace ApplicationTracker.Api.Identity;

/// <summary>
/// Issues the <c>uid</c> cookie on the first request from a visitor who does
/// not already have one.
/// </summary>
/// <remarks>
/// Unconditional, not tied to CV upload: every request that arrives without a
/// usable cookie leaves with one. That removes any "has this visitor uploaded
/// yet" branch from the rest of the system — by the time anything cares who the
/// user is, the answer already exists.
///
/// Minting an id creates no documents. A bot or a bounce takes a cookie away
/// and leaves nothing behind; the first row for a user is written when they
/// upload a CV.
///
/// The API is the ONLY issuer. The scraper reads the same cookie (both services
/// sit behind the client's nginx on one origin, so the browser sends it to
/// both) but never sets one: two services minting concurrently on a first page
/// load would race, and the loser's id — possibly the one a CV was just
/// uploaded under — would be overwritten in the browser.
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
            // A preflight carries no cookies and its response is not the one the
            // browser stores them from.
            if (!HttpMethods.IsOptions(ctx.Request.Method) && !resolver.TryReadCookie(ctx, out _))
            {
                // Resolve (rather than minting here) so the id handed to this
                // request's handlers is the same one being written to the cookie.
                var userId = resolver.Resolve(ctx);
                Append(ctx, resolver.CookieName, userId);
            }

            await next();
        });
    }

    /// <summary>
    /// Writes the <c>uid</c> cookie. Shared by the first-visit middleware above
    /// and by Google sign-in, which re-points an existing browser at a
    /// different userId — two copies of these options would drift, and a
    /// sign-in that wrote a subtly different cookie (a shorter life, a
    /// narrower path) would look like it worked and then quietly log the user
    /// back out.
    /// </summary>
    public static void Append(HttpContext ctx, string cookieName, Guid userId)
    {
        ctx.Response.Cookies.Append(cookieName, userId.ToString(), new CookieOptions
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
}
