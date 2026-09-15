using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

// One Google link per user, keyed by userId (GoogleIdentity.Id IS the userId).
public interface IGoogleIdentityRepository
{
    // The one unscoped read in the system, and the reason it exists: on a
    // callback we hold a Google `sub` and nothing else, so this is how we
    // discover which user is signing in.
    Task<GoogleIdentity?> FindByGoogleSubAsync(string googleSub, CancellationToken ct = default);

    // Is this user already linked? Used to decide whether a sign-in is a
    // collision, and — for the claim target — whether the claim is still open.
    Task<GoogleIdentity?> GetAsync(Guid userId, CancellationToken ct = default);

    // Insert-if-absent. Returns false when either the userId or the Google sub
    // is already linked, rather than overwriting. This is what makes the claim
    // atomic: two concurrent first sign-ins both pass the "is it open?" read,
    // and exactly one of them wins the insert.
    Task<bool> TryLinkAsync(GoogleIdentity identity, CancellationToken ct = default);

    Task EnsureIndexesAsync(CancellationToken ct = default);
}
