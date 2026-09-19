namespace ApplicationTracker.Core.Greenhouse;

/// <summary>
/// Embeds a batch of texts, returning one vector per input <b>in input order</b>.
/// </summary>
/// <remarks>
/// The ordering guarantee is the contract. Implementations must verify it
/// rather than assume it — see <see cref="VoyageEmbeddingClient"/>.
/// </remarks>
public interface IEmbeddingClient
{
    Task<EmbeddingBatchResult> EmbedAsync(
        IReadOnlyList<string> texts, string inputType, CancellationToken ct);
}

/// <param name="Vectors">One per input, in input order.</param>
/// <param name="TotalTokens">
/// What the API billed, from its own <c>usage.total_tokens</c> — not our
/// estimate. This is the number the cost report is built from, because the
/// 4-chars-per-token estimate used for packing is not what anyone is charged.
/// </param>
public sealed record EmbeddingBatchResult(IReadOnlyList<float[]> Vectors, int TotalTokens);

/// <summary>Raised when embedding failed in a way the caller must not paper over.</summary>
public sealed class EmbeddingException : Exception
{
    public EmbeddingException(string message, Exception? inner = null) : base(message, inner) { }
}
