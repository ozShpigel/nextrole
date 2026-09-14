using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ApplicationTracker.Api.Identity;
using ApplicationTracker.Core.Identity;
using ApplicationTracker.Core.Repositories;
using Google.Apis.Auth;
using Microsoft.Extensions.Options;

namespace ApplicationTracker.Api.Endpoints;

/// <summary>
/// Optional Google sign-in (docs/auth.md). Sign-in decides WHICH userId the
/// browser is; it never replaces the Guid, and nothing downstream of
/// IdentityResolver learns that authentication exists.
/// </summary>
/// <remarks>
/// The OIDC authorization-code flow is written out here rather than taken from
/// Microsoft.AspNetCore.Authentication.Google on purpose: that package wants to
/// own a sign-in scheme and issue its own auth cookie, and this system already
/// has exactly one notion of identity — the uid cookie. Borrowing its
/// middleware would mean two session concepts to keep in agreement. What is
/// NOT hand-rolled is the security-critical half: the ID token's signature,
/// issuer, audience and expiry are checked by GoogleJsonWebSignature, never by
/// reading the claims out of the JWT.
/// </remarks>
public static class AuthEndpoints
{
    // Holds the CSRF state and the PKCE verifier between /start and /callback.
    // SameSite=Lax rather than Strict: the callback arrives as a cross-site
    // top-level redirect from Google, and Strict would withhold the cookie.
    private const string FlowCookie = "nr_oauth";
    private static readonly TimeSpan FlowLifetime = TimeSpan.FromMinutes(10);

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapGet("/google/start", (
            HttpContext http,
            IOptions<GoogleAuthOptions> opts,
            IdentityResolver resolver) =>
        {
            var o = opts.Value;
            if (!o.Enabled) return Results.NotFound(new { error = "Google sign-in is not configured." });

            // Fixed mode takes identity from configuration and issues no
            // cookie; there is nothing for a sign-in to change.
            if (resolver.Mode != IdentityMode.Cookie)
                return Results.NotFound(new { error = "Sign-in is not available on this instance." });

            var state = RandomToken();
            var verifier = RandomToken();
            var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

            http.Response.Cookies.Append(FlowCookie, $"{state}.{verifier}", new CookieOptions
            {
                HttpOnly = true,
                Secure = true,
                SameSite = SameSiteMode.Lax,
                Expires = DateTimeOffset.UtcNow.Add(FlowLifetime),
                Path = "/api/auth",
                IsEssential = true,
            });

            var url = QueryHelpers.Add("https://accounts.google.com/o/oauth2/v2/auth", new()
            {
                ["client_id"] = o.ClientId!,
                ["redirect_uri"] = o.RedirectUri,
                ["response_type"] = "code",
                // Identity only. The Gmail mailbox scope (gmail.readonly) is
                // deliberately NOT requested here — it is a Google "restricted"
                // scope carrying a paid annual security assessment, and asking
                // for it would show a first-time visitor a mailbox-access
                // consent screen before they have seen the product.
                ["scope"] = "openid email profile",
                ["state"] = state,
                ["code_challenge"] = challenge,
                ["code_challenge_method"] = "S256",
                // Sign-in only: no refresh token is wanted or stored, so no
                // access_type=offline and no prompt=consent.
                ["prompt"] = "select_account",
            });

            return Results.Redirect(url);
        });

        group.MapGet("/google/callback", async (
            HttpContext http,
            string? code,
            string? state,
            string? error,
            IOptions<GoogleAuthOptions> opts,
            IdentityResolver resolver,
            IUserContext user,
            GoogleSignInResolver signIn,
            IHttpClientFactory httpFactory,
            ILoggerFactory logFactory,
            CancellationToken ct) =>
        {
            var log = logFactory.CreateLogger("AuthEndpoints");
            var o = opts.Value;
            if (!o.Enabled) return Results.NotFound(new { error = "Google sign-in is not configured." });

            // Consume the flow cookie whatever happens next — it is single-use.
            var flow = http.Request.Cookies[FlowCookie];
            http.Response.Cookies.Delete(FlowCookie, new CookieOptions { Path = "/api/auth" });

            if (!string.IsNullOrEmpty(error))
                return Fail(o, "cancelled");

            if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state) || string.IsNullOrEmpty(flow))
                return Fail(o, "invalid_request");

            var parts = flow.Split('.', 2);
            // Fixed-time compare: state is a CSRF token, and a timing oracle on
            // it is a (small) way to forge one.
            if (parts.Length != 2 || !FixedTimeEquals(parts[0], state))
                return Fail(o, "state_mismatch");

