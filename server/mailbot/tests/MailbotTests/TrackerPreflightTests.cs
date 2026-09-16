using Mailbot.Services;

namespace MailbotTests;

/// <summary>
/// "The API answered" and "the API answered as the right user" must not be the
/// same answer.
/// </summary>
/// <remarks>
/// A Cookie-mode tracker mints a fresh anonymous user for an identity it cannot
/// resolve, then answers normally. So the mailbot pointed at nextrole.cloud
/// with no session token got a 200, an empty application list, and reported
/// {"Success":true} — against 115 real applications. Nothing failed. Two
/// throwaway users were minted and the run looked like a quiet week
/// (issue #67).
///
/// These lock the refusals. The subtlest is NoToken_DoesNotCallMe: asking
/// /api/auth/me without a token would itself mint another throwaway user, so
/// the check has to be skipped, not merely ignored.
/// </remarks>
public class TrackerPreflightTests
{
    private const string Url = "http://api:8080";

    private static Func<CancellationToken, Task<TrackerIdentity?>> Me(TrackerIdentity? identity) =>
        _ => Task.FromResult(identity);

    private static readonly TrackerIdentity SignedIn = new(true, "someone@example.com", true);
    private static readonly TrackerIdentity Anonymous = new(false, null, true);

    [Fact]
    public async Task FixedMode_NeedsNoToken()
    {
        var v = await TrackerPreflight.EvaluateAsync(
            Url, new TrackerConfig(false, "Fixed"), sessionToken: null, Me(null));

        Assert.True(v.Ok);
    }

    [Fact]
    public async Task CookieMode_WithNoToken_Refuses()
    {
        var v = await TrackerPreflight.EvaluateAsync(
            Url, new TrackerConfig(false, "Cookie"), sessionToken: null, Me(SignedIn));

        Assert.Equal(PreflightCode.MissingToken, v.Code);
    }

    [Fact]
    public async Task CookieMode_WithNoToken_DoesNotAskWhoWeAre()
    {
        // Asking would mint ANOTHER throwaway anonymous user, and the answer
        // could not be useful — there is no identity to verify.
        var called = false;

        await TrackerPreflight.EvaluateAsync(
            Url, new TrackerConfig(false, "Cookie"), sessionToken: null,
            _ => { called = true; return Task.FromResult<TrackerIdentity?>(SignedIn); });

        Assert.False(called);
    }

    [Fact]
    public async Task CookieMode_WithGoodToken_Proceeds()
    {
        var v = await TrackerPreflight.EvaluateAsync(
            Url, new TrackerConfig(false, "Cookie"), "a-token", Me(SignedIn));

        Assert.True(v.Ok);
    }

    [Fact]
    public async Task CookieMode_WithGoodToken_ReportsWhichAccount()
    {
        // The point of the whole guard is that the operator can see WHICH
        // account a run acted as. A pass that does not say is not enough: it was
        // dropped once already, in the refactor that created this class.
        var v = await TrackerPreflight.EvaluateAsync(
            Url, new TrackerConfig(false, "Cookie"), "a-token", Me(SignedIn));

        Assert.Equal("someone@example.com", v.Account);
    }

    [Fact]
    public async Task CookieMode_TokenResolvingToAnonymous_Refuses()
    {
        // The exact production failure: the token is dead, so the API minted a
        // fresh user and answered 200 about an empty account.
        var v = await TrackerPreflight.EvaluateAsync(
            Url, new TrackerConfig(false, "Cookie"), "an-expired-token", Me(Anonymous));

        Assert.Equal(PreflightCode.WrongAccount, v.Code);
    }

    [Fact]
    public async Task CookieMode_WhenIdentityCannotBeRead_Refuses()
    {
        var v = await TrackerPreflight.EvaluateAsync(
            Url, new TrackerConfig(false, "Cookie"), "a-token", Me(null));

        Assert.Equal(PreflightCode.IdentityUnreadable, v.Code);
    }

    [Fact]
    public async Task UnknownIdentityMode_IsTreatedAsCookie()
    {
        // An API too old to report identityMode. Assuming Fixed would restore
        // exactly the silent failure this guard exists to stop, so the unknown
        // case must be the strict one.
        var v = await TrackerPreflight.EvaluateAsync(
            Url, new TrackerConfig(false, null), sessionToken: null, Me(SignedIn));

        Assert.Equal(PreflightCode.MissingToken, v.Code);
    }

    [Fact]
    public async Task UnreachableConfig_IsTreatedAsCookie()
    {
        var v = await TrackerPreflight.EvaluateAsync(
            Url, config: null, sessionToken: null, Me(SignedIn));

        Assert.Equal(PreflightCode.MissingToken, v.Code);
    }

    [Fact]
    public async Task DemoMode_RefusesEvenWithAGoodToken()
    {
        var v = await TrackerPreflight.EvaluateAsync(
            Url, new TrackerConfig(true, "Cookie"), "a-token", Me(SignedIn));

        Assert.Equal(PreflightCode.DemoMode, v.Code);
    }

    [Fact]
    public async Task IdentityMode_IsMatchedCaseInsensitively()
    {
        var v = await TrackerPreflight.EvaluateAsync(
            Url, new TrackerConfig(false, "fixed"), sessionToken: null, Me(null));

        Assert.True(v.Ok);
    }
}
