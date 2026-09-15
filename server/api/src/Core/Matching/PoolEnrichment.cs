namespace ApplicationTracker.Core.Matching;

/// <summary>
/// The rules for turning a pool document's loosely-shaped company enrichment
/// into something the Evaluator may be given.
/// </summary>
/// <remarks>
/// Pure functions, separate from the repository that reads the BSON, so the
/// rules have tests that run in CI. The repository does the deserialization;
/// this decides whether the result is worth passing on.
///
/// Both rules exist because "present but empty" and "absent" are not the same
/// thing downstream, and the difference moves scores.
/// </remarks>
public static class PoolEnrichment
{
    /// <summary>
    /// The Glassdoor payload if it carries evidence, otherwise null.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="JobMatchService"/>'s evidence caps lift the Pace &amp; Workload /
    /// Long-term Risk ceiling when <c>glassdoorData is null</c> is false — the
    /// reasoning being that a posting silent on pace may still have real review
    /// evidence reaching the Evaluator by another route. An object with no
    /// rating, no sub-ratings, no recommend-percent and no snippets inverts
    /// that: the cap lifts and nothing takes its place, so a score rises on the
    /// strength of a field merely existing.
    /// </para>
    /// <para>
    /// No such document exists today — measured across the live pool, 22 of 22
    /// carry sub-ratings, recommend-percent and snippets. This guards the
    /// future version of the scraper's Glassdoor client that starts writing an
    /// empty shell on a miss, which is the kind of change nobody would connect
    /// to a scoring drift weeks later.
    /// </para>
    /// </remarks>
    public static GlassdoorData? EvidenceOrNull(GlassdoorData? data)
    {
        if (data is null) return null;
        var hasEvidence = data.Rating is not null
            || HasAnySubRating(data.SubRatings)
            || data.RecommendPercent is not null
            || data.Snippets is { Count: > 0 };
        return hasEvidence ? data : null;
    }

    // An all-null sub-ratings object is not evidence either — the same trap one
    // level down.
    public static bool HasAnySubRating(GlassdoorSubRatings? s) =>
        s is not null && (s.WorkLifeBalance is not null
            || s.CultureAndValues is not null
            || s.CareerOpportunities is not null
            || s.SeniorManagement is not null
            || s.CompensationAndBenefits is not null);

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
