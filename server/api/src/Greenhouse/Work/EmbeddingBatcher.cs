using ApplicationTracker.Core.Greenhouse;
namespace ApplicationTracker.Greenhouse;

/// <summary>
/// Packs texts into embedding requests. Pure, so the rules are testable without
/// a network.
/// </summary>
public static class EmbeddingBatcher
{
    /// <summary>
    /// Rough token count for budget packing.
    /// </summary>
    /// <remarks>
    /// Four characters per token, the usual English approximation. It is
    /// deliberately an ESTIMATE and deliberately not exact: the budget it feeds
    /// is well under the API's real ceiling, so being wrong by a third costs a
    /// slightly smaller batch, not a rejected request. Making this exact would
    /// mean shipping a tokenizer to save nothing.
    ///
    /// Rounded UP, so a short text never counts as zero tokens and a pathological
    /// list of empty strings cannot build an unbounded batch.
    /// </remarks>
    public static int EstimateTokens(string text) => Math.Max(1, (text.Length + 3) / 4);

    /// <summary>
    /// Split into batches, filling each to <paramref name="tokenBudget"/> and
    /// capping at <paramref name="maxItems"/>.
    /// </summary>
    /// <remarks>
    /// <b>Order is preserved and never interleaved.</b> The API returns
    /// embeddings positionally, so the caller re-associates vectors to jobs by
    /// index within a batch — index is the only thing tying a vector to the text
    /// that produced it. Any reordering here would silently attach every job the
    /// wrong vector, and nothing downstream could detect it: the run succeeds,
    /// the counts match, and retrieval is quietly garbage.
    ///
    /// A single text over the budget still gets its own batch rather than being
    /// dropped or truncated. If it is genuinely over the API's limit, the 400
    /// comes back and <see cref="VoyageEmbeddingClient"/> splits — and a batch
    /// of one cannot be split further, so it fails loudly for that company
    /// instead of silently for that job.
    /// </remarks>
    public static List<List<T>> Batch<T>(
        IReadOnlyList<T> items, Func<T, string> text, int tokenBudget, int maxItems)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(tokenBudget);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxItems);

        var batches = new List<List<T>>();
        var current = new List<T>();
        var currentTokens = 0;

        foreach (var item in items)
        {
            var tokens = EstimateTokens(text(item));

            // Close the current batch BEFORE adding, so the budget is a ceiling
            // rather than something the last item is allowed to exceed.
            if (current.Count > 0 && (current.Count >= maxItems || currentTokens + tokens > tokenBudget))
            {
                batches.Add(current);
                current = [];
                currentTokens = 0;
            }

            current.Add(item);
            currentTokens += tokens;
        }

        if (current.Count > 0) batches.Add(current);
        return batches;
    }
}
