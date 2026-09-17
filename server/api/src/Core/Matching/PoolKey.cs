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
/// Python used <c>str.casefold()</c>, which is more aggressive than
/// <c>ToLowerInvariant</c> on a handful of scripts (ß → ss, final sigma). No
/// company or title in the pool has hit one, and the URL branch covers
/// essentially every LinkedIn row, so the risk is confined to the fallback.
/// <see cref="Fold"/> is where a future divergence would be fixed.
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
