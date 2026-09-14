using System.Security.Cryptography;
using System.Text;
using ApplicationTracker.Api.Identity;

namespace ArchitectureTests;

/// <summary>
/// The OAuth callback's rejection rules: state mismatch, replay, and a missing
/// or malformed flow cookie.
/// </summary>
/// <remarks>
/// These are the three places OAuth implementations actually go wrong, and
/// until now the only thing standing behind them was one manual click through
/// a live consent screen. They are asserted against the same OAuthFlow the
/// endpoint calls, so the rules and the running code cannot drift apart —
/// what remains uncovered is only the wiring, not the logic.
/// </remarks>
public class OAuthFlowTests
{
    // Stands in for the browser's cookie jar: what Write leaves behind is what
    // Read returns, and Clear is what a Set-Cookie deletion does.
    private sealed class FakeCookieStore : IFlowCookieStore
    {
        public string? Value;
        public int Clears;

        public string? Read() => Value;
        public void Write(string value, TimeSpan lifetime) => Value = value;
        public void Clear() { Value = null; Clears++; }
    }

    private static FakeCookieStore StoreHolding(string? raw) => new() { Value = raw };

    // ---- The flow round-trips --------------------------------------------

    [Fact]
    public void A_begun_flow_survives_the_round_trip_through_the_cookie()
    {
        var store = new FakeCookieStore();
        var issued = OAuthFlow.Begin(store);

        var consumed = OAuthFlow.Consume(store);

        Assert.NotNull(consumed);
        Assert.Equal(issued.State, consumed!.State);
        Assert.Equal(issued.Verifier, consumed.Verifier);
        Assert.True(OAuthFlow.StateMatches(consumed, issued.State));
    }

    [Fact]
    public void The_state_and_verifier_are_distinct_unguessable_values()
    {
        var a = OAuthFlow.Begin(new FakeCookieStore());
        var b = OAuthFlow.Begin(new FakeCookieStore());

        Assert.NotEqual(a.State, a.Verifier);   // reusing one as the other would leak the PKCE secret
        Assert.NotEqual(a.State, b.State);      // not a counter or a constant
        Assert.NotEqual(a.Verifier, b.Verifier);
        Assert.True(a.State.Length >= 40);      // 32 bytes base64url, unpadded
    }

    [Fact]
    public void The_code_challenge_is_the_S256_hash_of_the_verifier()
    {
        // Pins PKCE itself: send the verifier where the challenge belongs and
        // the protection is gone, but the flow still appears to work.
        var flow = OAuthFlow.Begin(new FakeCookieStore());

        var expected = Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(flow.Verifier)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        Assert.Equal(expected, flow.CodeChallenge);
        Assert.NotEqual(flow.Verifier, flow.CodeChallenge);
        Assert.DoesNotContain('=', flow.CodeChallenge);   // base64url, unpadded
        Assert.DoesNotContain('+', flow.CodeChallenge);
        Assert.DoesNotContain('/', flow.CodeChallenge);
    }

    // ---- Replay -----------------------------------------------------------

    [Fact]
    public void A_replayed_callback_finds_nothing_because_the_flow_is_single_use()
    {
        var store = new FakeCookieStore();
        OAuthFlow.Begin(store);

        var first = OAuthFlow.Consume(store);
        var second = OAuthFlow.Consume(store);

        Assert.NotNull(first);
        Assert.Null(second);   // the endpoint's `flow is null` check rejects this
    }

    [Fact]
    public void A_failed_attempt_still_burns_the_flow()
    {
        // Clearing only on success would leave a failed attempt's state
        // replayable — the more useful one to an attacker, since a failure is
        // exactly what they would be probing with.
        var store = StoreHolding("no-separator-here");

        Assert.Null(OAuthFlow.Consume(store));
        Assert.Null(store.Value);
        Assert.Equal(1, store.Clears);
    }

    [Fact]
    public void Consuming_clears_before_validating_not_after()
    {
        var store = StoreHolding(null);

        OAuthFlow.Consume(store);

        // Even with nothing to read, the deletion is issued — the endpoint
        // must never leave a stale flow cookie behind on any path.
        Assert.Equal(1, store.Clears);
    }

    // ---- Missing / malformed cookie ---------------------------------------

    [Theory]
    [InlineData(null)]              // no cookie at all — the replay case, and a direct hit on /callback
    [InlineData("")]                // present but empty
    [InlineData("statewithnodot")]  // no separator
    [InlineData(".verifieronly")]   // empty state
    [InlineData("stateonly.")]      // empty verifier
    public void A_missing_or_malformed_flow_cookie_yields_no_flow(string? raw)
    {
        Assert.Null(OAuthFlow.Consume(StoreHolding(raw)));
    }

    [Fact]
    public void A_verifier_containing_the_separator_still_round_trips()
    {
        // Split on the FIRST separator only. Tokens are base64url so a dot
        // cannot occur today, but a split-on-all would silently truncate the
        // verifier if the alphabet ever changed, and PKCE would fail with a
        // useless error from Google rather than here.
        var store = StoreHolding("thestate.part1.part2");

        var flow = OAuthFlow.Consume(store);

        Assert.NotNull(flow);
        Assert.Equal("thestate", flow!.State);
        Assert.Equal("part1.part2", flow.Verifier);
    }

    // ---- State mismatch ---------------------------------------------------

    [Fact]
    public void The_state_google_echoes_back_must_match_the_one_we_issued()
    {
        var flow = OAuthFlow.Begin(new FakeCookieStore());

        Assert.True(OAuthFlow.StateMatches(flow, flow.State));
        Assert.False(OAuthFlow.StateMatches(flow, flow.State + "x"));
        Assert.False(OAuthFlow.StateMatches(flow, flow.State.ToUpperInvariant()));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("attacker-chosen-state")]
    public void A_wrong_or_absent_state_is_rejected(string? provided)
    {
        // The CSRF case: a forged callback carries a state we never issued, so
        // it must not be allowed to sign anybody in.
        var flow = OAuthFlow.Begin(new FakeCookieStore());

        Assert.False(OAuthFlow.StateMatches(flow, provided));
    }

    [Fact]
    public void A_state_that_only_prefixes_the_real_one_is_rejected()
    {
        // FixedTimeEquals compares lengths first, so this is really a guard
        // against anyone later "simplifying" it into a StartsWith or a
        // truncating comparison.
        var flow = OAuthFlow.Begin(new FakeCookieStore());

        Assert.False(OAuthFlow.StateMatches(flow, flow.State[..10]));
        Assert.False(OAuthFlow.StateMatches(flow, flow.State[..^1]));
    }
}
