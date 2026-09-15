using ApplicationTracker.Infrastructure.Repositories;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ArchitectureTests;

/// <summary>
/// The merge against a real Mongo. Skipped when there isn't one.
/// </summary>
/// <remarks>
/// The unit tests cover the collision rules and the classification, but not the
/// two things that can only go wrong against a database: re-keying a document
/// whose _id is immutable, and the post-condition pass that catches a
/// mis-classified collection. Those are exactly the parts that were got wrong
/// once, so leaving them to a manual sign-in would put the least-understood
/// code behind the least-repeatable check.
///
/// Uses a uniquely-named database per run and drops it afterwards, so it can
/// never be pointed at anything real — the failure mode of a "scratch" name
/// that turns out to be a live database is not one to leave to discipline.
/// Set NEXTROLE_TEST_MONGO to use something other than a local Mongo.
/// </remarks>
public class UserMergeIntegrationTests : IAsyncLifetime
{
    private static readonly Guid Anon = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid Account = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private MongoClient? _client;
    private string _trackerName = "";
    private string _profileName = "";
    private IMongoDatabase? _tracker;
    private IMongoDatabase? _profile;

    public async Task InitializeAsync()
    {
        var uri = Environment.GetEnvironmentVariable("NEXTROLE_TEST_MONGO") ?? "mongodb://localhost:27017";
        var settings = MongoClientSettings.FromConnectionString(uri);
        settings.ServerSelectionTimeout = TimeSpan.FromSeconds(2);

        try
        {
            var client = new MongoClient(settings);
            await client.ListDatabaseNamesAsync();   // forces a real connection
            _client = client;
        }
        catch
        {
            return;   // no Mongo; every test skips
        }

        var suffix = Guid.NewGuid().ToString("N")[..8];
        _trackerName = $"nextrole-mergetest-{suffix}";
        _profileName = $"nextrole-mergetest-{suffix}-profile";
        _tracker = _client.GetDatabase(_trackerName);
        _profile = _client.GetDatabase(_profileName);
    }

    public async Task DisposeAsync()
    {
        if (_client is null) return;
        await _client.DropDatabaseAsync(_trackerName);
        await _client.DropDatabaseAsync(_profileName);
    }

    private UserMergeService Service() =>
        new(_tracker!, _profile!, NullLogger<UserMergeService>.Instance);

    private bool NoMongo() => _client is null;

    private async Task SeedAnonymousAsync(bool withProfile = false)
    {
        await _tracker!.GetCollection<BsonDocument>("applications").InsertOneAsync(new BsonDocument
        {
            { "_id", Guid.NewGuid().ToString() }, { "UserId", Anon.ToString() }, { "Company", "Acme" },
        });

        // Composite _id — the shape that was mis-classified.
        await _tracker.GetCollection<BsonDocument>("jobScores").InsertOneAsync(new BsonDocument
        {
            { "_id", $"{Anon}:job-1" }, { "UserId", Anon.ToString() }, { "JobId", "job-1" },
            { "Score", 70 }, { "ScoredAt", DateTime.UtcNow },
        });

        await _tracker.GetCollection<BsonDocument>("poolJobState").InsertOneAsync(new BsonDocument
        {
            { "_id", $"{Anon}:job-1" }, { "UserId", Anon.ToString() }, { "JobId", "job-1" },
            { "SavedToTracker", true }, { "Dismissed", false }, { "UpdatedAt", DateTime.UtcNow },
        });

        // snake_case, scraper-owned.
        await _tracker.GetCollection<BsonDocument>("search_criteria").InsertOneAsync(new BsonDocument
        {
            { "_id", ObjectId.GenerateNewId() }, { "user_id", Anon.ToString() }, { "name", "Remote" },
        });

        if (withProfile)
            await _profile!.GetCollection<BsonDocument>("profile").InsertOneAsync(new BsonDocument
            {
                { "_id", Anon.ToString() }, { "content", "anonymous CV" },
            });
    }

    // ---- The whole thing ---------------------------------------------------

