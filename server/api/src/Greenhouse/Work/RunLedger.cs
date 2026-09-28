using ApplicationTracker.Core.Greenhouse;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// <c>greenhouse_runs</c>: one row per company per day, pending until something
/// resolves it.
/// </summary>
/// <remarks>
/// <para>
/// Written by the PUBLISHER as <c>pending</c> and resolved by the CONSUMER to
/// <c>done</c> or <c>failed</c>. That split is deliberate: a row that exists and
/// stays pending is the only durable evidence that a company was dispatched and
/// never handled. If the consumer wrote the row, a message lost between the two
/// would leave no trace at all, and the day would simply look smaller.
/// </para>
/// <para>
/// This is also the answer to "how do you know the work is finished" without
/// asking the queue. An empty queue is not done -- a message can be in flight,
/// or unacked and about to be redelivered. Zero pending rows for today is.
/// </para>
/// </remarks>
public sealed class RunLedger
{
    private readonly IMongoCollection<BsonDocument> _runs;
    private readonly ILogger<RunLedger> _log;

    public RunLedger(IMongoCollection<BsonDocument> runs, ILogger<RunLedger> log)
    {
        _runs = runs;
        _log = log;
    }

    /// <summary>The day key a run belongs to, UTC.</summary>
    public static string DayOf(DateTime utc) => utc.ToString("yyyy-MM-dd");

    /// <summary>
    /// Record that a company was dispatched today.
    /// </summary>
    /// <remarks>
    /// Keyed on (day, boardKey) and upserted, so the publisher running twice
    /// in one day leaves one row per board rather than two.
    ///
    /// A re-publish DOES reset a row that already reached done, back to
    /// pending. That is deliberate and it is the safe direction: a second
    /// dispatch means a second message exists and will be handled, so the row
    /// has to say "outstanding" until something resolves it again. Leaving it
    /// at done would describe work that is currently in flight as finished,
    /// and "zero pending rows" is the only signal anyone has that the day is
    /// complete. The previous error is cleared for the same reason: it belongs
    /// to the attempt being superseded.
    /// </remarks>
    public Task MarkPendingAsync(
        string day, BoardConfig board, string runId, DateTime now, CancellationToken ct) =>
        _runs.UpdateOneAsync(
            RowOf(day, board.Key, board.Token),
            new BsonDocument
            {
                { "$set", Keyed(board.Key, board.Token, new BsonDocument
                    { { "status", "pending" }, { "runId", runId }, { "dispatchedAt", now } }) },
                { "$unset", new BsonDocument { { "error", "" }, { "completedAt", "" } } },
                { "$setOnInsert", new BsonDocument { { "day", day } } },
            },
            new UpdateOptions { IsUpsert = true }, ct);

    public Task MarkDoneAsync(
        string day, BoardConfig board, BsonDocument counts, DateTime now, CancellationToken ct) =>
        _runs.UpdateOneAsync(
            RowOf(day, board.Key, board.Token),
            new BsonDocument
            {
                { "$set", Keyed(board.Key, board.Token, new BsonDocument
                    { { "status", "done" }, { "completedAt", now }, { "counts", counts } }) },
                { "$unset", new BsonDocument { { "error", "" } } },
                // Upserted rather than required to exist: a consumer handling a
                // message whose ledger row was lost should still record what it
                // did. The alternative is a successful run with no evidence.
                { "$setOnInsert", new BsonDocument { { "day", day } } },
            },
            new UpdateOptions { IsUpsert = true }, ct);

    /// <summary>
    /// The day's row for this board: by key, or -- for a row an older process
    /// wrote mid-deploy -- by token with no key yet, which the write then keys.
    /// </summary>
    /// <remarks>
    /// Matching the old shape too is what stops a mid-deploy row from colliding
    /// with this one on the old <c>(day, boardToken)</c> unique index: it is
    /// updated and given its key, never shadowed by a second row. Only rows
    /// with no key are matched by token, so a Workday board sharing a token
    /// with a Greenhouse one never lands on the Greenhouse row.
    /// </remarks>
    private static FilterDefinition<BsonDocument> RowOf(string day, string boardKey, string? boardToken)
    {
        var f = Builders<BsonDocument>.Filter;
        var byKey = f.Eq("boardKey", boardKey);
        return f.And(f.Eq("day", day), boardToken is null
            ? byKey
            : f.Or(byKey, f.And(f.Exists("boardKey", false), f.Eq("boardToken", boardToken))));
    }

