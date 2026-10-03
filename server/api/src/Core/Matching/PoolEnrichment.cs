namespace ApplicationTracker.Core.Matching;

/// <summary>
/// The rule for turning a pool document's loosely-shaped company profile into
/// something the Evaluator may be given.
/// </summary>
/// <remarks>
/// Pure functions, separate from the repository that reads the BSON, so the
/// rules have tests that run in CI. The repository does the deserialization;
/// this decides whether the result is worth passing on.
/// </remarks>
public static class PoolEnrichment
{
    /// <summary>
    /// The pool's loose <c>company_profile</c> document narrowed to the five
    /// fields the Evaluator prompt documents, or null when it carries none of
    /// them.
    /// </summary>
    /// <remarks>
    /// The scraper owns that collection's schema, so this arrives as an
    /// untyped dictionary. Returning an all-null record instead of null would
    /// make PromptBuilder emit an empty <c>&lt;company_profile&gt;</c> block —
    /// harmless to scores (the prompt says profile data never changes one) but
    /// it spends input tokens on every job to say nothing.
    /// </remarks>
    public static CompanyProfile? CompanyProfileFrom(IReadOnlyDictionary<string, object?>? raw)
    {
        if (raw is null || raw.Count == 0) return null;

        string? Get(string key) =>
            raw.TryGetValue(key, out var v) && v?.ToString() is { Length: > 0 } s ? s : null;

        var profile = new CompanyProfile
        {
            Industry = Get("industry"),
            Description = Get("description"),
            NumEmployees = Get("numEmployees"),
            Revenue = Get("revenue"),
            Url = Get("url"),
        };

        return profile is { Industry: null, Description: null, NumEmployees: null,
                            Revenue: null, Url: null }
            ? null
            : profile;
    }
}