    [MongoFact]
    public async Task Everything_moves_and_nothing_is_left_pointing_at_the_retired_user()
    {
        if (NoMongo()) return;
        await SeedAnonymousAsync();

        var outcome = await Service().MergeAsync(Anon, Account);

        Assert.True(outcome.Merged);
        Assert.Empty(await Service().FindLeaksAsync(Anon));
    }

    [MongoFact]
    public async Task A_composite_key_is_rebuilt_not_just_its_field()
    {
        // The bug that would otherwise ship silently: update UserId, leave _id
        // naming the old user. The field looks right and the key is wrong, so
        // the next upsert — which computes the key from the NEW userId —
        // inserts a second row instead of updating this one.
        if (NoMongo()) return;
        await SeedAnonymousAsync();

        await Service().MergeAsync(Anon, Account);

        var scores = _tracker!.GetCollection<BsonDocument>("jobScores");
        var row = await scores.Find(FilterDefinition<BsonDocument>.Empty).SingleAsync();

        Assert.Equal($"{Account}:job-1", row["_id"].AsString);
        Assert.Equal(Account.ToString(), row["UserId"].AsString);
        Assert.Equal(1, await scores.CountDocumentsAsync(FilterDefinition<BsonDocument>.Empty));
    }

    [MongoFact]
    public async Task The_snake_case_collection_is_not_missed()
    {
        if (NoMongo()) return;
        await SeedAnonymousAsync();

        await Service().MergeAsync(Anon, Account);

        var row = await _tracker!.GetCollection<BsonDocument>("search_criteria")
            .Find(FilterDefinition<BsonDocument>.Empty).SingleAsync();
        Assert.Equal(Account.ToString(), row["user_id"].AsString);
    }

    [MongoFact]
    public async Task Colliding_pool_state_takes_the_union_and_leaves_one_row()
    {
        if (NoMongo()) return;
        await SeedAnonymousAsync();
        await _tracker!.GetCollection<BsonDocument>("poolJobState").InsertOneAsync(new BsonDocument
        {
            { "_id", $"{Account}:job-1" }, { "UserId", Account.ToString() }, { "JobId", "job-1" },
            { "SavedToTracker", false }, { "Dismissed", true }, { "UpdatedAt", DateTime.UtcNow.AddDays(-1) },
        });

        await Service().MergeAsync(Anon, Account);

        var col = _tracker.GetCollection<BsonDocument>("poolJobState");
        var row = await col.Find(FilterDefinition<BsonDocument>.Empty).SingleAsync();

        Assert.True(row["SavedToTracker"].AsBoolean);   // from the anonymous session
        Assert.True(row["Dismissed"].AsBoolean);        // from the account
        Assert.Equal(1, await col.CountDocumentsAsync(FilterDefinition<BsonDocument>.Empty));
    }

    // ---- Singletons --------------------------------------------------------

    [MongoFact]
    public async Task A_singleton_moves_when_the_account_has_none()
    {
        if (NoMongo()) return;
        await SeedAnonymousAsync(withProfile: true);

        var outcome = await Service().MergeAsync(Anon, Account);

        Assert.Empty(outcome.ParkedSingletons);
        var row = await _profile!.GetCollection<BsonDocument>("profile")
            .Find(FilterDefinition<BsonDocument>.Empty).SingleAsync();
        Assert.Equal(Account.ToString(), row["_id"].AsString);
        Assert.Equal("anonymous CV", row["content"].AsString);
    }

    [MongoFact]
    public async Task A_colliding_singleton_is_parked_and_reported_never_deleted()
    {
        if (NoMongo()) return;
        await SeedAnonymousAsync(withProfile: true);
        await _profile!.GetCollection<BsonDocument>("profile").InsertOneAsync(new BsonDocument
        {
            { "_id", Account.ToString() }, { "content", "the account's CV" },
        });

        var outcome = await Service().MergeAsync(Anon, Account);

        Assert.Contains("profile", outcome.ParkedSingletons);

        var col = _profile.GetCollection<BsonDocument>("profile");
        var kept = await col.Find(new BsonDocument("_id", Account.ToString())).SingleAsync();
        Assert.Equal("the account's CV", kept["content"].AsString);   // signed-in account wins

        // Parked, not destroyed — it is still there under the retired id, which
        // is what makes the notice honest rather than an apology.
        var parked = await col.Find(new BsonDocument("_id", Anon.ToString())).SingleAsync();
        Assert.Equal("anonymous CV", parked["content"].AsString);
    }

