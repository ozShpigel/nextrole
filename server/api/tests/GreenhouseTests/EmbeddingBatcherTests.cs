using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// Batch splitting: the token budget, the item cap, and the ordering guarantee
/// the whole vector-to-job association rests on.
/// </summary>
public class EmbeddingBatcherTests
{
    private static string Text(int tokens) => new('x', tokens * 4);

    [Fact]
    public void Fills_to_the_token_budget_and_no_further()
    {
        // Four texts of 30 tokens each against a 100-token budget: 3 fit
        // (90), the fourth would make 120.
        var items = Enumerable.Range(0, 4).Select(_ => Text(30)).ToList();

        var batches = EmbeddingBatcher.Batch(items, t => t, tokenBudget: 100, maxItems: 1000);

        Assert.Equal(2, batches.Count);
        Assert.Equal(3, batches[0].Count);
        Assert.Single(batches[1]);
    }

    [Fact]
    public void Budget_is_a_ceiling_not_a_target_the_last_item_may_exceed()
    {
        // The batch is closed BEFORE adding, so no batch ever ends up over
        // budget. If the check happened after the add, this would be one batch
        // of 2 at 120 tokens.
        var items = new[] { Text(60), Text(60) };

        var batches = EmbeddingBatcher.Batch(items, t => t, tokenBudget: 100, maxItems: 1000);

        Assert.Equal(2, batches.Count);
        Assert.All(batches, b => Assert.Equal(60, EmbeddingBatcher.EstimateTokens(b[0])));
    }

    [Fact]
    public void Caps_item_count_even_when_everything_is_tiny()
    {
        // 300 one-character texts are ~300 tokens total: the budget would never
        // split them. The item cap is a separate limit for exactly this shape.
        var items = Enumerable.Range(0, 300).Select(_ => "x").ToList();

        var batches = EmbeddingBatcher.Batch(items, t => t, tokenBudget: 100_000, maxItems: 128);

        Assert.Equal(3, batches.Count);
        Assert.Equal(128, batches[0].Count);
        Assert.Equal(128, batches[1].Count);
        Assert.Equal(44, batches[2].Count);
    }

    [Fact]
    public void An_oversized_single_item_gets_its_own_batch_rather_than_being_dropped()
    {
        // One text far over budget. It must still be emitted -- alone, so that
        // if the API rejects it the 400 is attributable to that one job.
        // Dropping or truncating it would lose a posting from a "successful"
        // run.
        var items = new[] { Text(10), Text(500), Text(10) };

        var batches = EmbeddingBatcher.Batch(items, t => t, tokenBudget: 100, maxItems: 1000);

        Assert.Equal(3, batches.Count);
        Assert.Single(batches[1]);
        Assert.Equal(500, EmbeddingBatcher.EstimateTokens(batches[1][0]));
        Assert.Equal(3, batches.Sum(b => b.Count));
    }

    [Fact]
    public void Preserves_order_and_loses_nothing()
    {
        // The association between a job and its vector is positional, so any
        // reordering here attaches every vector to the wrong job -- with no
        // symptom: the run succeeds and the counts match.
        var items = Enumerable.Range(0, 500).ToList();

        var batches = EmbeddingBatcher.Batch(items, i => Text(7), tokenBudget: 100, maxItems: 9);

        Assert.Equal(items, batches.SelectMany(b => b).ToList());
    }

    [Fact]
    public void Empty_input_produces_no_batches()
    {
        Assert.Empty(EmbeddingBatcher.Batch<string>([], t => t, 100, 10));
    }

    [Fact]
    public void An_empty_string_still_counts_as_a_token()
    {
        // Rounded up, so a pathological list of empty strings is bounded by the
        // item cap rather than building an unbounded batch at zero cost.
        Assert.Equal(1, EmbeddingBatcher.EstimateTokens(""));
        Assert.Equal(1, EmbeddingBatcher.EstimateTokens("a"));
        Assert.Equal(1, EmbeddingBatcher.EstimateTokens("abcd"));
        Assert.Equal(2, EmbeddingBatcher.EstimateTokens("abcde"));
    }

    [Theory]
    [InlineData(0, 10)]
    [InlineData(10, 0)]
    [InlineData(-1, 10)]
    public void Rejects_a_nonsensical_budget_or_cap(int budget, int maxItems)
    {
        // A zero budget would loop forever producing empty batches.
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            EmbeddingBatcher.Batch(["a"], t => t, budget, maxItems));
    }
}
