using ApplicationTracker.Core.Greenhouse;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// The Greenhouse board tokens this source ingests, loaded from a config file
/// rather than code.
/// </summary>
/// <remarks>
/// <para>
/// Modelled on <c>PoolIngest.RolesConfig</c>, including the part that matters
/// most: <see cref="Load"/> <b>throws</b> on a missing file or an empty list
/// rather than falling back to a built-in default. A daily run against a
/// silently-defaulted company list would ingest the wrong boards for as long as
/// nobody noticed, and the failure mode is invisible — jobs appear, they are
/// simply the wrong company's.
/// </para>
/// <para>
/// <b>No board token appears anywhere in code or in a test.</b> Tests that need
/// one build a config in memory (<see cref="ForTesting"/>). That is the whole
/// point of this type: going from one company to fifty is an edit to
/// <c>config/companies.json</c> and nothing else.
/// </para>
/// </remarks>
public sealed record CompaniesConfig
{
    [JsonPropertyName("companies")] public List<string> Companies { get; init; } = [];

    /// <summary>Each company's own web domain, by board token.</summary>
    /// <remarks>
    /// <para>
    /// The logo source. The boards API returns no logo, and a board token is a
    /// Greenhouse slug rather than a domain -- the two differ often enough that
    /// deriving one from the other would put the wrong company's mark on a card.
    /// So the domain is written down, next to the token it belongs to.
    /// </para>
    /// <para>
    /// Optional per company: a token with no domain gets no logo, and the card
    /// falls back to its initial. A domain for a token that is NOT in
    /// <see cref="Companies"/> is fatal, because it is a typo in one of the two.
    /// </para>
    /// </remarks>
    [JsonPropertyName("company_domains")]
    public Dictionary<string, string> CompanyDomains { get; init; } = [];

    /// <summary>The logo URL for a domain, with <c>{domain}</c> as the placeholder.</summary>
    /// <remarks>
    /// Resolved at ingest and stored on every row, so the API never needs to
    /// read this file. Changing the service is an edit here and a run; the next
    /// run restamps every row of every board.
    /// </remarks>
    [JsonPropertyName("logo_url_template")]
    public string LogoUrlTemplate { get; init; } = DefaultLogoUrlTemplate;

    /// <summary>Google's favicon service: no key, no account, fine at card size.</summary>
    public const string DefaultLogoUrlTemplate = "https://www.google.com/s2/favicons?domain={domain}&sz=128";

    /// <summary>The logo URL for this board, or null when it has no domain.</summary>
    public string? LogoUrlFor(string boardToken) =>
        CompanyDomains.TryGetValue(boardToken, out var domain)
            ? LogoUrlTemplate.Replace("{domain}", domain, StringComparison.Ordinal)
            : null;

    /// <summary>What an embedding batch is filled to, in estimated tokens.</summary>
    /// <remarks>
    /// A budget, not the limit. voyage-4's real ceiling is 320K tokens per
    /// request — over three times this — so in production the split-and-retry
    /// path should never fire. It exists and is tested anyway, because the
    /// 120K-limit families (voyage-4-large, voyage-3-large, voyage-code-3) are
    /// one config edit away and this number is the only thing that would stand
    /// between such a run and a hard 400.
    /// </remarks>
    /// <summary>
    /// The baseline of locations the product serves, for the pre-read filter.
    /// Every user's own location terms (<c>pool_locations</c>) are served on
    /// top, so a user in a new city needs no edit here.
    /// </summary>
    /// <remarks>
    /// Whole words, case-insensitive, matched against the board's free text
    /// ("Tel Aviv", "London, UK", "Remote - EMEA"), so cities belong here as
    /// well as countries -- a board that says only "Herzliya" is otherwise
    /// ruled out. Empty means no location filtering. Only read while
    /// <c>Greenhouse:Prefilter</c> is <c>log</c> or <c>on</c>.
    /// </remarks>
    [JsonPropertyName("served_locations")]
    public List<string> ServedLocations { get; init; } = [];

    [JsonPropertyName("embed_batch_token_budget")] public int EmbedBatchTokenBudget { get; init; } = 100_000;

