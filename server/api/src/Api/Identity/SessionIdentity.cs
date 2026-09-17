using System.Security.Cryptography;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using Microsoft.Extensions.Options;

namespace ApplicationTracker.Api.Identity;

/// <summary>
/// Resolves the <c>uid</c> cookie to a userId by looking the session up, and
/// mints one when there isn't a usable session.
/// </summary>
/// <remarks>
/// Async, because a lookup is a database call — which is exactly why it runs in
/// middleware once per request rather than behind <see cref="IUserContext"/>.
/// 61 endpoint handlers take <c>IUserContext user</c> and read
/// <c>user.UserId</c> synchronously; making identity async at that layer would
/// mean touching every one of them to buy nothing.
/// </remarks>
public sealed class SessionIdentityResolver
{
    private readonly IUserSessionRepository _sessions;
    private readonly IGoogleIdentityRepository _identities;
    private readonly IdentityOptions _options;
    private readonly ILogger<SessionIdentityResolver> _log;

    // Below this much remaining life, sliding expiry writes back. Sized so a
    // daily user triggers at most one write a day rather than one per request.
    private static readonly TimeSpan TouchThreshold = TimeSpan.FromDays(1);

    public SessionIdentityResolver(
        IUserSessionRepository sessions,
        IGoogleIdentityRepository identities,
        IOptions<IdentityOptions> options,
        ILogger<SessionIdentityResolver> log)
    {
        _sessions = sessions;
        _identities = identities;
        _options = options.Value;
        _log = log;
    }

    /// <param name="presentedCookie">Raw cookie value, or null.</param>
    /// <returns>
    /// The resolved userId, and a token to write back when the browser needs a
    /// new or replacement cookie.
    /// </returns>
    public async Task<ResolvedIdentity> ResolveAsync(string? presentedCookie, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var lifetime = TimeSpan.FromDays(_options.SessionLifetimeDays);

        if (!string.IsNullOrEmpty(presentedCookie))
        {
            // 1. An ordinary session token.
            var session = await _sessions.FindActiveAsync(presentedCookie, now, ct);
            if (session is not null)
            {
                // Sliding expiry, throttled — see TouchThreshold.
                if (session.ExpiresAt - now < lifetime - TouchThreshold)
                    await _sessions.TouchAsync(presentedCookie, now, now.Add(lifetime), ct);

                return new ResolvedIdentity(session.UserId, null);
            }

            // 2. A pre-sessions cookie: the userId itself, in the clear.
            //
            //    Without this every existing visitor is orphaned the moment
            //    sessions deploy — their cookie stops resolving and their
            //    account becomes unreachable. So a legacy cookie is honoured
            //    once, by minting a real session bound to the SAME userId, and
            //    replacing the cookie.
            //
            //    Time-limited on purpose (docs/auth.md). It is a bool rather
            //    than a date because a date in config expires silently: with
            //    the flag, `FromLegacyCookie` on the session shows whether the
            //    path still carries traffic before anyone turns it off.
            if (_options.AcceptLegacyGuidCookie
                && Guid.TryParse(presentedCookie, out var legacyUserId)
                && legacyUserId != Guid.Empty)
            {
                //    A LINKED ACCOUNT IS NEVER REACHABLE THIS WAY.
                //
                //    The grace path necessarily re-opens what sessions exist to
                //    close: present a userId, receive a session for it. That is
                //    tolerable for anonymous accounts, whose ids are 122 random
                //    bits nobody can guess — but NOT for an account someone has
                //    signed into, and emphatically not for the pre-auth userId
                //    a ClaimUserId migration names, which is typically a
                //    hand-written value like 11111111-1111-1111-1111-111111111111.
                //
                //    Once an account has an owner who can prove it, proving it
                //    is the only way in.
                if (await _identities.GetAsync(legacyUserId, ct) is not null)
                {
                    _log.LogWarning(
                        "Rejected a pre-sessions cookie for {UserId}: that account is linked to a "
                        + "Google account and must be reached by signing in.", legacyUserId);
                    return await MintAnonymousAsync(now, lifetime, ct);
                }

                var token = await IssueAsync(legacyUserId, now, lifetime, fromLegacy: true, ct);
                _log.LogInformation(
                    "Upgraded a pre-sessions cookie to a session for user {UserId}", legacyUserId);
                return new ResolvedIdentity(legacyUserId, token);
            }

            // 3. Anything else — expired, revoked, forged, or a legacy cookie
            //    after the grace period. Falls through to a fresh identity
            //    rather than erroring: an unusable cookie should look exactly
            //    like a first visit.
        }

        // A visitor we have not met. Minting creates a session document but no
        // user data — a bot or a bounce leaves nothing else behind, and the
        // TTL collects the session.
        return await MintAnonymousAsync(now, lifetime, ct);
    }

    private async Task<ResolvedIdentity> MintAnonymousAsync(DateTime now, TimeSpan lifetime, CancellationToken ct)
    {
        var freshUserId = Guid.NewGuid();
        var freshToken = await IssueAsync(freshUserId, now, lifetime, fromLegacy: false, ct);
        return new ResolvedIdentity(freshUserId, freshToken, Minted: true);
    }

    /// <summary>Issues a session for a known userId — also how sign-in
    /// re-points a browser at the account it just proved it owns.</summary>
    public async Task<string> IssueAsync(
        Guid userId, DateTime now, TimeSpan lifetime, bool fromLegacy = false, CancellationToken ct = default)
    {
        var token = NewToken();
        await _sessions.CreateAsync(new UserSession
        {
            Id = token,
            UserId = userId,
            IssuedAt = now,
            LastSeenAt = now,
            ExpiresAt = now.Add(lifetime),
            FromLegacyCookie = fromLegacy,
        }, ct);
        return token;
    }

    public Task<string> IssueAsync(Guid userId, CancellationToken ct = default) =>
        IssueAsync(userId, DateTime.UtcNow, TimeSpan.FromDays(_options.SessionLifetimeDays), false, ct);

    // 256 bits from a CSPRNG. Opaque: no userId, no timestamp, no structure to
    // reason about. Possession proves nothing until the collection says so.
    private static string NewToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <param name="UserId">Who this request is.</param>
/// <param name="TokenToIssue">
/// Non-null when the browser needs a Set-Cookie: a new visitor, or a legacy
/// cookie being upgraded. Null when the presented session was already good,
/// so an ordinary request does not rewrite the cookie every time.
/// </param>
/// <param name="Minted">
/// True when this identity is brand new — nobody has ever held it and it owns
/// no data. That is the right answer for a browser (an unusable cookie should
/// look like a first visit) and the wrong one for a service client, which only
/// ever gets here by being misconfigured. Distinct from
/// <paramref name="TokenToIssue"/>, which is also set when a legacy cookie is
/// upgraded — that case resolves a real, pre-existing account.
/// </param>
public readonly record struct ResolvedIdentity(Guid UserId, string? TokenToIssue, bool Minted = false);
