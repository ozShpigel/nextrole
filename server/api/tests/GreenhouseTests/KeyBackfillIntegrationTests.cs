using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The key backfill (docs/plans/key-migration.md, 2a) against a real MongoDB --
/// the aggregation pipeline, the null checks and the unique index are all the
/// server's behaviour, which a fake store cannot show.
/// </summary>
/// <remarks>
/// <para>
/// <b>Skipped unless pointed at a disposable server:</b>
/// <code>
/// docker run -d --rm --name keys-it -p 27099:27017 mongo:7
/// GREENHOUSE_KEYS_IT_MONGO=mongodb://localhost:27099
/// </code>
/// </para>
/// <para>
/// Each test makes its own database with a random name, refuses to run if that
/// name already exists (AGENTS.md: confirm a database name is free before
/// writing into it), and drops it afterwards.
/// </para>
/// </remarks>
public sealed class KeyBackfillIntegrationTests : IAsyncLifetime
{
    private static readonly string? Uri = Environment.GetEnvironmentVariable("GREENHOUSE_KEYS_IT_MONGO");
    private const string SkipReason = "Set GREENHOUSE_KEYS_IT_MONGO to a disposable MongoDB to run.";

    private MongoClient? _client;
    private string _dbName = "";
    private IMongoCollection<BsonDocument> _jobs = null!;
    private JobStore _store = null!;

    public async Task InitializeAsync()
    {
        if (Uri is null) return;

        _client = new MongoClient(Uri);
        _dbName = $"keys-it-{Guid.NewGuid():N}";
        var existing = await (await _client.ListDatabaseNamesAsync()).ToListAsync();
        if (existing.Contains(_dbName))
            throw new InvalidOperationException($"Database {_dbName} already exists; refusing to write into it.");

        _jobs = _client.GetDatabase(_dbName).GetCollection<BsonDocument>(GreenhouseJobFields.Collection);
        _store = new JobStore(_jobs, NullLogger<JobStore>.Instance);
    }

    public async Task DisposeAsync()
    {
        if (_client is not null) await _client.DropDatabaseAsync(_dbName);
    }

    /// <summary>A row exactly as the ingest wrote it before 2a.</summary>
    private static BsonDocument OldRow(string token, BsonValue id, string? source = "greenhouse")
    {
        var doc = new BsonDocument
        {
            { GreenhouseJobFields.BoardToken, token },
            { GreenhouseJobFields.GreenhouseJobId, id },
            { GreenhouseJobFields.Title, "Engineer" },
            { GreenhouseJobFields.ContentHash, "h" },
        };
        if (source is not null) doc[GreenhouseJobFields.Source] = source;
        return doc;
    }

    private static GreenhouseJob Job(string token, long id)
    {
        var listed = new ListedPosting(id.ToString(), "Engineer", "Tel Aviv", [], [], null, null);
        return GreenhouseJob.From("greenhouse", token, new SourcePosting(listed, "<p>x</p>", null, null, null));
    }

    [SkippableFact]
    public async Task Old_rows_get_the_key_derived_from_the_old_one_and_a_second_pass_fills_nothing()
    {
        Skip.If(Uri is null, SkipReason);
        await _jobs.InsertManyAsync(
        [
            OldRow("wizinc", 7184512L),
            OldRow("wizinc", 7184513L, source: null),   // written before `source` existed
            OldRow("monzo", new BsonDouble(55.0)),        // a double id still keys as digits
        ]);

        Assert.Equal(3, await _store.BackfillKeysAsync(default));
        Assert.Equal(0, await _store.BackfillKeysAsync(default));

        var rows = (await _jobs.Find(FilterDefinition<BsonDocument>.Empty).ToListAsync())
            .ToDictionary(d => d[GreenhouseJobFields.SourceJobId].AsString);

        Assert.Equal("greenhouse:wizinc", rows["7184512"][GreenhouseJobFields.BoardKey].AsString);
        Assert.Equal("greenhouse:wizinc", rows["7184513"][GreenhouseJobFields.BoardKey].AsString);
        Assert.Equal("greenhouse", rows["7184513"][GreenhouseJobFields.Source].AsString);
        Assert.Equal("greenhouse:monzo", rows["55"][GreenhouseJobFields.BoardKey].AsString);
        // Nothing else on the row moved.
        Assert.Equal(7184512L, rows["7184512"][GreenhouseJobFields.GreenhouseJobId].AsInt64);
        Assert.Equal("h", rows["7184512"][GreenhouseJobFields.ContentHash].AsString);
    }

