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

    /// <summary>
    /// Store the ingest-time AI reads for jobs that have just entered.
    /// </summary>
    /// <remarks>
    /// Both are user-independent, so they are computed once here rather than
    /// once per user. Either may be absent for a given job -- a failed chunk
    /// contributes nothing and is retried on a later run.
    /// </remarks>
    Task<long> SaveIngestAiAsync(
        string boardToken,
        IReadOnlyDictionary<long, MongoDB.Bson.BsonDocument> facts,
        IReadOnlyDictionary<long, MongoDB.Bson.BsonDocument> parsed,
        string? parseVersion,
        DateTime now,
        CancellationToken ct);

    Task<long> CloseMissingAsync(
        string boardToken, IReadOnlyCollection<long> seenIds, int emptyResponseGuardThreshold,
        DateTime now, CancellationToken ct);
}
