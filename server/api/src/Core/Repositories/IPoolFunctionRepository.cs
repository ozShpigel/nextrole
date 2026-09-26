namespace ApplicationTracker.Core.Repositories;

// Which job functions the product's users are pursuing. Not user-scoped -- see
// PoolFunction.
public interface IPoolFunctionRepository
{
    /// <summary>
    /// Records exactly these functions for this user: claims each one, and
    /// removes the user from every other. A function left with no users is
    /// deleted, so the ingest stops reading postings for it.
    /// </summary>
    Task SyncAsync(Guid userId, IReadOnlyCollection<string> functions, CancellationToken ct = default);
}
