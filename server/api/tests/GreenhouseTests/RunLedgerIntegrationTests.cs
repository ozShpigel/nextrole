using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The run ledger keyed by board (docs/plans/board-config.md), against a real
/// MongoDB: the backfill, the partial unique index and the match on an
/// old-shaped row are all the server's behaviour.
/// </summary>
/// <remarks>
/// Opt-in, like <see cref="KeyBackfillIntegrationTests"/>: set
/// <c>GREENHOUSE_KEYS_IT_MONGO</c> to a disposable server. Each test uses its
/// own randomly named database, checked to be free first, and drops it.
/// </remarks>
public sealed class RunLedgerIntegrationTests : IAsyncLifetime
{
    private static readonly string? Uri = Environment.GetEnvironmentVariable("GREENHOUSE_KEYS_IT_MONGO");
    private const string SkipReason = "Set GREENHOUSE_KEYS_IT_MONGO to a disposable MongoDB to run.";
    private const string Day = "2026-09-28";

    private MongoClient? _client;
    private string _dbName = "";
    private IMongoCollection<BsonDocument> _runs = null!;
    private RunLedger _ledger = null!;

    private static readonly BoardConfig Wiz = new() { Source = "greenhouse", Token = "wizinc" };

    public async Task InitializeAsync()
    {
        if (Uri is null) return;
        _client = new MongoClient(Uri);
        _dbName = $"ledger-it-{Guid.NewGuid():N}";
        var existing = await (await _client.ListDatabaseNamesAsync()).ToListAsync();
        if (existing.Contains(_dbName))
            throw new InvalidOperationException($"Database {_dbName} already exists; refusing to write into it.");
        _runs = _client.GetDatabase(_dbName).GetCollection<BsonDocument>("greenhouse_runs");
        _ledger = new RunLedger(_runs, NullLogger<RunLedger>.Instance);
    }

    public async Task DisposeAsync()
    {
        if (_client is not null) await _client.DropDatabaseAsync(_dbName);
    }

    /// <summary>A row as the ledger wrote it before board keys.</summary>
    private static BsonDocument OldRow(string token, string status = "pending") =>
        new() { { "day", Day }, { "boardToken", token }, { "status", status } };

    private Task<List<BsonDocument>> RowsAsync() => _runs.Find(FilterDefinition<BsonDocument>.Empty).ToListAsync();

    [SkippableFact]
    public async Task Old_rows_are_keyed_on_start_and_a_second_start_changes_nothing()
    {
        Skip.If(Uri is null, SkipReason);
        await _runs.InsertManyAsync([OldRow("wizinc"), OldRow("monzo", "done")]);

        await _ledger.EnsureIndexesAsync(default);
        await _ledger.EnsureIndexesAsync(default);

        var rows = await RowsAsync();
        Assert.Equal(["greenhouse:monzo", "greenhouse:wizinc"], rows.Select(r => r["boardKey"].AsString).Order());
        Assert.Equal(["greenhouse:wizinc"], await _ledger.PendingAsync(Day, default));
        var indexes = await (await _runs.Indexes.ListAsync()).ToListAsync();
        Assert.Contains(indexes, i => i["name"] == "uniq_day_boardkey" && i["unique"].ToBoolean());
    }

    [SkippableFact]
    public async Task A_row_an_old_process_writes_mid_deploy_is_resolved_not_duplicated()
    {
        // The new process has started (backfill done, indexes built); the old
        // one, not yet stopped, then writes a row with only a token. The
        // partial index lets it in, and the next write for that board updates
        // it and gives it its key -- rather than colliding on (day, boardToken).
        Skip.If(Uri is null, SkipReason);
        await _ledger.EnsureIndexesAsync(default);
        await _runs.InsertOneAsync(OldRow("wizinc"));

        await _ledger.MarkDoneAsync(Day, Wiz, new BsonDocument("fetched", 133), DateTime.UtcNow, default);

        var row = (await RowsAsync()).Single();
        Assert.Equal("done", row["status"].AsString);
        Assert.Equal("greenhouse:wizinc", row["boardKey"].AsString);
        Assert.Empty(await _ledger.PendingAsync(Day, default));
    }

    [SkippableFact]
    public async Task Publishing_twice_in_a_day_leaves_one_row_per_board()
    {
        Skip.If(Uri is null, SkipReason);
        await _ledger.EnsureIndexesAsync(default);

        await _ledger.MarkPendingAsync(Day, Wiz, "run-1", DateTime.UtcNow, default);
        await _ledger.MarkDoneAsync(Day, Wiz, new BsonDocument(), DateTime.UtcNow, default);
        await _ledger.MarkPendingAsync(Day, Wiz, "run-2", DateTime.UtcNow, default);

        var row = (await RowsAsync()).Single();
        Assert.Equal("pending", row["status"].AsString);
        Assert.Equal("run-2", row["runId"].AsString);
        Assert.Equal("wizinc", row["boardToken"].AsString);   // still written until 2c
    }

    [SkippableFact]
    public async Task The_same_token_on_another_source_never_takes_over_the_row()
    {
        // Only a row with NO key is matched by token. A keyed Greenhouse row
        // must never be rewritten as a Workday board that shares its token.
        Skip.If(Uri is null, SkipReason);
        await _ledger.EnsureIndexesAsync(default);
        await _ledger.MarkPendingAsync(Day, Wiz, "run-1", DateTime.UtcNow, default);

        // Until 2c the old (day, boardToken) index refuses the second row; the
        // failure path swallows that, and the Greenhouse row is untouched.
        await _ledger.MarkFailedAsync(Day, "workday:wizinc", "wizinc", new Exception("boom"), DateTime.UtcNow, default);

        var greenhouse = (await RowsAsync()).Single();
        Assert.Equal("greenhouse:wizinc", greenhouse["boardKey"].AsString);
        Assert.Equal("pending", greenhouse["status"].AsString);

        // After 2c drops that index, the Workday board gets a row of its own.
        await _runs.Indexes.DropOneAsync("uniq_day_board");
        await _ledger.MarkFailedAsync(Day, "workday:wizinc", "wizinc", new Exception("boom"), DateTime.UtcNow, default);

        var rows = (await RowsAsync()).ToDictionary(r => r["boardKey"].AsString);
        Assert.Equal("pending", rows["greenhouse:wizinc"]["status"].AsString);
        Assert.Equal("failed", rows["workday:wizinc"]["status"].AsString);
    }
}
