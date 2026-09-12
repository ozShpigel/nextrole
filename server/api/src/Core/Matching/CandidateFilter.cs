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

    public static CandidateFilter FromProfile(StructuredProfile profile) => new()
    {
        LocationTerm = LocationTermOf(profile.Location),
        SeniorityBands = BandsFor(profile.Seniority),
        Tech = TechOf(profile),
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
