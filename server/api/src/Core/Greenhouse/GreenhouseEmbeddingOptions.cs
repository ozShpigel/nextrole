namespace ApplicationTracker.Core.Greenhouse;

/// <summary>
/// The embedding model and its output dimensions. One source, bound by both the
/// API and the ingestion project.
/// </summary>
/// <remarks>
/// <para>
/// <b>These two values are why the embedding client is shared at all.</b>
/// Ingestion and retrieval differ in exactly one thing -- <c>input_type</c>,
/// <c>document</c> on write and <c>query</c> on read -- and must agree on
/// everything else.
/// </para>
/// <para>
/// The failure when they disagree is silent. A stored 1024-vector queried with
/// a 512-vector does not throw and does not log: <c>$vectorSearch</c> returns
/// an empty result, indistinguishable from a profile that genuinely matches
/// nothing. Two models is the same story one level up -- the vectors are the
/// right shape and the wrong space, so retrieval returns real job ids that are
/// simply not the relevant ones. Nothing goes red either way.
/// </para>
/// <para>
/// Read-only server configuration, like <c>scoring_config</c>: Options pattern,
/// env overrides, change = redeploy. Deliberately NOT in
/// <c>config/companies.json</c>, which ships inside the ingestion image and
/// which the API cannot read -- putting it there is what would let the two
/// halves hold different values.
/// </para>
/// </remarks>
public sealed class GreenhouseEmbeddingOptions
{
    public const string SectionName = "Greenhouse:Embedding";

    /// <summary>
    /// Voyage model id.
    /// </summary>
    /// <remarks>
    /// voyage-4: $0.06 per million tokens, 320K-token batch ceiling. Note that
    /// the 120K ceiling quoted in most places belongs to the -large families
    /// (voyage-4-large, voyage-3-large, voyage-code-3); switching to one of
    /// those makes <c>embed_batch_token_budget</c> load-bearing rather than
    /// conservative.
    /// </remarks>
    public string Model { get; init; } = "voyage-4";

    /// <summary>
    /// Output dimensions. Must equal what the Atlas vector index declares.
    /// </summary>
    /// <remarks>
    /// Changing this is not a config edit. It means a new
    /// <c>embedding_vN</c> field, a new index, and re-embedding every stored
    /// job -- because a collection holding two dimension counts returns
    /// whichever subset happens to match, with no error anywhere.
    /// </remarks>
    public int Dimensions { get; init; } = 1024;

    public string BaseUrl { get; init; } = "https://api.voyageai.com/";

    /// <summary>Voyage API key. No default: an unset key must fail, not fall back.</summary>
    public string? ApiKey { get; init; }

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Model))
            throw new InvalidOperationException($"{SectionName}:Model is not configured.");

        if (Dimensions <= 0)
            throw new InvalidOperationException($"{SectionName}:Dimensions must be positive.");

        if (string.IsNullOrWhiteSpace(ApiKey))
            throw new InvalidOperationException(
                $"{SectionName}:ApiKey is not configured. Set Greenhouse__Embedding__ApiKey. "
                + "There is deliberately no default: embedding is a billed call, and a silent "
                + "fallback would either fail every request or bill the wrong account.");
    }
}