    /// <summary>
    /// The key, and the token while the old <c>(day, boardToken)</c> index still
    /// exists (dropped in 2c, docs/plans/key-migration.md).
    /// </summary>
    private static BsonDocument Keyed(string boardKey, string? boardToken, BsonDocument set)
    {
        set["boardKey"] = boardKey;
        if (boardToken is not null) set["boardToken"] = boardToken;
        return set;
    }

    /// <summary>
    /// Record a failure, with the error.
    /// </summary>
    /// <remarks>
    /// Best-effort and never allowed to throw: this runs on the failure path,
    /// and an exception here would replace the real error with a Mongo one on
    /// the way to the DLQ.
    /// </remarks>
    /// <param name="boardToken">Null when the board is no longer configured and only its key is known.</param>
    public async Task MarkFailedAsync(
        string day, string boardKey, string? boardToken, Exception error, DateTime now, CancellationToken ct)
    {
        try
        {
            var message = $"{error.GetType().Name}: {error.Message}";
            await _runs.UpdateOneAsync(
                RowOf(day, boardKey, boardToken),
                new BsonDocument
                {
                    { "$set", Keyed(boardKey, boardToken, new BsonDocument
                        {
                            { "status", "failed" },
                            { "completedAt", now },
                            { "error", message.Length > 2000 ? message[..2000] : message },
                        }) },
                    { "$setOnInsert", new BsonDocument { { "day", day } } },
                },
                new UpdateOptions { IsUpsert = true }, ct);
        }
        catch (Exception e)
        {
            _log.LogError(e, "Could not record the failure of board {Board} on {Day}", boardKey, day);
        }
    }

    /// <summary>Boards dispatched today that nothing has resolved yet, by board key.</summary>
    public async Task<List<string>> PendingAsync(string day, CancellationToken ct)
    {
        var docs = await _runs
            .Find(Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Eq("day", day),
                Builders<BsonDocument>.Filter.Eq("status", "pending")))
            .Project(Builders<BsonDocument>.Projection.Include("boardKey").Include("boardToken"))
            .ToListAsync(ct);

        return [.. docs.Select(KeyOf).OfType<string>()];
    }

    /// <summary>A row's board key; a row written before keys existed is a Greenhouse one.</summary>
    private static string? KeyOf(BsonDocument d) =>
        d.TryGetValue("boardKey", out var k) && k.IsString ? k.AsString
        : d.TryGetValue("boardToken", out var t) && t.IsString ? GreenhouseJob.KeyFor(GreenhouseSource.SourceName, t.AsString)
        : null;

    /// <summary>
    /// Key the rows written before board keys, then build the indexes. Run by
    /// both the publisher and the consumer on start, before either writes.
    /// </summary>
    /// <remarks>
    /// Idempotent, and small: one row per board per day. Every row without a
    /// key was written by the Greenhouse-only ingest, so its key is
    /// <c>greenhouse:&lt;token&gt;</c>. The new unique index is partial on the
    /// key existing, so a row an older process writes mid-deploy, before this
    /// ran for it, cannot collide on a missing field.
    /// </remarks>
    public async Task EnsureIndexesAsync(CancellationToken ct)
    {
        var filled = await _runs.UpdateManyAsync(
            Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Exists("boardKey", false),
                Builders<BsonDocument>.Filter.Type("boardToken", BsonType.String)),
            PipelineDefinition<BsonDocument, BsonDocument>.Create(new BsonDocument("$set", new BsonDocument(
                "boardKey", new BsonDocument("$concat",
                    new BsonArray { GreenhouseSource.SourceName + ":", "$boardToken" })))),
            cancellationToken: ct);
        if (filled.ModifiedCount > 0)
            _log.LogInformation("Run ledger: gave {Count} row(s) a boardKey", filled.ModifiedCount);

        await _runs.Indexes.CreateManyAsync(
        [
            // The old pair, kept until 2c (docs/plans/key-migration.md).
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("day").Ascending("boardToken"),
                new CreateIndexOptions { Unique = true, Name = "uniq_day_board" }),
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("day").Ascending("boardKey"),
                new CreateIndexOptions<BsonDocument>
                {
                    Unique = true,
                    Name = "uniq_day_boardkey",
                    PartialFilterExpression = Builders<BsonDocument>.Filter.Exists("boardKey"),
                }),
        ], ct);
    }
}
