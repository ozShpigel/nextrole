namespace ApplicationTracker.Core.Repositories;

// What the product's users want -- job functions and location terms. Not
// user-scoped -- see PoolDemand.
public interface IPoolDemandRepository
{
    /// <summary>
    /// Records exactly these functions and location terms for this user: claims
    /// each one, and removes the user from every other. A value left with no
    /// users is deleted, so the ingest stops reading postings for it.
    /// </summary>
    Task SyncAsync(
        Guid userId, IReadOnlyCollection<string> functions, IReadOnlyCollection<string> locations,
        CancellationToken ct = default);
}
