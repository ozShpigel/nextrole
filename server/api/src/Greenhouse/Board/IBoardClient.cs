using ApplicationTracker.Core.Greenhouse;
namespace ApplicationTracker.Greenhouse;

/// <summary>
/// Reads one Greenhouse board.
/// </summary>
/// <remarks>
/// An interface in Core so <see cref="CompanyHandler"/> -- which is orchestration,
/// not I/O -- stays here alongside the models rather than following the HTTP
/// client into Infrastructure.
/// </remarks>
public interface IBoardClient
{
    Task<IReadOnlyList<BoardJob>> FetchAsync(string boardToken, CancellationToken ct);
}

/// <summary>
/// Raised when a board could not be read. Never means "this board has no jobs".
/// </summary>
/// <remarks>
/// <para>
/// The distinction is the whole reason this type exists, and it is why it is an
/// exception rather than a result code. A failed fetch and an empty board are
/// the same absence of listings, and treating the first as the second closes
/// every job the company has.
/// </para>
/// <para>
/// Because it throws, <see cref="CompanyHandler"/> cannot reach the close diff
/// on a failed fetch: the guard is structural, not a flag somebody has to
/// remember to check.
/// </para>
/// </remarks>
public sealed class BoardFetchException : Exception
{
    public BoardFetchException(string message, Exception? inner = null) : base(message, inner) { }
}
