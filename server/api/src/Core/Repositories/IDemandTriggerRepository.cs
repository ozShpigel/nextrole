namespace ApplicationTracker.Core.Repositories;

// Requests for an ingest run now, and whether one is still open -- see
// DemandTrigger. Every query here takes the user's id explicitly.
public interface IDemandTriggerRepository
{
    /// <summary>Asks the consumer for a run: this user's save brought these new values.</summary>
    Task RequestAsync(Guid userId, IReadOnlyCollection<string> newValues, CancellationToken ct = default);

    /// <summary>
    /// Whether roles are being collected for this user: an open request of
    /// theirs, and a live consumer with the pre-read filter on to act on it.
    /// </summary>
    Task<bool> IsCollectingAsync(Guid userId, CancellationToken ct = default);
}
