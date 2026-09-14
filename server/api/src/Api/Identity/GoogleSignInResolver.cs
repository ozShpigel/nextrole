using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;

namespace ApplicationTracker.Api.Identity;

public enum GoogleSignInOutcome
{
    // Signed in as UserId — either the account this Google login already owned,
    // or the caller's own cookie account, newly linked.
    SignedIn,

    // The one-shot migration fired: this Google account adopted the pre-auth
    // userId named by GoogleAuthOptions.ClaimUserId.
    Claimed,

    // The caller's session is already linked to a different Google account.
    // Nothing is written.
    Refused,
}

/// <param name="MergeFromUserId">
/// Set when the caller arrived holding a different (anonymous) account, whose
/// documents should be moved onto <paramref name="UserId"/> before the session
/// is issued. Null when there is nothing to move.
///
/// The merge is not attempted here: this type stays free of I/O so the sign-in
/// rules remain testable without a database. The caller runs it.
/// </param>
public sealed record GoogleSignInResult(
    GoogleSignInOutcome Outcome,
    Guid UserId,
    Guid? MergeFromUserId = null,
    string? Reason = null);

/// <summary>
/// Decides which userId a completed Google sign-in resolves to. Pure decision
/// logic over the repository — no HTTP, so the collision rules in docs/auth.md
/// are unit-testable rather than prose.
/// </summary>
public sealed class GoogleSignInResolver
{
    private readonly IGoogleIdentityRepository _identities;
    private readonly GoogleAuthOptions _options;

    public GoogleSignInResolver(
        IGoogleIdentityRepository identities,
        GoogleAuthOptions options)
    {
        _identities = identities;
        _options = options;
    }

    public async Task<GoogleSignInResult> ResolveAsync(
        Guid cookieUserId, string googleSub, string email, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(googleSub))
            throw new ArgumentException("googleSub is required", nameof(googleSub));

        // 1. Does this Google account already own an account here?
        var linked = await _identities.FindByGoogleSubAsync(googleSub, ct);
        if (linked is not null)
        {
            // Already signed in as themselves; nothing to do.
            if (linked.Id == cookieUserId)
                return new GoogleSignInResult(GoogleSignInOutcome.SignedIn, cookieUserId);

            // Their account is elsewhere. Adopt it, and bring whatever this
            // session accumulated along — someone who uploaded a CV and got
            // matches before signing in should not have to choose which half
            // to keep. Anything that genuinely collides (the one-per-user
            // documents) is parked rather than destroyed, and reported.
            return new GoogleSignInResult(
                GoogleSignInOutcome.SignedIn, linked.Id, MergeFromUserId: cookieUserId);
        }

        // 2. This Google account is new to us. Is the current session already
        //    spoken for by a different Google account? Linking a second one
        //    would conflate two people.
        var mine = await _identities.GetAsync(cookieUserId, ct);
        if (mine is not null)
            return new GoogleSignInResult(
                GoogleSignInOutcome.Refused, cookieUserId, null,
                "This session is already linked to a different Google account. Sign out first.");

        // 3. The one-shot migration claim.
        //
        //    Gated on the TARGET HAVING NO LINK — a fact in the database, not a
        //    flag in config. Once the claim succeeds that document exists, so
        //    this branch is dead for every later sign-in no matter what
        //    ClaimUserId is set to. Re-arming it means deleting the link on
        //    purpose, which is not something config can do by accident.
        if (_options.TryGetClaimUserId(out var claimTarget)
            && claimTarget != cookieUserId
            && await _identities.GetAsync(claimTarget, ct) is null)
        {
            var claimed = await _identities.TryLinkAsync(new GoogleIdentity
            {
                Id = claimTarget,
                GoogleSub = googleSub,
                Email = email,
                ViaClaim = true,
            }, ct);

            // Won the race: this Google account now owns the pre-auth data.
            if (claimed) return new GoogleSignInResult(GoogleSignInOutcome.Claimed, claimTarget);

            // Lost it (another sign-in claimed between the read and the insert)
            // — fall through and be treated as an ordinary first sign-in.
        }

        // 4. Ordinary first sign-in: link this Google account to the account
        //    the caller already is. A brand-new visitor gets their empty
        //    account, which is the correct outcome for everyone after the
        //    claim has been consumed.
        var ok = await _identities.TryLinkAsync(new GoogleIdentity
        {
            Id = cookieUserId,
            GoogleSub = googleSub,
            Email = email,
        }, ct);

        if (ok) return new GoogleSignInResult(GoogleSignInOutcome.SignedIn, cookieUserId);

        // Raced against a concurrent sign-in with the same Google account.
        // Whoever won is the truth; adopt it rather than reporting an error.
        var winner = await _identities.FindByGoogleSubAsync(googleSub, ct);
        if (winner is not null)
            return new GoogleSignInResult(GoogleSignInOutcome.SignedIn, winner.Id);

        return new GoogleSignInResult(
            GoogleSignInOutcome.Refused, cookieUserId, null,
            "Could not complete sign-in. Please try again.");
    }
}
