using ApplicationTracker.Core.Matching;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// One kind of job board -- Greenhouse, Workday, Lever, Comeet. The only
/// code that knows how a board is fetched.
/// </summary>
/// <remarks>
/// <para>
/// Everything after the fetch -- the hash skip, the pre-read filter, embedding,
/// the Claude reads, the close diff -- is shared and lives in
/// <see cref="BoardHandler"/>. An adapter is the HTTP calls, the mapping to
/// these records, and the proof that its listing is whole. Nothing else: text
/// cleaning is shared too (<see cref="GreenhouseJob.From"/>), so one source's
/// quirk cannot make the same text hash differently from another's.
/// </para>
/// <para>
/// <b>A failed fetch is not an empty board</b>, per source. <see cref="ListAsync"/>
/// throws <see cref="BoardFetchException"/> on any failure it can see, and
/// reports <see cref="Listing.Complete"/> = false when it cannot prove the list
/// is whole; the close diff runs on neither. Every adapter passes the same
/// contract suite (<c>JobSourceContract</c> in the tests) before it is used.
/// </para>
/// </remarks>
public interface IJobSource
{
    /// <summary>"greenhouse", "workday", ... -- the stored <c>source</c> field, and <see cref="BoardConfig.Source"/>.</summary>
    string Name { get; }

    /// <summary>
    /// Every posting on the board, lightweight. Throws, or reports
    /// <c>Complete = false</c> -- never a silently short list.
    /// </summary>
    Task<Listing> ListAsync(BoardConfig board, CancellationToken ct);

    /// <summary>
    /// The full posting, for one the handler will keep.
    /// </summary>
    /// <returns>
    /// Null when it could not be read this run: that posting is skipped and
    /// retried next run, and never closed for it -- closing is driven by the
    /// listing, not by the details.
    /// </returns>
    /// <remarks>
    /// A source whose listing already carries everything (Greenhouse) sets
    /// <see cref="ListedPosting.Detail"/> and is never asked.
    /// </remarks>
    Task<SourcePosting?> DetailAsync(BoardConfig board, ListedPosting posting, CancellationToken ct);
}

/// <param name="Complete">
/// True only when the source proved it returned the whole board (Greenhouse:
/// <c>meta.total</c> equals the count). False means "store what came back,
/// close nothing".
/// </param>
/// <param name="Total">The board's own count, when it gives one. For the logs.</param>
public sealed record Listing(IReadOnlyList<ListedPosting> Postings, bool Complete, int? Total);

/// <summary>What the pre-read filter needs from a posting, and no more.</summary>
/// <param name="SourceJobId">The board's own id, unique within the board and stable across runs.</param>
/// <param name="Location">The primary location text, as the board states it.</param>
/// <param name="Offices">Further location texts (Greenhouse offices, Workday additional locations).</param>
/// <param name="PostedAt">When the posting first went up, if the board says. UTC.</param>
/// <param name="UpdatedAt">The board's own last-edited date, if it gives one. UTC.</param>
/// <param name="Detail">Set when the listing already carries the full posting.</param>
/// <param name="DetailRef">
/// What this source needs to fetch the full posting (Workday: the posting's
/// path). Opaque to everything but the source; null when <paramref name="Detail"/> is set.
/// </param>
public sealed record ListedPosting(
    string SourceJobId,
    string? Title,
    string? Location,
    IReadOnlyList<string> Offices,
    IReadOnlyList<string> Departments,
    DateTime? PostedAt,
    DateTime? UpdatedAt,
    SourcePosting? Detail = null,
    string? DetailRef = null);

/// <summary>What gets stored.</summary>
/// <param name="ContentHtml">
/// The body as the board sends it -- HTML, possibly entity-encoded. Cleaned by
/// the shared path, never by the adapter.
/// </param>
/// <param name="Url">The apply link.</param>
/// <param name="PostedSalary">
/// The company's own published annual pay range, when the source carries one
/// and it passed <c>SalaryBounds</c>. Restamped every run, never hashed.
/// </param>
public sealed record SourcePosting(
    ListedPosting Listed,
    string? ContentHtml,
    string? Url,
    string? Company,
    string? RequisitionId,
    SalaryRange? PostedSalary = null);