    /// <summary>Hard cap on texts per embedding request, whatever they weigh.</summary>
    /// <remarks>The API's own cap is 1,000; 128 is deliberately stricter, so a
    /// board of very short postings cannot build a request that is legal but
    /// enormous to retry.</remarks>
    [JsonPropertyName("max_batch_items")] public int MaxBatchItems { get; init; } = 128;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public static CompaniesConfig Load(string path)
    {
        if (!File.Exists(path))
            throw new FileNotFoundException(
                $"Companies config not found at {path}. Set Companies__ConfigPath or restore the file. "
                + "This is deliberately fatal: there is no default board list, because a run against "
                + "a guessed one would ingest the wrong companies silently.");

        return Parse(File.ReadAllText(path), $"Companies config at {path}");
    }

    /// <summary>
    /// Build a config from the file's JSON, with the file's validation. Tests
    /// that need more than tokens use this rather than <c>with</c>, which would
    /// skip the validation.
    /// </summary>
    public static CompaniesConfig Parse(string json, string what = "Companies config")
    {
        var config = JsonSerializer.Deserialize<CompaniesConfig>(json, Json)
            ?? throw new InvalidOperationException($"{what} did not parse.");

        return config.Validated(what);
    }

    /// <summary>
    /// Build a config in memory. The only way a test gets a board token.
    /// </summary>
    public static CompaniesConfig ForTesting(params string[] companies) =>
        new CompaniesConfig { Companies = [.. companies] }.Validated("In-memory companies config");

    private CompaniesConfig Validated(string what)
    {
        var tokens = Companies
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c.Trim())
            .ToList();

        if (tokens.Count == 0)
            throw new InvalidOperationException($"{what} lists no companies.");

        // A board token is a URL path segment. Anything else is a typo that
        // would otherwise become a 404 attributed to the company rather than to
        // the file — or, worse, a path traversal into another API route.
        foreach (var token in tokens)
            if (!token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
                throw new InvalidOperationException(
                    $"{what} contains {token}, which is not a valid Greenhouse board token "
                    + "(letters, digits, '-' and '_' only). The token is the slug in "
                    + "boards.greenhouse.io/<token>, not a company's display name or URL.");

        // De-dupe case-insensitively, keeping the file's own order: the run log
        // then reads in the order a human wrote the list.
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var unique = tokens.Where(t => seen.Add(t)).ToList();

        if (EmbedBatchTokenBudget <= 0 || MaxBatchItems <= 0)
            throw new InvalidOperationException($"{what} has a non-positive batch budget or item cap.");

        if (!LogoUrlTemplate.StartsWith("https://", StringComparison.Ordinal)
            || !LogoUrlTemplate.Contains("{domain}", StringComparison.Ordinal))
            throw new InvalidOperationException(
                $"{what} has logo_url_template {LogoUrlTemplate}, which must be an https URL "
                + "containing {domain}. Without the placeholder every company would get the same logo.");

        var listed = new HashSet<string>(unique, StringComparer.OrdinalIgnoreCase);
        var domains = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (token, raw) in CompanyDomains)
        {
            if (!listed.Contains(token.Trim()))
                throw new InvalidOperationException(
                    $"{what} has a domain for {token}, which is not in companies. "
                    + "One of the two is a typo, and guessing which would put a logo on the wrong board.");

            // A bare hostname: no scheme, no path. It is substituted into a URL,
            // so anything else is either a broken logo or a different URL.
            var domain = raw?.Trim().ToLowerInvariant() ?? "";
            if (domain.Length == 0 || !domain.Contains('.')
                || !domain.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '.'))
                throw new InvalidOperationException(
                    $"{what} has domain {raw} for {token}. Expected a bare hostname like example.com, "
                    + "with no scheme or path.");

            domains[token.Trim()] = domain;
        }

        // One domain, one board. Two tokens with the same domain are the same
        // company listed twice -- mid-move between tokens, or added again
        // under a second one -- and every one of its postings would be stored,
        // read, embedded, shown and scored twice. The domain is exact; names
        // are not. (docs/plans/multi-source-ingest.md -> Duplicates.)
        var twice = domains
            .GroupBy(kv => kv.Value, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(g => g.Count() > 1);
        if (twice is not null)
            throw new InvalidOperationException(
                $"{what} lists {twice.Key} on two boards ({string.Join(", ", twice.Select(kv => kv.Key))}). "
                + "A company must come from one board, or every posting is duplicated.");

        var served = ServedLocations
            .Where(l => !string.IsNullOrWhiteSpace(l))
            .Select(l => l.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return this with { Companies = unique, CompanyDomains = domains, ServedLocations = served };
    }
}
