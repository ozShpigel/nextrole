using ApplicationTracker.Api.Identity;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace ArchitectureTests;

/// <summary>
/// A service client whose credential does not resolve is refused, instead of
/// being handed a freshly minted account.
/// </summary>
/// <remarks>
/// The failure this prevents has shipped three times (AGENTS.md): the API
/// answers an identity it cannot resolve by minting a fresh user, so the write
/// returns 2xx and lands under a userId nobody holds. Issue #67 is the clearest
/// case — the mailbot synced an empty account and reported
/// <c>{"Success":true}</c> with 115 applications in the database.
///
/// The distinction is NOT anonymous vs registered. It is browser vs service
/// client: an unusable cookie really should look like a first visit to a
/// person, and really should be a hard error to a daemon. So these tests come
/// in pairs — each refusal is matched by a browser case that must still mint.
/// </remarks>
public class ServiceIdentityRefusalTests
{
    private static readonly Guid Alice = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private sealed class FakeSessions : IUserSessionRepository
    {
        public readonly List<UserSession> Rows = [];

        public Task<UserSession?> FindActiveAsync(string token, DateTime now, CancellationToken ct = default) =>
            Task.FromResult(Rows.FirstOrDefault(s => s.Id == token && s.ExpiresAt > now));

        public Task<UserSession> CreateAsync(UserSession session, CancellationToken ct = default)
        {
            Rows.Add(session);
            return Task.FromResult(session);
        }

        public Task TouchAsync(string token, DateTime seen, DateTime expires, CancellationToken ct = default) =>
            Task.CompletedTask;

        public Task DeleteAsync(string token, CancellationToken ct = default)
        {
            Rows.RemoveAll(s => s.Id == token);
            return Task.CompletedTask;
        }

        public Task<long> DeleteAllForUserAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult((long)Rows.RemoveAll(s => s.UserId == userId));

        public Task<long> ReassignUserAsync(Guid from, Guid to, CancellationToken ct = default) =>
            Task.FromResult(0L);

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

    /// <summary>
    /// The middleware under test, wired the way Program.cs wires it, with a
    /// terminal handler that records whether the request got through.
    /// </summary>
    private static async Task<(int Status, string? ContentType, bool ReachedHandler, Guid? SeenUserId)>
        Send(FakeSessions sessions, string? cookie, string? sourceHeader, bool handlerNeedsUser = true)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(Options.Create(new IdentityOptions
        {
            Mode = IdentityMode.Cookie,
            AcceptLegacyGuidCookie = false,
            SessionLifetimeDays = 365,
        }));
        services.AddSingleton<IUserSessionRepository>(sessions);
        services.AddSingleton<IGoogleIdentityRepository, FakeIdentities>();
        services.AddSingleton<SessionIdentityResolver>();
        services.AddSingleton<IdentityResolver>();
        var provider = services.BuildServiceProvider();

        var app = new ApplicationBuilder(provider);
        app.UseUserIdentityCookie();

        var reached = false;
        Guid? seen = null;
        app.Run(ctx =>
        {
            reached = true;
            // The distinction the whole design now rests on: a handler that
            // reads IUserContext needs a user, one that does not is
            // user-independent and must be left alone.
            if (handlerNeedsUser)
                seen = provider.GetRequiredService<IdentityResolver>().Resolve(ctx);
            return Task.CompletedTask;
        });
        var pipeline = app.Build();

        var ctx = new DefaultHttpContext { RequestServices = provider };
        ctx.Request.Method = "POST";
        ctx.Request.Path = "/api/applications";
        if (cookie is not null) ctx.Request.Headers.Cookie = $"uid={cookie}";
        if (sourceHeader is not null) ctx.Request.Headers["X-Source"] = sourceHeader;
        ctx.Response.Body = new MemoryStream();

        await pipeline(ctx);
        return (ctx.Response.StatusCode, ctx.Response.ContentType, reached, seen);
    }

    // ---- The refusal ------------------------------------------------------

    [Theory]
    [InlineData("ingest")]   // the scraper
    [InlineData("mailbot")]  // issue #67
    public async Task A_service_client_with_no_credential_is_refused_not_minted(string source)
    {
        var sessions = new FakeSessions();

        var (status, contentType, _, seen) = await Send(sessions, cookie: null, sourceHeader: source);

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
        Assert.Equal("application/json", contentType);
        // The handler runs but never learns who it is for, so it cannot write
        // under a minted id. Refusing before the handler would also refuse the
        // user-independent calls -- see the regression tests above.
        Assert.Null(seen);
    }

    [Fact]
    public async Task A_service_client_with_an_expired_or_forged_token_is_refused()
    {
        var sessions = new FakeSessions();

        var (status, _, _, seen) = await Send(sessions, cookie: "not-a-real-token", sourceHeader: "mailbot");

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
        Assert.Null(seen);
    }

