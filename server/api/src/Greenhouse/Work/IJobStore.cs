using ApplicationTracker.Core.Greenhouse;
namespace ApplicationTracker.Greenhouse;

/// <summary>
/// The Greenhouse collection's write side, as <see cref="CompanyHandler"/> uses it.
/// </summary>
/// <remarks>
/// An interface so the handler's own logic -- the hash skip, batch alignment,
/// per-batch writing, and the fact that a failed fetch never reaches the close
/// diff -- can be tested without a database. The Mongo semantics themselves
/// (upsert on the unique key, clearing closedAt on reopen) are verified against
/// a real collection in <c>JobStoreIntegrationTests</c>, because a fake that
/// models them is only evidence about the fake.
/// </remarks>
public interface IJobStore
{
    Task<Dictionary<long, string>> StoredHashesAsync(string boardToken, CancellationToken ct);

    Task<(long Upserted, long Modified)> UpsertBatchAsync(
        IReadOnlyList<(GreenhouseJob Job, float[] Vector)> batch, string runId, DateTime now,
        CancellationToken ct);

    Task<long> TouchAsync(
        string boardToken, IReadOnlyCollection<long> ids, string runId, DateTime now, CancellationToken ct);

    Task<long> CloseMissingAsync(
        string boardToken, IReadOnlyCollection<long> seenIds, int emptyResponseGuardThreshold,
        DateTime now, CancellationToken ct);
}
