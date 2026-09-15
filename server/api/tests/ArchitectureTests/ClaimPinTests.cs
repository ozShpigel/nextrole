using ApplicationTracker.Api.Identity;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using Microsoft.Extensions.Logging.Abstractions;

namespace ArchitectureTests;

/// <summary>
/// The one-shot claim is pinned to a named, Google-verified account.
/// </summary>
/// <remarks>
/// Without the pin, <c>Google:ClaimUserId</c> grants an entire account to
/// whoever signs in first — so a value left in a production env file is a live
/// grenade, and "remember not to set it" is not a control. With the pin, a
/// forgotten value is inert to everyone except the person it names.
///
/// The verification flag is checked separately from the address. An email
/// Google has not verified is one nobody has proved they own, and matching on
/// it would let an attacker claim the account by asserting the right string.
/// </remarks>
public class ClaimPinTests
{
    private static readonly Guid PreAuth = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Visitor = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private const string Owner = "owner@example.com";

    private sealed class FakeIdentities : IGoogleIdentityRepository
    {
        public readonly List<GoogleIdentity> Rows = [];
        public Task<GoogleIdentity?> FindByGoogleSubAsync(string sub, CancellationToken ct = default) =>
            Task.FromResult(Rows.FirstOrDefault(r => r.GoogleSub == sub));
        public Task<GoogleIdentity?> GetAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult(Rows.FirstOrDefault(r => r.Id == userId));
        public Task<bool> TryLinkAsync(GoogleIdentity i, CancellationToken ct = default)
        {
            if (Rows.Any(r => r.Id == i.Id || r.GoogleSub == i.GoogleSub)) return Task.FromResult(false);
            Rows.Add(i);
            return Task.FromResult(true);
        }
        public Task EnsureIndexesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private static GoogleSignInResolver Build(FakeIdentities repo, string? claimEmail = Owner) =>
        new(repo,
            new GoogleAuthOptions
            {
                ClientId = "id",
                ClientSecret = "secret",
                ClaimUserId = PreAuth.ToString(),
                ClaimEmail = claimEmail,
                // Far future: these tests are about WHO may claim, not when.
                // Expiry is ClaimExpiryTests.
                ClaimExpiresAt = "2099-01-01",
            },
            NullLogger<GoogleSignInResolver>.Instance);

    // Startup validation (all three parts, or none) lives in ClaimExpiryTests,
    // which covers every partial combination rather than a sample of them.

    // ---- The pin -----------------------------------------------------------

    [Fact]
    public async Task The_named_account_takes_the_claim()
    {
        var repo = new FakeIdentities();

        var result = await Build(repo).ResolveAsync(Visitor, "sub-owner", Owner, emailVerified: true);

        Assert.Equal(GoogleSignInOutcome.Claimed, result.Outcome);
        Assert.Equal(PreAuth, result.UserId);
        Assert.True(Assert.Single(repo.Rows).ViaClaim);
    }

    [Fact]
    public async Task A_stranger_arriving_first_gets_their_own_empty_account()
    {
        // The whole point. Before the pin, this signed the stranger into the
        // pre-auth account and handed over its entire history.
        var repo = new FakeIdentities();

        var result = await Build(repo).ResolveAsync(Visitor, "sub-stranger", "someone@else.com", true);

        Assert.Equal(GoogleSignInOutcome.SignedIn, result.Outcome);
        Assert.Equal(Visitor, result.UserId);          // their own id, not PreAuth
        Assert.Equal(Visitor, Assert.Single(repo.Rows).Id);
        Assert.False(repo.Rows[0].ViaClaim);
    }

    [Fact]
    public async Task The_claim_survives_a_stranger_and_is_still_there_for_its_owner()
    {
        // A refused attempt must not consume the claim — otherwise anyone could
        // disarm it by signing in once, and the real migration would silently
        // stop working.
        var repo = new FakeIdentities();
        var resolver = Build(repo);

        await resolver.ResolveAsync(Visitor, "sub-stranger", "someone@else.com", true);
        var owner = await resolver.ResolveAsync(
            Guid.NewGuid(), "sub-owner", Owner, emailVerified: true);

        Assert.Equal(GoogleSignInOutcome.Claimed, owner.Outcome);
        Assert.Equal(PreAuth, owner.UserId);
    }

    [Fact]
    public async Task The_address_is_matched_case_insensitively()
    {
        // Google may echo a different case than the operator typed into config.
        // Failing the migration over capitalisation would be a poor trade.
        var repo = new FakeIdentities();

        var result = await Build(repo, claimEmail: "Owner@Example.COM")
            .ResolveAsync(Visitor, "sub-owner", "owner@example.com", true);

        Assert.Equal(GoogleSignInOutcome.Claimed, result.Outcome);
    }

    [Fact]
    public async Task Surrounding_whitespace_in_config_does_not_break_the_pin()
    {
        var repo = new FakeIdentities();

        var result = await Build(repo, claimEmail: "  owner@example.com  ")
            .ResolveAsync(Visitor, "sub-owner", Owner, true);

        Assert.Equal(GoogleSignInOutcome.Claimed, result.Outcome);
    }

    // ---- Verification is required, not just a matching string --------------

    [Fact]
    public async Task An_unverified_address_cannot_take_the_claim_even_when_it_matches()
    {
        // The attack the flag exists for: assert the owner's address on an
        // account Google has not verified, and walk off with the history.
        var repo = new FakeIdentities();

        var result = await Build(repo).ResolveAsync(Visitor, "sub-impostor", Owner, emailVerified: false);

        Assert.Equal(GoogleSignInOutcome.SignedIn, result.Outcome);
        Assert.Equal(Visitor, result.UserId);
        Assert.False(Assert.Single(repo.Rows).ViaClaim);
    }

    [Fact]
    public async Task An_unverified_address_is_not_stored_at_all()
    {
        // It must not be shown back as though it were confirmed.
        var repo = new FakeIdentities();

        await Build(repo).ResolveAsync(Visitor, "sub-impostor", Owner, emailVerified: false);

        Assert.Equal("", Assert.Single(repo.Rows).Email);
    }

    [Fact]
    public async Task A_null_email_does_not_match_an_empty_claim_configuration()
    {
        // Guards the degenerate case: if both sides ended up empty, an
        // ordinary-string comparison would call them equal and arm the claim
        // for everybody.
        var repo = new FakeIdentities();

        var result = await Build(repo, claimEmail: "").ResolveAsync(Visitor, "sub-any", null, false);

        Assert.Equal(GoogleSignInOutcome.SignedIn, result.Outcome);
        Assert.Equal(Visitor, result.UserId);
    }
}
