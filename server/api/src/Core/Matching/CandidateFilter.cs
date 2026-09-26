using ApplicationTracker.Core.Profile;

namespace ApplicationTracker.Core.Matching;

// The cheap pre-filter that cuts the shared pool down to the handful of jobs
// worth spending a Claude call on for one user.
//
// Deliberately NOT a judgement of fit — it is a Mongo query, run against the
// facts extracted once per job (docs/job-pool.md). It answers "could this
// plausibly be for them", and the Evaluator answers "is it any good".
//
// Every clause leans permissive: a job whose facts do not state a location, a
// seniority, or any required tech passes. Missing data must never hide a job,
// because the extraction is best-effort and a job with no facts at all (three
// failed attempts) would otherwise become invisible to everyone.
public sealed record CandidateFilter
{
    // Matched against the job's extracted location, case-insensitively, as a
    // substring. Usually the country from the profile's own location.
    public string? LocationTerm { get; init; }
    // Seniority bands acceptable for this candidate. Empty = no constraint.
    public IReadOnlyList<string> SeniorityBands { get; init; } = [];
    // The candidate's own technologies, lowercased. Empty = no constraint.
    public IReadOnlyList<string> Tech { get; init; } = [];
    // Job functions this candidate accepts: their own, widened by neighbours
    // (JobFunctions.AcceptedFor). Empty = no constraint.
    public IReadOnlyList<string> Functions { get; init; } = [];

    /// <summary>
    /// Only postings published within this many days; null = any age.
    /// </summary>
    /// <remarks>
    /// Set by its caller, never by <see cref="FromProfile"/>: the eager scan
    /// uses the default board's 30 days (<see cref="PoolBrowseQuery.DefaultDaysBack"/>),
    /// the band the "Any" limit of four months (<see cref="PoolBrowseQuery.MaxAgeDays"/>)
    /// so a wider chip can bring older postings back -- the board applies the
    /// chosen window to the band in the browser.
    /// </remarks>
    public int? MaxAgeDays { get; init; }

    /// <summary>
    /// The rendered profile, for a candidate source that retrieves by meaning
    /// rather than by field match.
    /// </summary>
    /// <remarks>
    /// The Mongo-backed pool ignores this: its clauses are field comparisons.
    /// The vector-backed source needs it, because a query vector has to
    /// describe the candidate in the same terms the stored job vectors
    /// describe postings -- a seniority band and a tech list embed nowhere near
    /// a 4,000-character posting.
    ///
    /// Carried here rather than passed alongside so that IPoolJobRepository
    /// keeps one shape across both sources.
    /// </remarks>
    public string ProfileText { get; init; } = "";

    /// <summary>
    /// The candidate's own location, verbatim from the profile.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Not a second copy of <see cref="LocationTerm"/>.</b> That term is the
    /// trailing comma segment -- usually the country -- and a posting located
    /// only <c>"London"</c> contains neither <c>"UK"</c> nor
    /// <c>"United Kingdom"</c>, so a country-only filter hides it. Measured:
    /// 14 of 132 real postings carried a bare city, the second most common form
    /// on those boards.
    /// </para>
    /// <para>
    /// The city cannot simply be pulled out of the profile instead. Real
    /// profiles say <c>"Open to relocation to London, UK"</c>, whose leading
    /// segment is prose, not a city -- so extracting one means guessing, which
    /// this deliberately does not do. Carrying the whole string lets the
    /// in-memory matcher ask the question the other way round: does the
    /// candidate's stated location contain the posting's?
    /// </para>
    /// <para>
    /// Like <see cref="ProfileText"/>, the Mongo-backed pool ignores this --
    /// its clauses are field comparisons against a fixed regex, and "does this
    /// document's value appear in that string" is not one. The pool therefore
    /// still misses a bare city; fixing it there needs a term list in the
    /// query, not this field.
    /// </para>
    /// </remarks>
    public string? LocationText { get; init; }

    public static CandidateFilter FromProfile(StructuredProfile profile) => new()
    {
        ProfileText = Profile.ProfileRenderer.Render(profile),
        LocationTerm = LocationTermOf(profile.Location),
        LocationText = profile.Location,
        SeniorityBands = BandsFor(profile.Seniority),
        Tech = TechOf(profile),
        Functions = JobFunctions.AcceptedFor(profile.Functions),
    };

    // The country, not the city: a Tel Aviv candidate should see Herzliya and
    // Haifa jobs. "Tel Aviv, Israel" -> "Israel"; a single token is used as-is.
    private static string? LocationTermOf(string? location)
    {
        if (string.IsNullOrWhiteSpace(location)) return null;
        var parts = location.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length == 0 ? null : parts[^1];
    }

    // The five bands the extraction uses, in order.
    private static readonly string[] Bands =
        ["entry level", "associate", "mid-senior level", "director", "executive"];

    // One band either side of the candidate's own: someone senior still wants
    // to see an associate posting that pays well or a director one they could
    // stretch into, and the band itself is a coarse label on both sides.
    private static IReadOnlyList<string> BandsFor(string? seniority)
    {
        var index = IndexOfBand(seniority);
        if (index < 0) return [];
        var from = Math.Max(0, index - 1);
        var to = Math.Min(Bands.Length - 1, index + 1);
        return Bands[from..(to + 1)];
    }

    private static int IndexOfBand(string? seniority)
    {
        if (string.IsNullOrWhiteSpace(seniority)) return -1;
        var s = seniority.Trim().ToLowerInvariant();

        // An exact band, as the extraction would write it.
        var exact = Array.IndexOf(Bands, s);
        if (exact >= 0) return exact;

        // Otherwise the profile's own free text ("Senior Backend Engineer",
        // "10+ years"), mapped onto a band by the words people actually use.
        if (s.Contains("vp") || s.Contains("chief") || s.Contains("cto") || s.Contains("ceo")) return 4;
        if (s.Contains("director") || s.Contains("head of")) return 3;
        if (s.Contains("senior") || s.Contains("staff") || s.Contains("principal") || s.Contains("lead")) return 2;
        if (s.Contains("junior") || s.Contains("graduate") || s.Contains("entry")) return 0;
        return -1;
    }

    private static IReadOnlyList<string> TechOf(StructuredProfile profile) =>
        profile.Skills
            .SelectMany(g => g.Items)
            .Where(i => !string.IsNullOrWhiteSpace(i))
            .Select(i => i.Trim().ToLowerInvariant())
            .Distinct()
            .ToList();
}
