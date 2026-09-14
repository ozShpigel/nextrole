using ApplicationTracker.Api.Identity;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;

namespace ArchitectureTests;

/// <summary>
/// The collision rules and the one-shot claim from docs/auth.md, as tests.
/// </summary>
/// <remarks>
/// These exist because the rules are the part most likely to be "simplified"
/// later into a silent overwrite, and because the claim is the switch that
/// would otherwise hand a whole job history to whoever signs in first. The
/// claim's safety property is not "the config defaults to off" — it is that a
/// consumed claim is dead in code — so that is asserted directly.
/// </remarks>
public class GoogleSignInResolverTests
{
    private static readonly Guid Alice = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Bob = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid Carol = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private sealed class Presence(params Guid[] withData) : IUserDataPresence
    {
        public Task<bool> HasDataAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult(withData.Contains(userId));
    }

    private static GoogleSignInResolver Build(
        FakeIdentities repo, IUserDataPresence presence, Guid? claimTarget = null) =>
        new(repo, presence, new GoogleAuthOptions
        {
            ClientId = "id",
            ClientSecret = "secret",
            ClaimUserId = claimTarget?.ToString(),
        });

    // ---- Collision table ----------------------------------------------------

    [Fact]
    public async Task Known_account_and_an_empty_session_adopts_the_saved_account()
    {
        var repo = new FakeIdentities();
        repo.Rows.Add(new GoogleIdentity { Id = Alice, GoogleSub = "sub-alice" });

        // Bob's cookie is brand new and owns nothing.
        var result = await Build(repo, new Presence()).ResolveAsync(Bob, "sub-alice", "a@x.com");

        Assert.Equal(GoogleSignInOutcome.SignedIn, result.Outcome);
        Assert.Equal(Alice, result.UserId);
        Assert.Single(repo.Rows); // nothing new written
    }

    [Fact]
    public async Task Known_account_but_the_session_has_data_asks_instead_of_choosing()
    {
        var repo = new FakeIdentities();
        repo.Rows.Add(new GoogleIdentity { Id = Alice, GoogleSub = "sub-alice" });

        var result = await Build(repo, new Presence(Bob)).ResolveAsync(Bob, "sub-alice", "a@x.com");

        Assert.Equal(GoogleSignInOutcome.NeedsChoice, result.Outcome);
        Assert.Equal(Alice, result.OtherUserId);
        Assert.Single(repo.Rows); // nothing written either way
    }

    [Fact]
    public async Task A_session_already_linked_to_another_google_account_is_refused()
    {
        var repo = new FakeIdentities();
        repo.Rows.Add(new GoogleIdentity { Id = Bob, GoogleSub = "sub-bob" });

        var result = await Build(repo, new Presence(Bob)).ResolveAsync(Bob, "sub-carol", "c@x.com");

        Assert.Equal(GoogleSignInOutcome.Refused, result.Outcome);
        Assert.Single(repo.Rows);
    }

    [Fact]
    public async Task Signing_in_again_as_yourself_is_a_no_op()
    {
        var repo = new FakeIdentities();
        repo.Rows.Add(new GoogleIdentity { Id = Alice, GoogleSub = "sub-alice" });

        var result = await Build(repo, new Presence(Alice)).ResolveAsync(Alice, "sub-alice", "a@x.com");

        Assert.Equal(GoogleSignInOutcome.SignedIn, result.Outcome);
        Assert.Equal(Alice, result.UserId);
        Assert.Single(repo.Rows);
    }

    [Fact]
    public async Task A_first_time_visitor_links_their_own_empty_account()
    {
        var repo = new FakeIdentities();

        var result = await Build(repo, new Presence()).ResolveAsync(Bob, "sub-bob", "b@x.com");

        Assert.Equal(GoogleSignInOutcome.SignedIn, result.Outcome);
        Assert.Equal(Bob, result.UserId);
        Assert.Equal(Bob, Assert.Single(repo.Rows).Id);
    }

    // ---- The one-shot claim -------------------------------------------------

