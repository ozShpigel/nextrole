using System.Text.RegularExpressions;

namespace ApplicationTracker.Core.Matching;

/// <summary>
/// Reduces a job-search role to the form two spellings of the same role share.
/// </summary>
/// <remarks>
/// Publishing the baseline makes reuse *possible* — the classifier can see
/// "Backend Engineer" and pick it. It does not make a variant *impossible*: the
/// model can still answer "Backend Developer", and a capped role list quietly
/// fills with synonyms of jobs it is already searching.
///
/// This is the check behind that rule. It runs on the write path, and a role
/// whose canonical form matches an existing one reuses that row rather than
/// creating a second.
///
/// Deliberately conservative. It merges spellings of the same job, not jobs
/// that merely sound similar: "Data Engineer" and "Data Scientist" stay apart,
/// and anything it does not recognise passes through with only case and spacing
/// normalised. Over-merging is worse than a duplicate — a duplicate costs one
/// cap slot, a wrong merge silently stops searching a role someone needs.
///
/// This is the ONLY implementation. The scraper mirrors baseline roles under
/// its own simpler key, and the write path matches on the canonical form of
/// each stored role name rather than on that key, so the two never have to
/// agree on an algorithm — see PoolRoleRepository.ClaimAsync.
/// </remarks>
public static class RoleCanonicalizer
{
    // "Developer", "Programmer" and "Engineer" name the same search. Applied per
    // token, so "DevOps" (one token) is untouched.
    private static readonly Dictionary<string, string> SynonymTokens = new(StringComparer.Ordinal)
    {
        ["developer"] = "engineer",
        ["developers"] = "engineer",
        ["engineers"] = "engineer",
        ["programmer"] = "engineer",
        ["programmers"] = "engineer",
        ["dev"] = "engineer",
    };

    // Seniority is not part of a search term — the search covers all levels.
    // The classifier is told not to emit these; this is the enforcement.
    private static readonly HashSet<string> SeniorityTokens = new(StringComparer.Ordinal)
    {
        "junior", "jr", "senior", "sr", "staff", "principal", "lead", "entry", "mid", "level",
    };

    // Spellings that differ only by a word boundary.
    private static readonly (string From, string To)[] Compounds =
    {
        ("back end", "backend"),
        ("front end", "frontend"),
        ("full stack", "fullstack"),
    };

    private static readonly Regex NonAlphanumeric = new(@"[^a-z0-9]+", RegexOptions.Compiled);

    public static string Canonicalize(string? role)
    {
        if (string.IsNullOrWhiteSpace(role)) return "";

        var text = NonAlphanumeric.Replace(role.ToLowerInvariant(), " ").Trim();
        foreach (var (from, to) in Compounds)
            text = text.Replace(from, to);

        var tokens = text.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(t => !SeniorityTokens.Contains(t))
            .Select(t => SynonymTokens.TryGetValue(t, out var canonical) ? canonical : t)
            .ToList();

        // Everything was seniority ("Senior Lead") — nothing identifying is
        // left, so fall back to the normalised original rather than "".
        if (tokens.Count == 0)
            return string.Join(' ', text.Split(' ', StringSplitOptions.RemoveEmptyEntries));

        // "Engineer Engineer" from "Developer Engineer" and the like.
        var deduped = new List<string>();
        foreach (var t in tokens)
            if (deduped.Count == 0 || deduped[^1] != t) deduped.Add(t);

        return string.Join(' ', deduped);
    }
}