    [Fact]
    public async Task A_service_client_presenting_a_raw_userId_is_refused()
    {
        // The exact shape of the second scraper incident: sending the resolved
        // Guid instead of the opaque token. It used to mint; now it is a 401.
        var sessions = new FakeSessions();

        var (status, _, _, seen) = await Send(sessions, cookie: Alice.ToString(), sourceHeader: "ingest");

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
        Assert.Null(seen);
    }

    // ---- The regression this cost us ---------------------------------------

    [Fact]
    public async Task A_user_independent_call_from_a_service_client_is_NOT_refused()
    {
        // job-facts and job-parse read no profile and score nothing: they act
        // as nobody, by design, and present no credential because none applies.
        //
        // The first version of this refusal turned them into 401s. The daily
        // ingest stored 60 pool jobs with no extracted requirements and
        // reported `completed`, because a failed extraction is "retry next
        // run" rather than an error. Two runs before, the same path extracted
        // 94 of 94.
        var sessions = new FakeSessions();

        var (status, _, reached, _) = await Send(
            sessions, cookie: null, sourceHeader: "ingest", handlerNeedsUser: false);

        Assert.Equal(StatusCodes.Status200OK, status);
        Assert.True(reached, "a handler that needs no user must run");
    }

    [Fact]
    public async Task The_refusal_still_fires_when_the_handler_asks_who_it_is()
    {
        // Same request as above; the only difference is that the handler reads
        // IUserContext. That is what makes the refusal structural rather than a
        // list of routes someone has to maintain.
        var sessions = new FakeSessions();

        var (status, contentType, _, seen) = await Send(
            sessions, cookie: null, sourceHeader: "ingest", handlerNeedsUser: true);

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
        Assert.Equal("application/json", contentType);
        Assert.Null(seen);   // it never got an answer
    }

    // ---- What must NOT change ---------------------------------------------

    [Fact]
    public async Task A_service_client_with_a_good_session_is_let_through_as_that_user()
    {
        var sessions = new FakeSessions();
        sessions.Rows.Add(new UserSession
        {
            Id = "good-token",
            UserId = Alice,
            IssuedAt = DateTime.UtcNow,
            LastSeenAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(30),
        });

        var (status, _, reached, seen) = await Send(sessions, cookie: "good-token", sourceHeader: "mailbot");

        Assert.Equal(StatusCodes.Status200OK, status);
        Assert.True(reached);
        Assert.Equal(Alice, seen);
    }

    [Fact]
    public async Task A_browser_with_no_cookie_still_gets_a_fresh_identity()
    {
        // Anonymous use needs no account. Refusing here would break the product.
        var sessions = new FakeSessions();

        var (status, _, reached, seen) = await Send(sessions, cookie: null, sourceHeader: null);

        Assert.Equal(StatusCodes.Status200OK, status);
        Assert.True(reached);
        Assert.NotNull(seen);
        Assert.NotEqual(Guid.Empty, seen);
    }

    [Fact]
    public async Task A_browser_with_an_unusable_cookie_still_looks_like_a_first_visit()
    {
        var sessions = new FakeSessions();

        var (status, _, reached, seen) = await Send(sessions, cookie: "stale", sourceHeader: null);

        Assert.Equal(StatusCodes.Status200OK, status);
        Assert.True(reached);
        Assert.NotEqual(Guid.Empty, seen);
    }

    // ---- The flag the refusal keys on -------------------------------------

    [Fact]
    public async Task Minted_marks_a_brand_new_identity_and_only_that()
    {
        var sessions = new FakeSessions();
        var resolver = new SessionIdentityResolver(
            sessions,
            new FakeIdentities(),
            Options.Create(new IdentityOptions
            {
                Mode = IdentityMode.Cookie,
                AcceptLegacyGuidCookie = true,
                SessionLifetimeDays = 365,
            }),
            NullLogger<SessionIdentityResolver>.Instance);

        // A first visit mints.
        Assert.True((await resolver.ResolveAsync(null)).Minted);

        // A legacy cookie also issues a token, but resolves a REAL pre-existing
        // account -- so it must not be marked minted, or upgrading a
        // pre-sessions service client would be refused for the wrong reason.
        var legacy = await resolver.ResolveAsync(Alice.ToString());
        Assert.Equal(Alice, legacy.UserId);
        Assert.NotNull(legacy.TokenToIssue);
        Assert.False(legacy.Minted);

        // A live session neither issues nor mints.
        var live = await resolver.ResolveAsync(legacy.TokenToIssue!);
        Assert.Equal(Alice, live.UserId);
        Assert.False(live.Minted);
    }
}
