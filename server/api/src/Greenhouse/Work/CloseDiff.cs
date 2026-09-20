using ApplicationTracker.Core.Greenhouse;
namespace ApplicationTracker.Greenhouse;

/// <summary>What the close diff decided, and why.</summary>
/// <param name="Close">Greenhouse job ids to mark closed. Empty when skipped.</param>
/// <param name="SkipReason">Non-null when a guard refused the diff.</param>
public sealed record CloseDecision(IReadOnlyList<long> Close, string? SkipReason)
{
    public bool Skipped => SkipReason is not null;
}

/// <summary>
/// Decides which stored jobs a board no longer lists. Pure, so the guards are
/// tested on the code that runs rather than on a restatement of it.
/// </summary>
/// <remarks>
/// Splitting the decision from the write is the point. Both guards are
/// conditions on a set difference, and a guard that can only be exercised
/// through a live Mongo connection is a guard most people will test by reading
/// it.
/// </remarks>
public static class CloseDiff
{
    /// <summary>
    /// Stored-open minus seen, unless a guard refuses.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The failed-fetch guard is not here, because it cannot be.</b>
    /// <c>BoardClient</c> throws, so a failed fetch never reaches this method
    /// at all -- there is no <c>fetchSucceeded</c> parameter to forget to pass
    /// and no branch to get wrong. That is the strongest form the guard can
    /// take, and <c>CompanyHandlerTests</c> asserts it by proving the store is
    /// never asked to close anything when the fetch throws.
    /// </para>
    /// <para>
    /// <b>The empty-response guard is here.</b> An empty board while a large
    /// number of jobs are stored open is far more likely to be a board being
    /// rebuilt, a token that changed hands, or an upstream bug than a company
    /// closing every role at once.
    /// </para>
    /// <para>
    /// It deliberately does not fire on a small stored count. A board with
    /// three jobs really can empty, and refusing to ever close those would
    /// leave them retrievable forever -- a guard that never lets go is its own
    /// bug.
    /// </para>
    /// </remarks>
    public static CloseDecision Compute(
        IReadOnlyCollection<long> storedOpenIds,
        IReadOnlyCollection<long> seenIds,
        int emptyResponseGuardThreshold)
    {
        if (seenIds.Count == 0 && storedOpenIds.Count >= emptyResponseGuardThreshold)
            return new CloseDecision(
                [],
                $"board returned no jobs while {storedOpenIds.Count} are stored open "
                + $"(guard threshold {emptyResponseGuardThreshold})");

        var seen = seenIds as HashSet<long> ?? [.. seenIds];
        return new CloseDecision([.. storedOpenIds.Where(id => !seen.Contains(id))], null);
    }
}
