using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// <see cref="JobStore"/> against a real MongoDB -- the unique index, the
/// per-board filters and the index drops are the server's behaviour, which a
/// fake store cannot show.
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
public sealed class JobStoreIntegrationTests : IAsyncLifetime
{
    private static readonly string? Uri = Environment.GetEnvironmentVariable("GREENHOUSE_KEYS_IT_MONGO");
    private const string SkipReason = "Set GREENHOUSE_KEYS_IT_MONGO to a disposable MongoDB to run.";
    private const string Key = "greenhouse:wizinc";

    private MongoClient? _client;
    private string _dbName = "";
    private IMongoCollection<BsonDocument> _jobs = null!;
    private JobStore _store = null!;

    public async Task InitializeAsync()
    {
        if (Uri is null) return;

        _client = new MongoClient(Uri);
        _dbName = $"jobstore-it-{Guid.NewGuid():N}";
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

    private static GreenhouseJob Job(string token, string id, string source = "greenhouse")
    {
        var listed = new ListedPosting(id, "Engineer", "Tel Aviv", [], [], null, null);
        return GreenhouseJob.From(source, token, new SourcePosting(listed, "<p>x</p>", null, null, null));
    }

    /// <summary>Store these Greenhouse postings the way a run does, through the upsert.</summary>
    private async Task SeedAsync(params (string Token, string Id)[] jobs)
    {
        await _store.EnsureIndexesAsync(default);
        await _store.UpsertBatchAsync([.. jobs.Select(j => (Job(j.Token, j.Id), new float[4]))], "seed", DateTime.UtcNow, default);
    }

    private async Task<List<string>> IndexNamesAsync() =>
        [.. (await (await _jobs.Indexes.ListAsync()).ToListAsync()).Select(i => i["name"].AsString)];

    // ---- 2c: the old Greenhouse-only indexes are gone ----------------------------------

    [SkippableFact]
    public async Task Starting_drops_the_old_token_keyed_indexes_and_keeps_the_board_key_ones()
    {
        Skip.If(Uri is null, SkipReason);
        // As every database had them before 2c.
        await _jobs.Indexes.CreateManyAsync(
        [
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("boardToken").Ascending("greenhouseJobId"),
                new CreateIndexOptions { Unique = true, Name = "uniq_board_job" }),
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("boardToken").Ascending("closedAt"),
                new CreateIndexOptions { Name = "idx_board_open" }),
        ]);

        await _store.EnsureIndexesAsync(default);
        await _store.EnsureIndexesAsync(default);   // and a second start finds nothing to drop

