namespace ApplicationTracker.Core.Matching;

/// <summary>
/// Whether a Glassdoor payload says anything about <em>pace</em> specifically.
/// </summary>
/// <remarks>
/// <para>
/// This exists because <see cref="JobMatchService"/>'s evidence cap used to ask
/// the wrong question. The Pace &amp; Workload / Long-term Risk ceiling is
/// applied when the posting states nothing about pace, and lifted when review
/// evidence might cover the gap — but the test was <c>glassdoorData is null</c>,
/// which lets a career-opportunities rating excuse a pace ceiling. That is the
/// hatch firing on evidence that does not bear on what it is excusing.
/// </para>
/// <para>
/// Measured on the live pool before writing this: all 22 documents carrying any
/// review evidence also carry a work-life-balance sub-rating, so narrowing the
/// test changes nothing about today's scores. It is a guard against the shape
/// that has not appeared yet — a payload with culture and career ratings and no
/// work-life-balance one — not a fix for a miscount happening now.
/// </para>
/// <para>
/// <b>Know how thin the evidence actually is.</b> Every snippet stored today is
/// Glassdoor's own templated scrape text — "Employees also rated X 3.8 out of 5
/// for work life balance , 3.8 for culture and values…" — which restates the
/// sub-rating rather than adding to it. So the snippet branch below never
/// decides anything on current data, and what releases a 35-point ceiling is,
/// in practice, <b>a single float</b>. That is a lot of consequence resting on
/// one scraped number, and it is the reason the vocabulary is kept narrow: the
/// branch exists for free-text review prose the scraper may start returning,
/// not for the boilerplate it returns now.
/// </para>
/// </remarks>
public static class PaceEvidence
{
    /// <summary>
    /// True when the payload carries something that actually speaks to pace or
    /// workload, as opposed to merely existing.
    /// </summary>
    public static bool In(GlassdoorData? glassdoor)
    {
        if (glassdoor is null) return false;

        // The direct signal, and the one the live data always has.
        if (glassdoor.SubRatings?.WorkLifeBalance is not null) return true;

        return glassdoor.Snippets?.Any(MentionsPace) ?? false;
    }

    // Deliberately short, and every entry is a phrase that can only be about
    // hours or load. Terms that merely co-occur with pace complaints
    // ("management", "culture", "stress" on its own) are left out: this
    // predicate RELEASES a ceiling, so a false positive raises a score on
    // evidence that does not support it, and the honest gap is the safer error.
    //
    // Unexercised on current data — every live snippet set is Glassdoor's own
    // templated "Employees also rated X out of 5 for work life balance…" text,
    // which the sub-rating branch above already catches. It is here for
    // free-text review prose, which the scraper may start returning.
    private static readonly string[] PaceTerms =
    [
        "work life balance",
        "work-life balance",
        "work/life balance",
        "working hours",
        "long hours",
        "overtime",
        "on-call",
        "on call",
        "burnout",
        "burn out",
        "workload",
        "crunch",
    ];

    private static bool MentionsPace(string? snippet) =>
        snippet is { Length: > 0 }
        && PaceTerms.Any(t => snippet.Contains(t, StringComparison.OrdinalIgnoreCase));
}
