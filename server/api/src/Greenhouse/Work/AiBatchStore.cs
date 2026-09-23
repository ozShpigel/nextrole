using ApplicationTracker.Core.Greenhouse;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// One submitted Message Batch: which read, for which board, over which postings.
/// </summary>
/// <remarks>
/// The only record of a batch this side holds. Anthropic keeps the batch
/// itself; without this row a submitted batch is paid for and never collected,
/// so it is written straight after the submit returns an id.
/// </remarks>
public sealed record AiBatchRecord
{
    public required string BatchId { get; init; }
    public required string Kind { get; init; }
    public required string BoardToken { get; init; }
    public required IReadOnlyList<long> JobIds { get; init; }
    public string? ParseVersion { get; init; }
    public required DateTime SubmittedAt { get; init; }

    public const string Facts = "facts";
    public const string Parse = "parse";
}

/// <summary>The batch ledger, as the submitter and collector use it.</summary>
public interface IAiBatchStore
{
    Task RecordAsync(AiBatchRecord batch, CancellationToken ct);

    /// <summary>Batches submitted and not yet collected or abandoned.</summary>
    Task<IReadOnlyList<AiBatchRecord>> PendingAsync(CancellationToken ct);

    /// <summary>Close a batch: <c>collected</c>, or <c>abandoned</c> when it outlived its results.</summary>
    Task CloseAsync(string batchId, string status, DateTime now, CancellationToken ct);
}

/// <summary><see cref="IAiBatchStore"/> over <c>greenhouse_ai_batches</c>.</summary>
public sealed class AiBatchStore : IAiBatchStore
{
    private const string Pending = "pending";

    private readonly IMongoCollection<BsonDocument> _batches;

    public AiBatchStore(IMongoCollection<BsonDocument> batches) => _batches = batches;

    public Task RecordAsync(AiBatchRecord batch, CancellationToken ct) =>
        _batches.InsertOneAsync(new BsonDocument
        {
            { "_id", batch.BatchId },
            { "kind", batch.Kind },
            { "boardToken", batch.BoardToken },
            { "jobIds", new BsonArray(batch.JobIds) },
            { "parseVersion", batch.ParseVersion is null ? BsonNull.Value : new BsonString(batch.ParseVersion) },
            { "submittedAt", batch.SubmittedAt },
            { "status", Pending },
        }, cancellationToken: ct);

    public async Task<IReadOnlyList<AiBatchRecord>> PendingAsync(CancellationToken ct)
    {
        var docs = await _batches
            .Find(Builders<BsonDocument>.Filter.Eq("status", Pending))
            .Sort(Builders<BsonDocument>.Sort.Ascending("submittedAt"))
            .ToListAsync(ct);

        return [.. docs.Select(d => new AiBatchRecord
        {
            BatchId = d["_id"].AsString,
            Kind = d["kind"].AsString,
            BoardToken = d["boardToken"].AsString,
            JobIds = [.. d["jobIds"].AsBsonArray.Select(v => v.ToInt64())],
            ParseVersion = d.TryGetValue("parseVersion", out var v) && v.IsString ? v.AsString : null,
            SubmittedAt = d["submittedAt"].ToUniversalTime(),
        })];
    }

    public Task CloseAsync(string batchId, string status, DateTime now, CancellationToken ct) =>
        _batches.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", batchId),
            Builders<BsonDocument>.Update.Set("status", status).Set("closedAt", now),
            cancellationToken: ct);

    public Task EnsureIndexesAsync(CancellationToken ct) =>
        _batches.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("status").Ascending("submittedAt"),
                new CreateIndexOptions { Name = "idx_status_submitted" }),
            cancellationToken: ct);
}