        var names = await IndexNamesAsync();
        Assert.DoesNotContain("uniq_board_job", names);
        Assert.DoesNotContain("idx_board_open", names);
        Assert.Contains("uniq_boardkey_job", names);
        Assert.Contains("idx_boardkey_open", names);
    }

    [SkippableFact]
    public async Task Two_postings_with_no_greenhouse_id_on_one_board_both_store()
    {
        // The reason 2c exists: under the old (boardToken, greenhouseJobId)
        // unique index, the second of these collided on (token, null).
        Skip.If(Uri is null, SkipReason);
        await _store.EnsureIndexesAsync(default);

        await _store.UpsertBatchAsync(
            [(Job("acme", "R-12", "workday"), new float[4]), (Job("acme", "R-13", "workday"), new float[4])],
            "run", DateTime.UtcNow, default);

        Assert.Equal(2, await _jobs.CountDocumentsAsync(
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, "workday:acme")));
    }

    [SkippableFact]
    public async Task A_new_row_carries_the_board_key_and_no_legacy_numeric_id()
    {
        Skip.If(Uri is null, SkipReason);
        await SeedAsync(("wizinc", "7"));

        var row = await _jobs.Find(FilterDefinition<BsonDocument>.Empty).SingleAsync();
        Assert.Equal(Key, row[GreenhouseJobFields.BoardKey].AsString);
        Assert.Equal("7", row[GreenhouseJobFields.SourceJobId].AsString);
        Assert.Equal("wizinc", row[GreenhouseJobFields.BoardToken].AsString);
        Assert.False(row.Contains(GreenhouseJobFields.GreenhouseJobId));
    }

    // ---- the store reads and writes through the board key -----------------------------

    [SkippableFact]
    public async Task An_upsert_updates_the_existing_row_and_a_new_job_arrives_keyed()
    {
        Skip.If(Uri is null, SkipReason);
        await SeedAsync(("wizinc", "7"));

        await _store.UpsertBatchAsync(
            [(Job("wizinc", "7"), new float[4]), (Job("wizinc", "8"), new float[4])], "run", DateTime.UtcNow, default);

        Assert.Equal(2, await _jobs.CountDocumentsAsync(FilterDefinition<BsonDocument>.Empty));
    }

    [SkippableFact]
    public async Task Hashes_touch_and_the_close_diff_all_find_the_rows_by_the_board_key()
    {
        Skip.If(Uri is null, SkipReason);
        await SeedAsync(("wizinc", "1"), ("wizinc", "2"), ("wizinc", "3"));

        var hashes = await _store.StoredHashesAsync(Key, default);
        Assert.Equal(["1", "2", "3"], hashes.Keys.Order());

        Assert.Equal(1, await _store.TouchAsync(Key, ["1"], "run", DateTime.UtcNow, default));
        Assert.Equal(1, await _store.CloseMissingAsync(Key, ["1", "2"], 10, DateTime.UtcNow, default));

        var closed = await _jobs.Find(Builders<BsonDocument>.Filter.Ne(GreenhouseJobFields.ClosedAt, BsonNull.Value))
            .ToListAsync();
        Assert.Equal("3", closed.Single()[GreenhouseJobFields.SourceJobId].AsString);

        // The bare token is not a board key: it matches nothing.
        Assert.Empty(await _store.StoredHashesAsync("wizinc", default));
    }

    [SkippableFact]
    public async Task Reads_saved_by_string_id_land_on_the_right_row()
    {
        Skip.If(Uri is null, SkipReason);
        // The same id on another board: ids are unique per board, not globally.
        await SeedAsync(("wizinc", "7"), ("wizinc", "8"), ("monzo", "8"));

        await _store.SaveIngestAiAsync(Key,
            new Dictionary<string, BsonDocument> { ["8"] = new() { { "seniority", "senior" } } },
            new Dictionary<string, BsonDocument>(), null, DateTime.UtcNow, default);

        BsonDocument Row(string board, string id) => _jobs.Find(Builders<BsonDocument>.Filter.And(
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.BoardKey, board),
            Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.SourceJobId, id))).Single();

        Assert.Equal("senior", Row(Key, "8")[GreenhouseJobFields.Extracted]["seniority"].AsString);
        Assert.True(Row(Key, "7")[GreenhouseJobFields.Extracted]["seniority"].IsBsonNull);
        Assert.True(Row("greenhouse:monzo", "8")[GreenhouseJobFields.Extracted]["seniority"].IsBsonNull);
    }

    [SkippableFact]
    public async Task A_batch_recorded_before_2b_is_read_with_its_board_key_and_string_ids()
    {
        // Batches older than 48h are abandoned, so none from before 2b remains;
        // the reader keeps the old shape anyway, at no cost, for a restored backup.
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

    // ---- the facts version: a re-read by version, once (hardware_engineering) -------

    /// <summary>A stored posting whose facts were read, as it looks before versions.</summary>
    private async Task ReadAsync(string source, string token, string id, int attempts, int? version = null)
    {
        await _store.EnsureIndexesAsync(default);
        await _store.UpsertBatchAsync([(Job(token, id, source), new float[4])], "seed", DateTime.UtcNow, default);
        var set = Builders<BsonDocument>.Update
            .Set(GreenhouseJobFields.Extracted, new BsonDocument
            {
                { "must_have_groups", new BsonArray() }, { "functions", new BsonArray { "software_engineering" } },
            })
            .Set(GreenhouseJobFields.ExtractAttempts, attempts);
        if (version is { } v) set = set.Set(GreenhouseJobFields.FactsVersion, v);
        await _jobs.UpdateOneAsync(Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.SourceJobId, id), set);
    }

    private async Task<List<string>> ReReadAsync(string boardKey) =>
        [.. (await _store.NeedingFactsReReadAsync(boardKey, 100, default)).Select(p => p.SourceJobId)];

    [SkippableFact]
    public async Task A_workday_posting_read_by_an_older_prompt_is_re_read_whatever_its_attempts()
    {
        Skip.If(Uri is null, SkipReason);
        await ReadAsync("workday", "acme", "Stale_R1", attempts: 3);                 // past the old ceiling
        await ReadAsync("workday", "acme", "Current_R2", attempts: 1, version: IngestAiClient.FactsVersion);
        await ReadAsync("greenhouse", "wizinc", "9", attempts: 1);                     // unversioned, but Greenhouse

        Assert.Equal(["Stale_R1"], await ReReadAsync("workday:acme"));
        Assert.Empty(await ReReadAsync(Key));   // Greenhouse ages out instead (FactsReReadSources)
    }

    [SkippableFact]
    public async Task A_read_that_returns_nothing_still_stamps_the_version_so_it_is_made_once()
    {
        Skip.If(Uri is null, SkipReason);
        await ReadAsync("workday", "acme", "Stale_R1", attempts: 3);
        Assert.Equal(["Stale_R1"], await ReReadAsync("workday:acme"));

        // The model returned no facts for it: the attempt alone is recorded.
        await _store.SaveIngestAiAsync("workday:acme", new Dictionary<string, BsonDocument>(),
            new Dictionary<string, BsonDocument>(), null, DateTime.UtcNow, default, factsAttempted: ["Stale_R1"]);

        Assert.Empty(await ReReadAsync("workday:acme"));
        var row = await _jobs.Find(Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.SourceJobId, "Stale_R1")).SingleAsync();
        Assert.Equal(IngestAiClient.FactsVersion, row[GreenhouseJobFields.FactsVersion].AsInt32);
        Assert.Equal(4, row[GreenhouseJobFields.ExtractAttempts].AsInt32);
    }

    [SkippableFact]
    public async Task Facts_saved_without_an_attempt_list_leave_the_version_alone()
    {
        // An old batch's facts are stored, but only a read the version is
        // known for may claim it.
        Skip.If(Uri is null, SkipReason);
        await ReadAsync("workday", "acme", "Stale_R1", attempts: 1);

        // Complete facts -- groups and functions both present -- so the old
        // missing-field reason cannot select it: only the version decides.
        await _store.SaveIngestAiAsync("workday:acme",
            new Dictionary<string, BsonDocument>
            {
                ["Stale_R1"] = new() { { "must_have_groups", new BsonArray() }, { "functions", new BsonArray { "qa" } } },
            },
            new Dictionary<string, BsonDocument>(), null, DateTime.UtcNow, default);

        Assert.Equal(["Stale_R1"], await ReReadAsync("workday:acme"));
    }

    [SkippableFact]
    public async Task A_batch_record_keeps_the_facts_version_it_was_submitted_with()
    {
        Skip.If(Uri is null, SkipReason);
        var store = new AiBatchStore(_client!.GetDatabase(_dbName).GetCollection<BsonDocument>("ai_batches"));
        await store.RecordAsync(new AiBatchRecord
        {
            BatchId = "b_v", Kind = AiBatchRecord.Facts, BoardKey = Key, JobIds = ["1"], FactsVersion = 3,
            SubmittedAt = DateTime.UtcNow,
        }, default);
        await store.RecordAsync(new AiBatchRecord
        {
            BatchId = "b_none", Kind = AiBatchRecord.Parse, BoardKey = Key, JobIds = ["1"],
            SubmittedAt = DateTime.UtcNow.AddSeconds(1),
        }, default);

        var pending = (await store.PendingAsync(default)).ToDictionary(b => b.BatchId);

        Assert.Equal(3, pending["b_v"].FactsVersion);
        Assert.Null(pending["b_none"].FactsVersion);
    }

    [SkippableFact]
    public async Task The_too_old_memory_keeps_dates_per_board_refreshes_them_and_expires_them()
    {
        Skip.If(Uri is null, SkipReason);
        var memory = new TooOldMemory(_client!.GetDatabase(_dbName).GetCollection<BsonDocument>(TooOldMemory.CollectionName));
        await memory.EnsureIndexesAsync(default);
        var old = new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc);

        await memory.RememberAsync("workday:acme", [("R-1", old), ("R-2", old)], DateTime.UtcNow, default);
        await memory.RememberAsync("workday:acme", [("R-1", old.AddDays(1))], DateTime.UtcNow, default);   // refreshed, not doubled
        await memory.RememberAsync("workday:other", [("R-1", old)], DateTime.UtcNow, default);

        var acme = await memory.RememberedAsync("workday:acme", default);
        Assert.Equal(2, acme.Count);
        Assert.Equal(old.AddDays(1), acme["R-1"]);
        Assert.Single(await memory.RememberedAsync("workday:other", default));

        var ttl = (await (await _client.GetDatabase(_dbName).GetCollection<BsonDocument>(TooOldMemory.CollectionName)
            .Indexes.ListAsync()).ToListAsync()).Single(i => i["name"] == "ttl_checked");
        Assert.Equal(TooOldMemory.KeptFor.TotalSeconds, ttl["expireAfterSeconds"].ToDouble());
    }

    [SkippableFact]
    public async Task Detail_reads_are_stamped_on_stored_rows_only_and_read_back_per_board()
    {
        Skip.If(Uri is null, SkipReason);
        await SeedAsync(("wizinc", "1"), ("wizinc", "2"));
        var at = new DateTime(2026, 9, 25, 0, 0, 0, DateTimeKind.Utc);

        await _store.StampDetailReadsAsync(Key,
            [new DetailRead("1", "sig-1", at), new DetailRead("never-stored", "sig-x", at)], default);

        var states = await _store.ListingStatesAsync(Key, default);
        Assert.Equal(("sig-1", (DateTime?)at), (states["1"].Signature, states["1"].DetailReadAt));
        Assert.Equal((null, (DateTime?)null), (states["2"].Signature, states["2"].DetailReadAt));
        Assert.False(states.ContainsKey("never-stored"));                           // not created
        Assert.Equal(2, await _jobs.CountDocumentsAsync(FilterDefinition<BsonDocument>.Empty));
    }

    [SkippableFact]
    public async Task Removed_boards_are_counted_and_closed_by_board_key()
    {
        Skip.If(Uri is null, SkipReason);
        await SeedAsync(("wizinc", "1"), ("wizinc", "2"), ("monzo", "3"));

        var open = await _store.OpenCountsByBoardAsync(default);
        Assert.Equal(2, open[Key]);
        Assert.Equal(1, open["greenhouse:monzo"]);

        Assert.Equal(1, await _store.CloseBoardsAsync(["greenhouse:monzo"], DateTime.UtcNow, default));
        Assert.Equal(0, await _store.CloseBoardsAsync(["monzo"], DateTime.UtcNow, default));   // a bare token closes nothing
        Assert.Equal(2, (await _store.OpenCountsByBoardAsync(default))[Key]);
    }
}
