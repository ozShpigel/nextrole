using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Matching;

/// <summary>
/// Get a posting's score for this user before it is added to the tracker.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why.</b> Matches shows unscored cards with the same Add button as scored
/// ones, so Add can arrive before the score. The application copies the score
/// when it is created, and once the card leaves the board nothing would ever
/// score it -- it would sit in Active without a number for good. So the save
/// scores it first. The board marks the card Added immediately, so the wait is
/// not something the reader sees.
/// </para>
/// <para>
/// <b>Its batch may already be in flight.</b> The card may have been scrolled
/// into view a moment earlier; score-by-ids then declines to pay for it twice
/// (<see cref="PoolScanResult.ScanInProgress"/>). Saving at that point would
/// store no score while one lands seconds later, so this waits for that score
/// instead of paying again.
/// </para>
/// <para>
/// Returns null when there is no score to be had -- today's budget is used up,
/// scoring failed, or the wait ran out -- and the save goes ahead unscored, as
/// it always did. Losing a score is better than losing the add.
/// </para>
/// </remarks>
public static class ScoreBeforeSave
{
    /// <summary>How long to wait for a batch already scoring this posting.</summary>
    /// <remarks>
    /// A scroll batch of five was measured at ~80s end to end; a single posting
    /// finishes well inside this. Also inside nginx's 300s read timeout.
    /// </remarks>
    public static readonly TimeSpan WaitForInFlight = TimeSpan.FromSeconds(120);

    public static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(2);

    public static async Task<JobScore?> EnsureAsync(
        Func<CancellationToken, Task<PoolScanResult>> score,
        Func<CancellationToken, Task<JobScore?>> read,
        Func<TimeSpan, CancellationToken, Task> delay,
        CancellationToken ct)
    {
        var result = await score(ct);

        if (await read(ct) is { } landed) return landed;
        if (!result.ScanInProgress) return null;

        for (var waited = TimeSpan.Zero; waited < WaitForInFlight; waited += PollInterval)
        {
            await delay(PollInterval, ct);
            if (await read(ct) is { } late) return late;
        }
        return null;
    }
}
