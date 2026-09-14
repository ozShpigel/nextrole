using ApplicationTracker.Api.Identity;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace ArchitectureTests;

/// <summary>
/// Resolving the identity cookie to a userId (docs/auth.md, Phase 1.5).
/// </summary>
/// <remarks>
/// The property these exist to protect: presenting a userId must not grant
/// access to it. That was true of the pre-sessions cookie — it carried the
/// userId in the clear — and it is why the site could not be exposed publicly.
/// </remarks>
public class SessionIdentityResolverTests
{
    private static readonly Guid Alice = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Bob = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private sealed class FakeSessions : IUserSessionRepository
    {
        public readonly List<UserSession> Rows = [];
        public int Touches;

        public Task<UserSession?> FindActiveAsync(string token, DateTime now, CancellationToken ct = default) =>
            // Mirrors the real query: expiry is part of the FILTER, because the
            // TTL monitor leaves dead documents lying around for up to a minute.
            Task.FromResult(Rows.FirstOrDefault(s => s.Id == token && s.ExpiresAt > now));

        public Task<UserSession> CreateAsync(UserSession session, CancellationToken ct = default)
        {
            Rows.Add(session);
            return Task.FromResult(session);
        }

        public Task TouchAsync(string token, DateTime seen, DateTime expires, CancellationToken ct = default)
        {
            Touches++;
            var i = Rows.FindIndex(s => s.Id == token);
            if (i >= 0) Rows[i] = Rows[i] with { LastSeenAt = seen, ExpiresAt = expires };
            return Task.CompletedTask;
        }

        public Task DeleteAsync(string token, CancellationToken ct = default)
        {
            Rows.RemoveAll(s => s.Id == token);
            return Task.CompletedTask;
        }

        public Task<long> DeleteAllForUserAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult((long)Rows.RemoveAll(s => s.UserId == userId));

        public Task<long> ReassignUserAsync(Guid from, Guid to, CancellationToken ct = default)
        {
            long n = 0;
            for (var i = 0; i < Rows.Count; i++)
                if (Rows[i].UserId == from) { Rows[i] = Rows[i] with { UserId = to }; n++; }
            return Task.FromResult(n);
        }

        public Task EnsureIndexesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FakeIdentities : IGoogleIdentityRepository
    {
        public readonly List<GoogleIdentity> Rows = [];
        public Task<GoogleIdentity?> FindByGoogleSubAsync(string sub, CancellationToken ct = default) =>
            Task.FromResult(Rows.FirstOrDefault(r => r.GoogleSub == sub));
        public Task<GoogleIdentity?> GetAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult(Rows.FirstOrDefault(r => r.Id == userId));
        public Task<bool> TryLinkAsync(GoogleIdentity i, CancellationToken ct = default)
        { Rows.Add(i); return Task.FromResult(true); }
        public Task EnsureIndexesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private static SessionIdentityResolver Build(
        FakeSessions sessions, FakeIdentities? identities = null, bool acceptLegacy = true) =>
        new(sessions,
            identities ?? new FakeIdentities(),
            Options.Create(new IdentityOptions
            {
                Mode = IdentityMode.Cookie,
                AcceptLegacyGuidCookie = acceptLegacy,
                SessionLifetimeDays = 365,
            }),
            NullLogger<SessionIdentityResolver>.Instance);

    // ---- The property the whole phase exists for --------------------------

    [Fact]
    public async Task Presenting_a_userId_does_not_grant_access_to_it()
    {
        // The pre-sessions hole: uid=<someone's guid> was full access. With the
        // grace path off, a bare userId is just an unusable cookie.
        var sessions = new FakeSessions();

        var result = await Build(sessions, acceptLegacy: false)
            .ResolveAsync(Alice.ToString());

        Assert.NotEqual(Alice, result.UserId);
        Assert.NotNull(result.TokenToIssue);   // treated as a first visit
    }

    [Fact]
    public async Task A_forged_or_unknown_token_is_treated_as_a_first_visit_not_an_error()
    {
        var sessions = new FakeSessions();

        var result = await Build(sessions).ResolveAsync("not-a-real-token");

        Assert.NotNull(result.TokenToIssue);
        Assert.Equal(result.UserId, Assert.Single(sessions.Rows).UserId);
    }

    [Fact]
    public async Task An_issued_token_carries_no_trace_of_the_user()
    {
        var sessions = new FakeSessions();

        var result = await Build(sessions).ResolveAsync(null);

        var token = result.TokenToIssue!;
        Assert.DoesNotContain(result.UserId.ToString(), token);
        Assert.DoesNotContain(result.UserId.ToString("N"), token);
        Assert.True(token.Length >= 40);   // 32 bytes base64url
    }

    // ---- Ordinary resolution ---------------------------------------------

    [Fact]
    public async Task A_live_session_resolves_to_its_user_and_is_not_reissued()
    {
        var sessions = new FakeSessions();
        sessions.Rows.Add(new UserSession
        {
            Id = "tok", UserId = Alice,
            ExpiresAt = DateTime.UtcNow.AddDays(365), LastSeenAt = DateTime.UtcNow,
        });

        var result = await Build(sessions).ResolveAsync("tok");

        Assert.Equal(Alice, result.UserId);
        Assert.Null(result.TokenToIssue);   // no pointless Set-Cookie per request
        Assert.Equal(0, sessions.Touches);  // fresh expiry, no write
    }

    [Fact]
    public async Task An_expired_session_is_rejected_even_though_the_row_is_still_there()
    {
        // Mongo's TTL monitor runs about once a minute, so the collection
        // genuinely contains dead sessions. Expiry has to be enforced by the
        // read, not by trusting the index to have swept.
        var sessions = new FakeSessions();
        sessions.Rows.Add(new UserSession
        {
            Id = "stale", UserId = Alice, ExpiresAt = DateTime.UtcNow.AddMinutes(-1),
        });

        var result = await Build(sessions).ResolveAsync("stale");

        Assert.NotEqual(Alice, result.UserId);
        Assert.NotNull(result.TokenToIssue);
    }

    [Fact]
    public async Task A_stale_session_slides_forward_but_a_fresh_one_does_not()
    {
        var sessions = new FakeSessions();
        sessions.Rows.Add(new UserSession
        {
            Id = "old", UserId = Alice,
            ExpiresAt = DateTime.UtcNow.AddDays(100),   // well inside the window
            LastSeenAt = DateTime.UtcNow.AddDays(-30),
        });

        var result = await Build(sessions).ResolveAsync("old");

        Assert.Equal(Alice, result.UserId);
        Assert.Equal(1, sessions.Touches);              // extended
        Assert.True(sessions.Rows[0].ExpiresAt > DateTime.UtcNow.AddDays(300));
    }

    // ---- The cutover ------------------------------------------------------

    [Fact]
    public async Task A_pre_sessions_cookie_keeps_its_account_and_gets_a_real_session()
    {
        // Without this every existing visitor is orphaned on deploy.
        var sessions = new FakeSessions();

        var result = await Build(sessions).ResolveAsync(Bob.ToString());

        Assert.Equal(Bob, result.UserId);           // same account, not a new one
        Assert.NotNull(result.TokenToIssue);        // cookie replaced
        Assert.NotEqual(Bob.ToString(), result.TokenToIssue);
        Assert.True(Assert.Single(sessions.Rows).FromLegacyCookie);  // measurable
    }

    [Fact]
    public async Task A_linked_account_is_never_reachable_by_presenting_its_userId()
    {
        // The grace path necessarily re-opens the old hole for anonymous
        // accounts, whose ids are unguessable. It must NOT do so for an account
        // someone can prove they own — and least of all for a ClaimUserId
        // target, which is typically a hand-written value like Alice's.
        var sessions = new FakeSessions();
        var identities = new FakeIdentities();
        identities.Rows.Add(new GoogleIdentity { Id = Alice, GoogleSub = "sub-alice" });

        var result = await Build(sessions, identities).ResolveAsync(Alice.ToString());

        Assert.NotEqual(Alice, result.UserId);
        Assert.False(Assert.Single(sessions.Rows).FromLegacyCookie);
    }

    [Fact]
    public async Task Turning_the_grace_path_off_closes_it_for_unlinked_accounts_too()
    {
        var sessions = new FakeSessions();

        var result = await Build(sessions, acceptLegacy: false).ResolveAsync(Bob.ToString());

        Assert.NotEqual(Bob, result.UserId);
    }

    [Theory]
    [InlineData("00000000-0000-0000-0000-000000000000")]  // Guid.Empty is not an account
    [InlineData("11111111-1111-1111-1111")]               // not a Guid at all
    [InlineData("")]
    public async Task A_junk_or_empty_cookie_is_a_first_visit(string cookie)
    {
        var sessions = new FakeSessions();

        var result = await Build(sessions).ResolveAsync(cookie);

        Assert.NotEqual(Guid.Empty, result.UserId);
        Assert.NotNull(result.TokenToIssue);
    }

    // ---- Sign-out and repointing ------------------------------------------

    [Fact]
    public async Task A_deleted_session_stops_resolving_immediately()
    {
        // Sign-out deletes server-side. Clearing only the cookie would leave a
        // live token that still works for anyone holding a copy.
        var sessions = new FakeSessions();
        var resolver = Build(sessions);
        var issued = (await resolver.ResolveAsync(null)).TokenToIssue!;

        await sessions.DeleteAsync(issued);
        var after = await resolver.ResolveAsync(issued);

        Assert.NotEqual(sessions.Rows[0].UserId, Guid.Empty);
        Assert.NotNull(after.TokenToIssue);   // a first visit again
    }

    [Fact]
    public async Task Repointing_a_user_moves_their_other_devices_without_logging_them_out()
    {
        // What makes the Phase 1.6 merge possible: a self-describing cookie
        // could never be repointed, so every other device would have to be
        // signed out instead.
        var sessions = new FakeSessions();
        var resolver = Build(sessions);
        var phone = (await resolver.ResolveAsync(null)).TokenToIssue!;
        var anonId = sessions.Rows.Single(s => s.Id == phone).UserId;

        await sessions.ReassignUserAsync(anonId, Alice);
        var after = await resolver.ResolveAsync(phone);

        Assert.Equal(Alice, after.UserId);
        Assert.Null(after.TokenToIssue);   // same token, still valid
    }
}