    [Fact]
    public async Task The_first_google_account_claims_the_pre_auth_user()
    {
        var repo = new FakeIdentities();

        var result = await Build(repo, new Presence(), claimTarget: Alice)
            .ResolveAsync(Bob, "sub-mine", "me@x.com");

        Assert.Equal(GoogleSignInOutcome.Claimed, result.Outcome);
        Assert.Equal(Alice, result.UserId);          // adopts the pre-auth data
        Assert.True(Assert.Single(repo.Rows).ViaClaim);
    }

    [Fact]
    public async Task A_consumed_claim_is_dead_even_though_the_config_still_names_it()
    {
        // This is the property the config cannot express: the claim is gated on
        // the target having no link, which is a fact in the database. Leaving
        // ClaimUserId set — the realistic state, since nobody goes back to
        // unset it — must not re-arm anything.
        var repo = new FakeIdentities();
        var resolver = Build(repo, new Presence(), claimTarget: Alice);

        var first = await resolver.ResolveAsync(Bob, "sub-mine", "me@x.com");
        Assert.Equal(GoogleSignInOutcome.Claimed, first.Outcome);

        // A different person signs in afterwards, same configuration.
        var second = await resolver.ResolveAsync(Carol, "sub-stranger", "s@x.com");

        Assert.Equal(GoogleSignInOutcome.SignedIn, second.Outcome);
        Assert.Equal(Carol, second.UserId);  // their own empty account, NOT Alice's
        Assert.Equal(2, repo.Rows.Count);
        Assert.False(repo.Rows.Single(r => r.Id == Carol).ViaClaim);
    }

    [Fact]
    public async Task The_claim_never_fires_when_the_target_is_already_linked()
    {
        var repo = new FakeIdentities();
        repo.Rows.Add(new GoogleIdentity { Id = Alice, GoogleSub = "sub-alice" });

        var result = await Build(repo, new Presence(), claimTarget: Alice)
            .ResolveAsync(Bob, "sub-stranger", "s@x.com");

        Assert.Equal(GoogleSignInOutcome.SignedIn, result.Outcome);
        Assert.Equal(Bob, result.UserId);
    }

    [Fact]
    public async Task Losing_the_claim_race_falls_back_to_an_ordinary_sign_in()
    {
        // Two first sign-ins can both pass the "is the claim open?" read; the
        // insert is what arbitrates. The loser must land on their own account,
        // not error and not silently share Alice's.
        var repo = new RacingIdentities(Alice);

        var result = await Build(repo, new Presence(), claimTarget: Alice)
            .ResolveAsync(Bob, "sub-bob", "b@x.com");

        Assert.Equal(GoogleSignInOutcome.SignedIn, result.Outcome);
        Assert.Equal(Bob, result.UserId);
    }

    // Simulates another request winning the claim between our read and insert.
    private sealed class RacingIdentities(Guid claimTarget) : FakeIdentities
    {
        private bool _raced;

        public override Task<bool> TryLinkAsync(GoogleIdentity identity, CancellationToken ct = default)
        {
            if (!_raced && identity.Id == claimTarget)
            {
                _raced = true;
                Rows.Add(new GoogleIdentity { Id = claimTarget, GoogleSub = "sub-someone-else" });
                return Task.FromResult(false);
            }
            return base.TryLinkAsync(identity, ct);
        }
    }

    // Honours both unique constraints the real collection carries: _id and
    // GoogleSub. Without the second, TryLinkAsync would appear to allow two
    // users to link the same Google account and the tests would pass on a
    // system that cannot exist.
    private class FakeIdentities : IGoogleIdentityRepository
    {
        public readonly List<GoogleIdentity> Rows = [];

        public Task<GoogleIdentity?> FindByGoogleSubAsync(string sub, CancellationToken ct = default) =>
            Task.FromResult(Rows.FirstOrDefault(r => r.GoogleSub == sub));

        public Task<GoogleIdentity?> GetAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult(Rows.FirstOrDefault(r => r.Id == userId));

        public virtual Task<bool> TryLinkAsync(GoogleIdentity identity, CancellationToken ct = default)
        {
            if (Rows.Any(r => r.Id == identity.Id || r.GoogleSub == identity.GoogleSub))
                return Task.FromResult(false);
            Rows.Add(identity);
            return Task.FromResult(true);
        }

        public Task EnsureIndexesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
