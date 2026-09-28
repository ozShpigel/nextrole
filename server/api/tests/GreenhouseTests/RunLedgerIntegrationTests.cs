using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The run ledger keyed by board (docs/plans/board-config.md, and 2c of
/// docs/plans/key-migration.md), against a real MongoDB: the unique index and
/// the index drop are the server's behaviour.
/// </summary>
/// <remarks>
/// Opt-in, like <see cref="JobStoreIntegrationTests"/>: set
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

    private Task<List<BsonDocument>> RowsAsync() => _runs.Find(FilterDefinition<BsonDocument>.Empty).ToListAsync();

    [SkippableFact]
    public async Task Starting_drops_the_token_keyed_index_and_keeps_the_board_key_one()
    {
        Skip.If(Uri is null, SkipReason);
        await _runs.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(
            Builders<BsonDocument>.IndexKeys.Ascending("day").Ascending("boardToken"),
            new CreateIndexOptions { Unique = true, Name = "uniq_day_board" }));

        await _ledger.EnsureIndexesAsync(default);
        await _ledger.EnsureIndexesAsync(default);

        var indexes = await (await _runs.Indexes.ListAsync()).ToListAsync();
        Assert.DoesNotContain(indexes, i => i["name"] == "uniq_day_board");
        Assert.Contains(indexes, i => i["name"] == "uniq_day_boardkey" && i["unique"].ToBoolean());
    }

    [SkippableFact]
    public async Task Publishing_twice_in_a_day_leaves_one_row_per_board_keyed_only_by_board()
    {
        Skip.If(Uri is null, SkipReason);
        await _ledger.EnsureIndexesAsync(default);

        await _ledger.MarkPendingAsync(Day, Wiz, "run-1", DateTime.UtcNow, default);
        await _ledger.MarkDoneAsync(Day, Wiz, new BsonDocument(), DateTime.UtcNow, default);
        await _ledger.MarkPendingAsync(Day, Wiz, "run-2", DateTime.UtcNow, default);

        var row = (await RowsAsync()).Single();
        Assert.Equal("greenhouse:wizinc", row["boardKey"].AsString);
        Assert.Equal("pending", row["status"].AsString);
        Assert.Equal("run-2", row["runId"].AsString);
        Assert.False(row.Contains("boardToken"));   // no longer written since 2c
        Assert.Equal(["greenhouse:wizinc"], await _ledger.PendingAsync(Day, default));
    }

    [SkippableFact]
    public async Task The_same_token_on_another_source_is_a_row_of_its_own()
    {
        // What 2c unblocks: under the old (day, boardToken) index the second
        // board could not have a row for the day at all.
        Skip.If(Uri is null, SkipReason);
        await _ledger.EnsureIndexesAsync(default);

        await _ledger.MarkPendingAsync(Day, Wiz, "run-1", DateTime.UtcNow, default);
        await _ledger.MarkFailedAsync(Day, "workday:wizinc", new Exception("boom"), DateTime.UtcNow, default);

        var rows = (await RowsAsync()).ToDictionary(r => r["boardKey"].AsString);
        Assert.Equal("pending", rows["greenhouse:wizinc"]["status"].AsString);
        Assert.Equal("failed", rows["workday:wizinc"]["status"].AsString);
    }
}
