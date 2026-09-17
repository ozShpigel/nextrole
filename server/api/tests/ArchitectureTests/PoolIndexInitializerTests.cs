using ApplicationTracker.Infrastructure.Repositories;
using MongoDB.Bson;

namespace ArchitectureTests;

/// <summary>
/// The pool's TTL index shape check — the part that decides whether the pool is
/// protected from deletion.
/// </summary>
/// <remarks>
/// `IsPoolExemptTtl` is the guarantee: the TTL index DELETES rows, and pool
/// listings are supposed to be marked inactive and never deleted. An index that
/// merely has the right NAME is not the right index, and treating it as one
/// would return having done nothing while the old unfiltered index carried on
/// expiring pool jobs.
///
/// Reached through the public EnsureAsync in production; exercised here through
/// the shape predicate, because the alternative is a live Mongo and these
/// assertions are about the document, not the driver.
/// </remarks>
public class PoolIndexInitializerTests
{
    // The shape the initializer must accept, as Mongo reports it.
    private static BsonDocument CorrectTtl(int expireSeconds = 60 * 24 * 3600) => new()
    {
        { "name", "ttl_discovered_at_60d_managed" },
        { "key", new BsonDocument("discovered_at", 1) },
        { "expireAfterSeconds", expireSeconds },
        { "partialFilterExpression", new BsonDocument("ttl_managed", true) },
    };

    private static bool IsPoolExempt(BsonDocument spec) =>
        (bool)typeof(PoolIndexInitializer)
            .GetMethod("IsPoolExemptTtl", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!
            .Invoke(null, [spec])!;

    [Fact]
    public void The_correct_index_is_recognised()
    {
        Assert.True(IsPoolExempt(CorrectTtl()));
    }

    [Fact]
    public void An_index_with_no_partial_filter_is_not_the_pool_exempt_one()
    {
        // This is the dangerous one: same name, same key, same expiry -- but
        // every pool job is a deletion candidate because nothing exempts them.
        var unfiltered = CorrectTtl();
        unfiltered.Remove("partialFilterExpression");

        Assert.False(IsPoolExempt(unfiltered));
    }

    [Fact]
    public void A_partial_filter_on_something_else_does_not_count()
    {
        var wrongFilter = CorrectTtl();
        wrongFilter["partialFilterExpression"] = new BsonDocument("is_active", true);

        Assert.False(IsPoolExempt(wrongFilter));
    }

    [Fact]
    public void An_index_on_the_wrong_field_does_not_count()
    {
        var wrongKey = CorrectTtl();
        wrongKey["key"] = new BsonDocument("last_seen_at", 1);

        Assert.False(IsPoolExempt(wrongKey));
    }

    [Fact]
    public void A_non_expiring_index_does_not_count()
    {
        // Right name, right key, right filter -- but it expires nothing, so
        // retention is not actually in force.
        var noExpiry = CorrectTtl();
        noExpiry.Remove("expireAfterSeconds");

        Assert.False(IsPoolExempt(noExpiry));
    }

    [Fact]
    public void A_compound_key_that_merely_includes_discovered_at_does_not_count()
    {
        var compound = CorrectTtl();
        compound["key"] = new BsonDocument { { "discovered_at", 1 }, { "is_active", 1 } };

        Assert.False(IsPoolExempt(compound));
    }
}
