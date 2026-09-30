using ApplicationTracker.Core.Models;
using ApplicationTracker.Infrastructure.Repositories;
using MongoDB.Driver;
using Xunit;

namespace ArchitectureTests;

/// <summary>
/// The daily add limit against a real MongoDB: the atomic claim, the refund,
/// and concurrency -- the parts a fake cannot prove.
/// </summary>
/// <remarks>
/// <b>Skipped unless pointed at a disposable server</b>, the same switch the
/// Greenhouse integration tests use (GREENHOUSE_KEYS_IT_MONGO). Each run writes
/// into a fresh, uniquely named database and refuses one that already exists.
/// </remarks>
public sealed class UserQuotaAddIntegrationTests : IAsyncLifetime
{
    private static readonly string? Uri = Environment.GetEnvironmentVariable("GREENHOUSE_KEYS_IT_MONGO");
    private const string SkipReason = "Set GREENHOUSE_KEYS_IT_MONGO to a disposable MongoDB to run.";
    private const int Limit = 3;

    private MongoClient? _client;
    private string _dbName = "";
    private UserQuotaRepository _quota = null!;
    private readonly Guid _user = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        if (Uri is null) return;
        _client = new MongoClient(Uri);
        _dbName = $"quota-it-{Guid.NewGuid():N}";
        var existing = await (await _client.ListDatabaseNamesAsync()).ToListAsync();
        if (existing.Contains(_dbName))
            throw new InvalidOperationException($"Database {_dbName} already exists; refusing to write into it.");
        _quota = new UserQuotaRepository(_client.GetDatabase(_dbName).GetCollection<UserQuota>("userQuotas"));
    }

    public async Task DisposeAsync()
    {
        if (_client is not null) await _client.DropDatabaseAsync(_dbName);
    }

    [SkippableFact]
    public async Task Three_adds_a_day_then_refused()
    {
        Skip.If(Uri is null, SkipReason);

        for (var i = 0; i < Limit; i++)
            Assert.True(await _quota.TryConsumeAddAsync(_user, Limit));

        Assert.False(await _quota.TryConsumeAddAsync(_user, Limit));
        Assert.Equal(Limit, await _quota.AddsUsedTodayAsync(_user));
    }

    [SkippableFact]
    public async Task A_refund_gives_the_add_back_and_never_goes_below_zero()
    {
        Skip.If(Uri is null, SkipReason);

        for (var i = 0; i < Limit; i++) await _quota.TryConsumeAddAsync(_user, Limit);
        await _quota.RefundAddAsync(_user);
        Assert.True(await _quota.TryConsumeAddAsync(_user, Limit));

        for (var i = 0; i < Limit + 2; i++) await _quota.RefundAddAsync(_user);
        Assert.Equal(0, await _quota.AddsUsedTodayAsync(_user));
    }

    [SkippableFact]
    public async Task Concurrent_adds_never_exceed_the_limit()
    {
        Skip.If(Uri is null, SkipReason);

        // Ten saves at once, starting from no counter at all: the day-claim
        // upsert race and the increment race both happen here.
        var granted = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => _quota.TryConsumeAddAsync(_user, Limit)));

        Assert.Equal(Limit, granted.Count(g => g));
        Assert.Equal(Limit, await _quota.AddsUsedTodayAsync(_user));
    }

    [SkippableFact]
    public async Task Adds_do_not_touch_the_pack_or_score_counters()
    {
        Skip.If(Uri is null, SkipReason);

        for (var i = 0; i < Limit; i++) await _quota.TryConsumeAddAsync(_user, Limit);

        Assert.Equal(0, await _quota.PacksUsedTodayAsync(_user));
        Assert.Equal(0, await _quota.ScoresUsedTodayAsync(_user));
        Assert.True(await _quota.TryConsumePackAsync(_user, 3));
    }
}
