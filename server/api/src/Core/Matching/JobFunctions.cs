namespace ApplicationTracker.Core.Matching;

/// <summary>
/// The fixed list of job functions -- the kind of work a role is -- and the one
/// rule for matching a posting's function against a candidate's.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why it exists.</b> The Greenhouse source keeps whole boards, so a board's
/// sales, design and M&amp;A roles sit in the same collection as its
/// engineering ones. Nothing narrowed by kind of work: an infra engineer in
/// Israel was shown every Israeli posting in the collection, down to "Senior
/// Brand Designer" at 0, each one a Claude call spent to learn it was
/// irrelevant. The LinkedIn pool never had this, because it only scraped the
/// role titles it searched for.
/// </para>
/// <para>
/// <b>A closed list, not free text.</b> Free text is what the extraction does
/// with location, and "London" arrives as ten strings that no exact filter can
/// match. Both sides -- the posting (job-facts) and the profile (CV
/// normalisation) -- are model-written, and both pass through
/// <see cref="Normalize"/>, which drops anything not on this list. The model
/// proposes; only a listed value is kept.
/// </para>
/// <para>
/// <b>Knowingly unchecked:</b> whether a listed value is the RIGHT one for a
/// posting. There is no exact check for that, and a proxy (title keywords)
/// would be the weak check AGENTS.md warns about. The defence is the permissive
/// rule in <see cref="Matches"/> plus the filter shipping switched off until
/// the labels on stored postings have been read by eye.
/// </para>
/// </remarks>
public static class JobFunctions
{
    public const string SoftwareEngineering = "software_engineering";
    public const string Infrastructure = "infrastructure";
    public const string DataEngineering = "data_engineering";
    public const string DataScience = "data_science";
    public const string Analytics = "analytics";
    public const string Qa = "qa";
    public const string Security = "security";
    public const string Product = "product";
    public const string Design = "design";
    public const string Sales = "sales";
    public const string Marketing = "marketing";
    public const string CustomerSuccess = "customer_success";
    public const string Operations = "operations";

    public static readonly IReadOnlyList<string> All =
    [
        SoftwareEngineering, Infrastructure, DataEngineering, DataScience, Analytics, Qa, Security,
        Product, Design, Sales, Marketing, CustomerSuccess, Operations,
    ];

    /// <summary>At most this many functions per posting: a hybrid role is two, never five.</summary>
    public const int MaxPerJob = 2;

    /// <summary>At most this many per profile, so a broad CV cannot re-open the whole board.</summary>
    public const int MaxPerProfile = 3;

    /// <summary>
    /// What a candidate in each function also accepts.
    /// </summary>
    /// <remarks>
    /// The widening happens here, at match time, rather than being stored on the
    /// profile: correcting a neighbour here corrects every user at once. Leans
    /// towards showing -- a near miss is a card the Evaluator scores low, while
    /// a missing neighbour hides a job the candidate wanted.
    /// </remarks>
    private static readonly Dictionary<string, string[]> Adjacent = new()
    {
        [SoftwareEngineering] = [Infrastructure, DataEngineering, Qa, Security],
        [Infrastructure] = [SoftwareEngineering, DataEngineering, Security],
        [DataEngineering] = [SoftwareEngineering, Infrastructure, DataScience, Analytics],
        [DataScience] = [DataEngineering, Analytics],
        [Analytics] = [DataScience, DataEngineering, Product],
        [Qa] = [SoftwareEngineering],
        [Security] = [Infrastructure, SoftwareEngineering],
        [Product] = [Design, Analytics],
        [Design] = [Product],
        [Sales] = [CustomerSuccess, Marketing],
        [Marketing] = [Sales],
        [CustomerSuccess] = [Sales],
        [Operations] = [],
    };

    /// <summary>
    /// Keep only listed functions, deduplicated, in the order given, capped.
    /// </summary>
    /// <remarks>
    /// Forgiving about spelling ("Software Engineering", "data-engineering"),
    /// never about meaning: a value that does not land on the list is dropped,
    /// not mapped to the nearest one.
    /// </remarks>
    public static string[] Normalize(IEnumerable<string?>? values, int max)
    {
        if (values is null) return [];

        return [.. values
            .Select(Canonical)
            .Where(v => v is not null && All.Contains(v))
            .Select(v => v!)
            .Distinct()
            .Take(max)];
    }

    /// <summary>The candidate's functions widened by their neighbours.</summary>
    public static IReadOnlyList<string> AcceptedFor(IEnumerable<string?>? profileFunctions)
    {
        var own = Normalize(profileFunctions, MaxPerProfile);
        return [.. own.Concat(own.SelectMany(f => Adjacent[f])).Distinct()];
    }

    /// <summary>
    /// Whether a posting's functions are ones the candidate accepts.
    /// </summary>
    /// <remarks>
    /// <b>Permissive on absence, both sides.</b> A profile with no functions
    /// constrains nothing, and a posting with none -- the extraction could not
    /// tell, or it has not run yet -- always passes. Only a posting KNOWN to be
    /// another kind of work is dropped: a failed read must never hide a job,
    /// which is the rule every other filter on this path follows.
    /// </remarks>
    public static bool Matches(IReadOnlyCollection<string> jobFunctions, IReadOnlyList<string> accepted)
    {
        if (accepted.Count == 0) return true;
        if (jobFunctions.Count == 0) return true;
        return jobFunctions.Any(f => accepted.Contains(f, StringComparer.OrdinalIgnoreCase));
    }

    private static string? Canonical(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? null
            : value.Trim().ToLowerInvariant().Replace('-', '_').Replace(' ', '_');
}
