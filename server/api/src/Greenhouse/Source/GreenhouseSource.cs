namespace ApplicationTracker.Greenhouse;

/// <summary>
/// Greenhouse's public boards API, as an <see cref="IJobSource"/>.
/// </summary>
/// <remarks>
/// A mapping over <see cref="BoardClient"/>, which keeps every guard it had: it
/// throws on a non-2xx, an unparseable body, or a <c>meta.total</c> that does
/// not match the count. One call returns the whole board with its content, so
/// every posting arrives with its <see cref="ListedPosting.Detail"/> set and
/// <see cref="DetailAsync"/> is never needed.
/// </remarks>
public sealed class GreenhouseSource : IJobSource
{
    private readonly IBoardClient _board;

    public GreenhouseSource(IBoardClient board) => _board = board;

    public string Name => "greenhouse";

    public async Task<Listing> ListAsync(string boardToken, CancellationToken ct)
    {
        var jobs = await _board.FetchAsync(boardToken, ct);

        // Complete: BoardClient has already thrown on a count mismatch. A board
        // that gives no meta.total at all is accepted, as it was before this
        // interface existed -- tightening that is a decision of its own, not
        // something to slip into a refactor.
        return new Listing([.. jobs.Select(Map)], Complete: true, Total: jobs.Count);
    }

    public Task<SourcePosting?> DetailAsync(string boardToken, ListedPosting posting, CancellationToken ct) =>
        Task.FromResult(posting.Detail);

    private static ListedPosting Map(BoardJob job)
    {
        var listed = new ListedPosting(
            SourceJobId: job.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Title: job.Title,
            Location: job.Location?.Name,
            Offices: Names(job.Offices),
            Departments: Names(job.Departments),
            PostedAt: job.FirstPublished?.UtcDateTime,
            UpdatedAt: job.UpdatedAt?.UtcDateTime);

        return listed with
        {
            Detail = new SourcePosting(listed, job.Content, job.AbsoluteUrl, job.CompanyName, job.RequisitionId),
        };
    }

    // Names only, as stored: the taxonomy ids are Greenhouse's internal ones.
    // Nulls are dropped here; every consumer already ignored them.
    private static List<string> Names(List<BoardTaxonomy>? items) =>
        [.. (items ?? []).Select(i => i.Name).OfType<string>()];
}
