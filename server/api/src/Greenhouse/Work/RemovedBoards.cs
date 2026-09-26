using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Greenhouse;

/// <summary>What the publish does about boards that are no longer configured.</summary>
/// <param name="Removed">Boards with open postings that companies.json no longer lists.</param>
/// <param name="RemovedOpen">Their open postings.</param>
/// <param name="TotalOpen">Open postings across every board.</param>
/// <param name="Close">Whether to close them now.</param>
public sealed record RemovedBoardsPlan(
    IReadOnlyList<string> Removed, long RemovedOpen, long TotalOpen, bool Close);

/// <summary>
/// Closes the postings of a board removed from companies.json.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why.</b> Postings are closed by the close diff of a board that WAS
/// fetched. A removed board is never fetched again, so its postings stayed
/// open forever -- retrieved, shown and scored on Matches while the company
/// filled the roles and the links died. Silent, and worse every day.
/// </para>
/// <para>
/// <b>Non-destructive, so it can act at once.</b> Closing sets closedAt and
/// nothing else. Re-adding the company reopens every posting still on its
/// board on the next run -- the upsert and the presence touch both clear
/// closedAt -- without re-embedding or re-reading an unchanged one, and users'
/// scores still apply.
/// </para>
/// <para>
/// <b>The guard is against a wrong file, not a wrong token.</b> A typo'd token
/// closes one board, recoverably, and its fetch then fails loudly. The costly
/// accident is the whole list being wrong -- the box started with
/// companies.dev.json, one board, instead of the real list -- which would close
/// most of the pool in one pass. So a removal holding more than
/// <see cref="MaxShareClosedAtOnce"/> of all open postings is refused and
/// logged; closing that many is a decision for a human, with the command in
/// the log. Anything smaller closes at once: a guard that never lets go is its
/// own bug.
/// </para>
/// </remarks>
public sealed class RemovedBoards(IJobStore store, ILogger<RemovedBoards> log)
{
    /// <summary>More than this share of open postings closed in one pass is refused.</summary>
    public const double MaxShareClosedAtOnce = 0.5;

    /// <summary>The decision, apart from the database, so it can be tested as it runs.</summary>
    public static RemovedBoardsPlan Plan(
        IReadOnlyDictionary<string, long> openByBoard, IReadOnlyCollection<string> configured)
    {
        var listed = new HashSet<string>(configured, StringComparer.OrdinalIgnoreCase);
        var removed = openByBoard.Keys.Where(b => !listed.Contains(b)).Order().ToList();
        var removedOpen = removed.Sum(b => openByBoard[b]);
        var totalOpen = openByBoard.Values.Sum();

        var close = removed.Count > 0 && removedOpen <= totalOpen * MaxShareClosedAtOnce;
        return new RemovedBoardsPlan(removed, removedOpen, totalOpen, close);
    }

    /// <summary>Close the open postings of every board no longer configured, unless the guard refuses.</summary>
    /// <returns>Postings closed.</returns>
    public async Task<long> CloseAsync(IReadOnlyCollection<string> configured, DateTime now, CancellationToken ct)
    {
        var plan = Plan(await store.OpenCountsByBoardAsync(ct), configured);
        if (plan.Removed.Count == 0) return 0;

        if (!plan.Close)
        {
            log.LogError(
                "Not closing {Boards}: {RemovedOpen} of {TotalOpen} open postings belong to boards companies.json "
                + "no longer lists -- more than {Share:P0} at once, which looks like the wrong companies file rather "
                + "than a removal. If it is a removal, close them by hand: db.greenhouse_jobs.updateMany("
                + "{{boardToken: {{$in: [...]}}, closedAt: null}}, {{$set: {{closedAt: new Date()}}}})",
                string.Join(", ", plan.Removed), plan.RemovedOpen, plan.TotalOpen, MaxShareClosedAtOnce);
            return 0;
        }

        var closed = await store.CloseBoardsAsync(plan.Removed, now, ct);
        log.LogInformation(
            "Closed {Closed} open posting(s) of {Boards}: no longer in companies.json. Re-adding a board reopens "
            + "what is still on it, without re-reading unchanged postings",
            closed, string.Join(", ", plan.Removed));
        return closed;
    }
}