    // ---- Idempotency and partial failure -----------------------------------

    [MongoFact]
    public async Task Running_it_twice_changes_nothing_the_second_time()
    {
        if (NoMongo()) return;
        await SeedAnonymousAsync();

        var first = await Service().MergeAsync(Anon, Account);
        var second = await Service().MergeAsync(Anon, Account);

        Assert.True(first.Merged);
        Assert.False(second.Merged);   // fast path: the source is empty now
        Assert.Equal(1, await _tracker!.GetCollection<BsonDocument>("jobScores")
            .CountDocumentsAsync(FilterDefinition<BsonDocument>.Empty));
    }

    [MongoFact]
    public async Task A_half_finished_merge_is_completed_by_re_running_it()
    {
        // The reason there is no transaction: a killed process leaves some
        // collections moved and some not, and re-running finishes rather than
        // unwinding. Simulated by moving one collection by hand first.
        if (NoMongo()) return;
        await SeedAnonymousAsync();

        await _tracker!.GetCollection<BsonDocument>("applications").UpdateManyAsync(
            new BsonDocument("UserId", Anon.ToString()),
            new BsonDocument("$set", new BsonDocument("UserId", Account.ToString())));

        var outcome = await Service().MergeAsync(Anon, Account);

        Assert.True(outcome.Merged);
        Assert.Empty(await Service().FindLeaksAsync(Anon));
    }

    [MongoFact]
    public async Task Merging_a_user_into_themselves_does_nothing()
    {
        if (NoMongo()) return;
        await SeedAnonymousAsync();

        var outcome = await Service().MergeAsync(Anon, Anon);

        Assert.False(outcome.Merged);
    }

    // ---- The guard itself --------------------------------------------------

    [MongoFact]
    public async Task The_leak_check_sees_a_stale_composite_key_that_a_field_check_would_miss()
    {
        // Proves the post-condition is worth having: this is precisely the
        // state a mis-classified collection leaves behind — field correct, key
        // stale — and a check that only looked at UserId would report clean.
        if (NoMongo()) return;
        await _tracker!.GetCollection<BsonDocument>("jobScores").InsertOneAsync(new BsonDocument
        {
            { "_id", $"{Anon}:job-1" },
            { "UserId", Account.ToString() },   // moved
            { "JobId", "job-1" },
        });

        var leaks = await Service().FindLeaksAsync(Anon);

        Assert.Contains("jobScores(_id)", leaks);
    }
}

/// <summary>
/// A Fact that skips — visibly, in the runner output — when no Mongo is
/// reachable, rather than passing vacuously.
/// </summary>
/// <remarks>
/// A test that silently returns when its dependency is missing is worse than
/// no test: it reports green while asserting nothing. xUnit 2.9 has no runtime
/// Assert.Skip, so availability is decided once at discovery.
/// </remarks>
public sealed class MongoFactAttribute : FactAttribute
{
    private static readonly Lazy<bool> Available = new(() =>
    {
        try
        {
            var uri = Environment.GetEnvironmentVariable("NEXTROLE_TEST_MONGO") ?? "mongodb://localhost:27017";
            var settings = MongoClientSettings.FromConnectionString(uri);
            settings.ServerSelectionTimeout = TimeSpan.FromSeconds(2);
            new MongoClient(settings).ListDatabaseNames().MoveNext();
            return true;
        }
        catch { return false; }
    });

    public MongoFactAttribute()
    {
        if (!Available.Value)
            Skip = "No Mongo reachable. Start one locally or set NEXTROLE_TEST_MONGO.";
    }
}