    [SkippableFact]
    public async Task The_new_unique_index_builds_over_the_backfilled_rows()
    {
        Skip.If(Uri is null, SkipReason);
        await _jobs.InsertManyAsync([OldRow("wizinc", 1L), OldRow("wizinc", 2L), OldRow("monzo", 1L)]);

        await _store.BackfillKeysAsync(default);
        await _store.EnsureIndexesAsync(default);

        var indexes = await (await _jobs.Indexes.ListAsync()).ToListAsync();
        var unique = indexes.Single(i => i["name"] == "uniq_boardkey_job");
        Assert.True(unique["unique"].ToBoolean());
        Assert.Contains(indexes, i => i["name"] == "idx_boardkey_open");
        Assert.Contains(indexes, i => i["name"] == "uniq_board_job");   // the old one stays until 2c
    }

    [SkippableFact]
    public async Task An_upsert_after_the_backfill_updates_the_existing_row_and_a_new_job_arrives_keyed()
    {
        Skip.If(Uri is null, SkipReason);
        await _jobs.InsertOneAsync(OldRow("wizinc", 7L));
        await _store.BackfillKeysAsync(default);
        await _store.EnsureIndexesAsync(default);

        await _store.UpsertBatchAsync(
            [(Job("wizinc", 7), new float[4]), (Job("wizinc", 8), new float[4])], "run", DateTime.UtcNow, default);

        Assert.Equal(2, await _jobs.CountDocumentsAsync(FilterDefinition<BsonDocument>.Empty));
        var fresh = await _jobs.Find(Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.GreenhouseJobId, 8L)).SingleAsync();
        Assert.Equal("greenhouse:wizinc", fresh[GreenhouseJobFields.BoardKey].AsString);
        Assert.Equal("8", fresh[GreenhouseJobFields.SourceJobId].AsString);
    }

    // ---- 2b: the store reads and writes through the new key -----------------

    private const string Key = "greenhouse:wizinc";

    private async Task SeedAsync(params long[] ids)
    {
        foreach (var id in ids) await _jobs.InsertOneAsync(OldRow("wizinc", id));
        await _store.BackfillKeysAsync(default);
        await _store.EnsureIndexesAsync(default);
    }

    [SkippableFact]
    public async Task Hashes_touch_and_the_close_diff_all_find_the_rows_by_the_new_key()
    {
        Skip.If(Uri is null, SkipReason);
        await SeedAsync(1, 2, 3);

        var hashes = await _store.StoredHashesAsync(Key, default);
        Assert.Equal(["1", "2", "3"], hashes.Keys.Order());

        Assert.Equal(1, await _store.TouchAsync(Key, ["1"], "run", DateTime.UtcNow, default));
        Assert.Equal(1, await _store.CloseMissingAsync(Key, ["1", "2"], 10, DateTime.UtcNow, default));

        var closed = await _jobs.Find(Builders<BsonDocument>.Filter.Ne(GreenhouseJobFields.ClosedAt, BsonNull.Value))
            .ToListAsync();
        Assert.Equal("3", closed.Single()[GreenhouseJobFields.SourceJobId].AsString);

        // The bare token is no longer a board key: it matches nothing.
        Assert.Empty(await _store.StoredHashesAsync("wizinc", default));
    }

    [SkippableFact]
    public async Task Reads_saved_by_string_id_land_on_the_right_row()
    {
        Skip.If(Uri is null, SkipReason);
        // The same id on another board: ids are unique per board, not globally.
        await _jobs.InsertOneAsync(OldRow("monzo", 8L));
        await SeedAsync(7, 8);

        await _store.SaveIngestAiAsync(Key,
            new Dictionary<string, BsonDocument> { ["8"] = new() { { "seniority", "senior" } } },
            new Dictionary<string, BsonDocument>(), null, DateTime.UtcNow, default);

        BsonDocument Row(string board, string id) => _jobs.Find(Builders<BsonDocument>.Filter.And(
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, board),
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.SourceJobId, id))).Single();

        Assert.Equal("senior", Row(Key, "8")[GreenhouseJobFields.Extracted]["seniority"].AsString);
        Assert.False(Row(Key, "7").Contains(GreenhouseJobFields.Extracted));
        Assert.False(Row("greenhouse:monzo", "8").Contains(GreenhouseJobFields.Extracted));
    }

    [SkippableFact]
    public async Task A_write_whose_new_key_misses_its_row_fails_on_the_old_index_instead_of_duplicating()
    {
        // The safety net 2b relies on: Greenhouse rows still carry the old key
        // under its unique index, so a mismatch is an error, never a second row.
        Skip.If(Uri is null, SkipReason);
        await SeedAsync(7);
        await _jobs.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.GreenhouseJobId, 7L),
            Builders<BsonDocument>.Update.Set(GreenhouseJobFields.BoardKey, "greenhouse:something-else"));

        await Assert.ThrowsAsync<MongoBulkWriteException<BsonDocument>>(() =>
            _store.UpsertBatchAsync([(Job("wizinc", 7), new float[4])], "run", DateTime.UtcNow, default));
        Assert.Equal(1, await _jobs.CountDocumentsAsync(FilterDefinition<BsonDocument>.Empty));
    }

    [SkippableFact]
    public async Task A_batch_recorded_before_2b_is_read_with_its_board_key_and_string_ids()
    {
        Skip.If(Uri is null, SkipReason);
        var raw = _client!.GetDatabase(_dbName).GetCollection<BsonDocument>("ai_batches");
        await raw.InsertOneAsync(new BsonDocument
        {
            { "_id", "msgbatch_old" }, { "kind", AiBatchRecord.Facts }, { "boardToken", "wizinc" },
            { "jobIds", new BsonArray { 7184512L, 55L } }, { "parseVersion", BsonNull.Value },
            { "submittedAt", DateTime.UtcNow }, { "status", "pending" },
        });
        var store = new AiBatchStore(raw);
        await store.RecordAsync(new AiBatchRecord
        {
            BatchId = "msgbatch_new", Kind = AiBatchRecord.Facts, BoardKey = Key, JobIds = ["R-12"],
            SubmittedAt = DateTime.UtcNow.AddSeconds(1),
        }, default);

        var pending = (await store.PendingAsync(default)).ToDictionary(b => b.BatchId);

        Assert.Equal(Key, pending["msgbatch_old"].BoardKey);
        Assert.Equal(["7184512", "55"], pending["msgbatch_old"].JobIds);
        Assert.Equal(Key, pending["msgbatch_new"].BoardKey);
        Assert.Equal(["R-12"], pending["msgbatch_new"].JobIds);
    }

    [SkippableFact]
    public async Task Removed_boards_are_counted_and_closed_by_board_key()
    {
        // Phase 3: the removed-boards check compares board keys, so the store
        // must group and close by them.
        Skip.If(Uri is null, SkipReason);
        await _jobs.InsertManyAsync([OldRow("wizinc", 1L), OldRow("wizinc", 2L), OldRow("monzo", 3L)]);
        await _store.BackfillKeysAsync(default);
        await _store.EnsureIndexesAsync(default);

        var open = await _store.OpenCountsByBoardAsync(default);
        Assert.Equal(2, open[Key]);
        Assert.Equal(1, open["greenhouse:monzo"]);

        Assert.Equal(1, await _store.CloseBoardsAsync(["greenhouse:monzo"], DateTime.UtcNow, default));
        Assert.Equal(0, await _store.CloseBoardsAsync(["monzo"], DateTime.UtcNow, default));   // a bare token closes nothing
        Assert.Equal(2, (await _store.OpenCountsByBoardAsync(default))[Key]);
    }

    [SkippableFact]
    public async Task A_row_that_cannot_be_keyed_stops_the_start_and_says_so()
    {
        Skip.If(Uri is null, SkipReason);
        await _jobs.InsertManyAsync(
        [
            OldRow("wizinc", 1L),
            new BsonDocument { { GreenhouseJobFields.BoardToken, "wizinc" }, { GreenhouseJobFields.Title, "no id" } },
        ]);

        var e = await Assert.ThrowsAsync<InvalidOperationException>(() => _store.BackfillKeysAsync(default));
        Assert.Contains("1 row(s)", e.Message);
    }
}
