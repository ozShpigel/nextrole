using ApplicationTracker.Api.Identity;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using Microsoft.Extensions.Logging.Abstractions;

namespace ArchitectureTests;

/// <summary>
/// The one-shot claim expires on a date, and the API refuses to start once it
/// has.
/// </summary>
/// <remarks>
/// The rejected alternative was a startup check reading whether the target
/// already had a link. That guard depends on database state, so deleting the
/// link — which account deletion would do — makes it stop failing and silently
/// re-arms the claim. A guard that fails open on an unrelated feature is not a
/// guard. A date cannot be un-passed by anything happening in the database.
///
/// Expiry is enforced twice on purpose: at startup, and again on every claim
/// attempt. A container that booted before the deadline and is not redeployed
/// for months is precisely the case the deadline exists to end.
/// </remarks>
public class ClaimExpiryTests
{
    private static readonly Guid PreAuth = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Visitor = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private const string Owner = "owner@example.com";

    private static readonly DateTime Expiry = new(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);

    private static GoogleAuthOptions Options(
        string? id = null, string? email = Owner, string? expires = "2026-10-01") => new()
        {
            ClientId = "id",
            ClientSecret = "secret",
            ClaimUserId = id ?? PreAuth.ToString(),
            ClaimEmail = email,
            ClaimExpiresAt = expires,
        };

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

    // ---- All three or none -------------------------------------------------

    [Theory]
    [InlineData("11111111-1111-1111-1111-111111111111", null, null)]
    [InlineData(null, Owner, null)]
    [InlineData(null, null, "2026-10-01")]
    [InlineData("11111111-1111-1111-1111-111111111111", Owner, null)]
    [InlineData("11111111-1111-1111-1111-111111111111", null, "2026-10-01")]
    [InlineData(null, Owner, "2026-10-01")]
    public void Any_partial_configuration_refuses_to_start(string? id, string? email, string? expires)
    {
        var options = new GoogleAuthOptions { ClaimUserId = id, ClaimEmail = email, ClaimExpiresAt = expires };

        var ex = Assert.Throws<InvalidOperationException>(() => options.Validate());
        Assert.Contains("half-configured", ex.Message);
    }

    [Fact]
    public void No_claim_at_all_is_valid()
    {
        new GoogleAuthOptions().Validate();
    }

    [Fact]
    public void A_complete_unexpired_claim_is_valid()
    {
        Options().Validate(utcNow: Expiry.AddDays(-1));
    }

    // ---- Expiry at startup -------------------------------------------------

    [Fact]
    public void An_expired_claim_refuses_to_start()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => Options().Validate(utcNow: Expiry.AddSeconds(1)));

        Assert.Contains("expired", ex.Message);
        // Names the lines to remove, rather than leaving the operator to guess.
        Assert.Contains("Google:ClaimUserId", ex.Message);
        Assert.Contains("Google:ClaimEmail", ex.Message);
        Assert.Contains("Google:ClaimExpiresAt", ex.Message);
    }

    [Fact]
    public void The_boundary_is_exclusive_the_instant_it_expires_it_is_expired()
    {
        // Exactly at the deadline counts as expired. A claim that lingers "just
        // this millisecond" is the same argument as "just this once".
        Assert.Throws<InvalidOperationException>(() => Options().Validate(utcNow: Expiry));

        // One tick earlier is still live.
        Options().Validate(utcNow: Expiry.AddTicks(-1));
    }

    // ---- Strict parsing ----------------------------------------------------

    [Theory]
    [InlineData("2026-10-01")]
    [InlineData("2026-10-01T00:00:00")]
    [InlineData("2026-10-01T00:00:00Z")]
    public void Accepted_formats_all_mean_the_same_utc_instant(string value)
    {
        // A bare date is midnight UTC, not midnight wherever the server sits —
        // otherwise the same config expires at different moments per region.
        Assert.True(Options(expires: value).TryGetClaimExpiry(out var parsed));
        Assert.Equal(Expiry, parsed);
        Assert.Equal(DateTimeKind.Utc, parsed.Kind);
    }

    [Theory]
    [InlineData("soon")]
    [InlineData("01/10/2026")]          // ambiguous: locale decides day vs month
    [InlineData("2026-13-01")]
    [InlineData("")]
    [InlineData("   ")]
    public void An_unparseable_expiry_refuses_to_start_rather_than_defaulting(string value)
    {
        var options = new GoogleAuthOptions
        {
            ClaimUserId = PreAuth.ToString(), ClaimEmail = Owner, ClaimExpiresAt = value,
        };

        // Blank counts as "not set", so it lands on the half-configured message;
        // anything else is a parse failure. Either way the process refuses to
        // start, which is the property being asserted.
        Assert.Throws<InvalidOperationException>(() => options.Validate());
    }

    [Fact]
    public void An_ambiguous_date_is_never_silently_reinterpreted()
    {
        // The specific failure this guards: a lenient parse reads 01/10/2026 as
        // 10 January under one culture and 1 October under another, and this
        // value decides when a takeover window closes.
        Assert.False(Options(expires: "01/10/2026").TryGetClaimExpiry(out _));
    }

    // ---- Expiry at runtime, not only at boot -------------------------------

    [Fact]
    public void A_live_claim_arms()
    {
        Assert.True(Options().TryGetClaim(Expiry.AddDays(-1), out var target, out var email));
        Assert.Equal(PreAuth, target);
        Assert.Equal(Owner, email);
    }

    [Fact]
    public void An_expired_claim_does_not_arm_even_in_a_process_that_booted_before_it()
    {
        // The long-running container case. Startup validation passed months
        // ago; this is what stops the claim outliving its deadline anyway.
        Assert.False(Options().TryGetClaim(Expiry.AddSeconds(1), out _, out _));
    }

    [Fact]
    public async Task The_named_owner_is_turned_away_after_the_deadline()
    {
        // End to end through the resolver: even the right person, with a
        // verified address, gets an ordinary account once the claim is over.
        var repo = new FakeIdentities();
        var resolver = new GoogleSignInResolver(
            repo, Options(expires: "2020-01-01"), NullLogger<GoogleSignInResolver>.Instance);

        var result = await resolver.ResolveAsync(Visitor, "sub-owner", Owner, emailVerified: true);

        Assert.Equal(GoogleSignInOutcome.SignedIn, result.Outcome);
        Assert.Equal(Visitor, result.UserId);
        Assert.False(Assert.Single(repo.Rows).ViaClaim);
    }

    [Fact]
    public async Task The_named_owner_is_let_through_before_the_deadline()
    {
        var repo = new FakeIdentities();
        var resolver = new GoogleSignInResolver(
            repo, Options(expires: "2099-01-01"), NullLogger<GoogleSignInResolver>.Instance);

        var result = await resolver.ResolveAsync(Visitor, "sub-owner", Owner, emailVerified: true);

        Assert.Equal(GoogleSignInOutcome.Claimed, result.Outcome);
        Assert.Equal(PreAuth, result.UserId);
    }
}