            GoogleJsonWebSignature.Payload payload;
            try
            {
                var idToken = await ExchangeCodeAsync(httpFactory, o, code, parts[1], ct);
                if (idToken is null) return Fail(o, "token_exchange_failed");

                // Signature + iss + aud + exp, by the Google library. Never
                // decode-and-trust.
                payload = await GoogleJsonWebSignature.ValidateAsync(idToken,
                    new GoogleJsonWebSignature.ValidationSettings { Audience = [o.ClientId!] });
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Google sign-in failed during token exchange or validation");
                return Fail(o, "verification_failed");
            }

            // Google sets this false for unverified addresses on some account
            // types. We only display the email, but an unverified one should
            // not be shown as though it were confirmed.
            var email = payload.EmailVerified == true ? payload.Email ?? "" : "";

            var result = await signIn.ResolveAsync(user.UserId, payload.Subject, email, ct);

            switch (result.Outcome)
            {
                case GoogleSignInOutcome.SignedIn:
                case GoogleSignInOutcome.Claimed:
                    UserIdentityCookieExtensions.Append(http, resolver.CookieName, result.UserId);
                    if (result.Outcome == GoogleSignInOutcome.Claimed)
                        log.LogWarning(
                            "ClaimUserId consumed: Google account now owns pre-auth user {UserId}. "
                            + "This path is now closed permanently.", result.UserId);
                    return Results.Redirect(o.PostSignInRedirect);

                case GoogleSignInOutcome.NeedsChoice:
                    // Nothing written. The client asks which account to keep;
                    // resolving it is a separate deliberate action.
                    return Results.Redirect(
                        QueryHelpers.Add(o.PostSignInRedirect, new() { ["signin"] = "choose" }));

                default:
                    log.LogInformation("Google sign-in refused: {Reason}", result.Reason);
                    return Fail(o, "refused");
            }
        });

        group.MapPost("/signout", (HttpContext http, IdentityResolver resolver) =>
        {
            // Drops the session, not the account. The next request mints a
            // fresh anonymous id exactly as it would for a new visitor; signing
            // in again returns them to their linked account.
            http.Response.Cookies.Delete(resolver.CookieName, new CookieOptions { Path = "/" });
            return Results.NoContent();
        });

        group.MapGet("/me", async (
            IUserContext user,
            IGoogleIdentityRepository identities,
            IOptions<GoogleAuthOptions> opts,
            CancellationToken ct) =>
        {
            var link = await identities.GetAsync(user.UserId, ct);
            return Results.Ok(new
            {
                signedIn = link is not null,
                email = link?.Email,
                // Lets the client hide the sign-in affordance on an instance
                // where it cannot work, rather than offering a dead link.
                available = opts.Value.Enabled,
            });
        });
    }

    private static IResult Fail(GoogleAuthOptions o, string reason) =>
        Results.Redirect(QueryHelpers.Add(o.PostSignInRedirect, new() { ["signin_error"] = reason }));

    private static async Task<string?> ExchangeCodeAsync(
        IHttpClientFactory factory, GoogleAuthOptions o, string code, string verifier, CancellationToken ct)
    {
        var client = factory.CreateClient();
        var response = await client.PostAsync("https://oauth2.googleapis.com/token",
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["code"] = code,
                ["client_id"] = o.ClientId!,
                ["client_secret"] = o.ClientSecret!,
                ["redirect_uri"] = o.RedirectUri,
                ["grant_type"] = "authorization_code",
                ["code_verifier"] = verifier,
            }), ct);

        if (!response.IsSuccessStatusCode) return null;

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return doc.RootElement.TryGetProperty("id_token", out var t) ? t.GetString() : null;
    }

    private static string RandomToken() => Base64Url(RandomNumberGenerator.GetBytes(32));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static bool FixedTimeEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));

    // Small local helper so the file does not depend on WebUtilities just for
    // this; the values are all URL-unsafe until escaped.
    private static class QueryHelpers
    {
        public static string Add(string url, Dictionary<string, string> parameters)
        {
            var sb = new StringBuilder(url);
            sb.Append(url.Contains('?') ? '&' : '?');
            var first = true;
            foreach (var (k, v) in parameters)
            {
                if (!first) sb.Append('&');
                sb.Append(Uri.EscapeDataString(k)).Append('=').Append(Uri.EscapeDataString(v));
                first = false;
            }
            return sb.ToString();
        }
    }
}
