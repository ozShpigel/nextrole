using System.Security.Cryptography;
using System.Text;

namespace ApplicationTracker.Api.Identity;

/// <summary>
/// The CSRF state and PKCE verifier that live between <c>/google/start</c> and
/// <c>/google/callback</c>, and the single cookie that carries them.
/// </summary>
/// <remarks>
/// Extracted from the endpoint so the rules can be tested. State mismatch,
/// replay and a missing cookie are where OAuth implementations actually go
/// wrong, and while they lived inside a lambda with an IHttpClientFactory
/// dependency the only thing standing behind them was a manual click.
/// </remarks>
public sealed record OAuthFlowChallenge(string State, string Verifier)
{
    // PKCE S256: the challenge is the hash, the verifier is the secret, and
    // only the hash travels through the browser.
    public string CodeChallenge =>
        OAuthFlow.Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(Verifier)));

    public string CookieValue => $"{State}.{Verifier}";
}

/// <summary>
/// The flow cookie, abstracted away from HttpContext so that "reading it
/// consumes it" is a property a test can assert rather than a line of endpoint
/// code nobody checks.
/// </summary>
public interface IFlowCookieStore
{
    string? Read();
    void Write(string value, TimeSpan lifetime);
    void Clear();
}

public sealed class HttpFlowCookieStore : IFlowCookieStore
{
    private readonly HttpContext _http;
    public HttpFlowCookieStore(HttpContext http) => _http = http;

    // Scoped to /api/auth: this cookie has no business being sent anywhere else.
    private static CookieOptions Options(TimeSpan? lifetime = null) => new()
    {
        HttpOnly = true,
        Secure = true,
        // Lax, not Strict: the callback arrives as a cross-site top-level
        // redirect from Google, and Strict would withhold the cookie — the
        // flow would fail for everyone, every time.
        SameSite = SameSiteMode.Lax,
        Path = "/api/auth",
        IsEssential = true,
        Expires = lifetime is null ? null : DateTimeOffset.UtcNow.Add(lifetime.Value),
    };

    public string? Read() => _http.Request.Cookies[OAuthFlow.CookieName];
    public void Write(string value, TimeSpan lifetime) =>
        _http.Response.Cookies.Append(OAuthFlow.CookieName, value, Options(lifetime));
    public void Clear() =>
        _http.Response.Cookies.Delete(OAuthFlow.CookieName, Options());
}

public static class OAuthFlow
{
    public const string CookieName = "nr_oauth";

    // Long enough to read a consent screen, short enough that an abandoned
    // flow cookie is not lying around.
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    public static OAuthFlowChallenge Begin(IFlowCookieStore store)
    {
        var challenge = new OAuthFlowChallenge(RandomToken(), RandomToken());
        store.Write(challenge.CookieValue, Lifetime);
        return challenge;
    }

    /// <summary>
    /// Reads the flow and destroys it. Single use: a replayed callback finds
    /// nothing and is rejected.
    /// </summary>
    /// <remarks>
    /// Clears UNCONDITIONALLY — before validating, and even when the cookie is
    /// absent or malformed. Clearing only on the success path would leave a
    /// failed attempt's state replayable, which is the more useful one to an
    /// attacker.
    /// </remarks>
    public static OAuthFlowChallenge? Consume(IFlowCookieStore store)
    {
        var raw = store.Read();
        store.Clear();

        if (string.IsNullOrEmpty(raw)) return null;

        var parts = raw.Split('.', 2);
        if (parts.Length != 2 || parts[0].Length == 0 || parts[1].Length == 0) return null;

        return new OAuthFlowChallenge(parts[0], parts[1]);
    }

    /// <summary>
    /// Compares the state Google echoed back with the one we issued.
    /// </summary>
    /// <remarks>
    /// Fixed-time: state is a CSRF token, and a length-or-content timing oracle
    /// is a way to forge one. FixedTimeEquals itself returns false for
    /// different lengths without comparing, so the lengths are the only thing
    /// that leaks.
    /// </remarks>
    public static bool StateMatches(OAuthFlowChallenge flow, string? provided)
    {
        if (string.IsNullOrEmpty(provided)) return false;
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(flow.State),
            Encoding.UTF8.GetBytes(provided));
    }

    // 256 bits. Both values are unguessable secrets, not identifiers.
    public static string RandomToken() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
