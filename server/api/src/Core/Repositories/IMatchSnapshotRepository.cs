namespace ApplicationTracker.Core.Repositories;

public interface IMatchSnapshotRepository
{
    // Hashes the four fields and upserts a MatchSnapshot keyed by that hash,
    // so repeated saves of the same batch's shared snapshot collapse to one
    // stored document. Returns null (stores nothing) when all four are null —
    // the application had no AI scoring snapshot to persist.
    Task<string?> UpsertAsync(
        string? analystInput, string? analystOutput,
        string? evaluatorInput, string? evaluatorOutput,
        CancellationToken ct = default);
}
