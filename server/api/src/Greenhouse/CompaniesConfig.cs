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

    /// <summary>What an embedding batch is filled to, in estimated tokens.</summary>
    /// <remarks>
    /// A budget, not the limit. voyage-4's real ceiling is 320K tokens per
    /// request — over three times this — so in production the split-and-retry
    /// path should never fire. It exists and is tested anyway, because the
    /// 120K-limit families (voyage-4-large, voyage-3-large, voyage-code-3) are
    /// one config edit away and this number is the only thing that would stand
    /// between such a run and a hard 400.
    /// </remarks>
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

        var config = JsonSerializer.Deserialize<CompaniesConfig>(File.ReadAllText(path), Json)
            ?? throw new InvalidOperationException($"Companies config at {path} did not parse.");

        return config.Validated($"Companies config at {path}");
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

        return this with { Companies = unique };
    }
}
