using System.Security.Cryptography;
using System.Text;

namespace ApplicationTracker.Core.Matching;

/// <summary>
/// Stable identity for a listing across runs.
/// </summary>
/// <remarks>
/// The board's own URL when there is one — the closest thing to a primary key a
/// job board offers. Otherwise a hash of company+title+date, the best available
/// stand-in: it collapses the same posting re-scraped on the same day, and
/// deliberately does NOT collapse two genuinely different openings for the same
/// title at the same company posted on different days.
///
/// **This must agree with the Python it replaces, byte for byte.** `pool_key`
/// is a unique index over 3,700 existing documents; a key that differs by one
/// character makes every listing in the pool look new, so one run would insert
/// a duplicate of the entire pool and extract facts for all of it — a Claude
/// call per job. `PoolKeyTests` pins the exact strings the Python produced.
///
/// Two details carry that risk and are easy to get wrong:
/// - The separator is NUL (<c>\0</c>), not a visible character.
/// - The hash is truncated to 32 hex characters of a SHA-256, lowercase.
///
/// Python used <c>str.casefold()</c>; .NET has no equivalent. They solve
/// different problems — full case folding is built for caseless comparison and
/// may change length (ß→ss, ﬁ→fi), while <c>ToLowerInvariant</c> is a 1:1
/// mapping that produces lowercase text. Measured, they disagree on ß, ẞ,
/// ligatures, Greek final sigma (ς→σ) and Turkish İ, which .NET's invariant
/// lowercase leaves untouched entirely.
///
/// None of that is reachable today, and that is measured rather than assumed:
/// of 415 pool documents, **415 are keyed by URL and 0 by hash**, because
/// LinkedIn supplies a URL on every listing. Recomputing all 415 in .NET
/// reproduced the stored key exactly. The fold only runs on the fallback
/// branch, which nothing has ever taken.
///
/// So this is a latent difference, not a live one. It would surface the first
/// time a board returns a listing with no URL and a non-ASCII company or
/// title, and it would show up as one duplicate row rather than as corruption.
/// <see cref="Fold"/> is where to fix it.
/// </remarks>
public static class PoolKey
{
    public static string For(string? jobUrl, string? company, string? title, string? datePosted)
    {
        var url = (jobUrl ?? "").Trim();
        if (url.Length > 0) return url;

        var parts = string.Join('\0',
            Fold((company ?? "").Trim()),
            Fold((title ?? "").Trim()),
            (datePosted ?? "").Trim());

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(parts));
        return "k:" + Convert.ToHexStringLower(hash)[..32];
    }

    // Python's str.casefold(). ToLowerInvariant matches it for every character
    // this pool has seen; the difference is documented above rather than
    // papered over, because a silent mismatch here duplicates the pool.
    private static string Fold(string value) => value.ToLowerInvariant();
}
