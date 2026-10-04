using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Configuration;

namespace ApplicationTracker.Greenhouse;

/// <summary>One job board: which source it is on, and its token there.</summary>
/// <remarks>
/// <see cref="Key"/> -- <c>source:token</c> -- is what the stored jobs, the queue,
/// the run ledger and the removed-boards check all identify a board by
/// (docs/plans/board-config.md). The token alone is not unique across sources.
/// </remarks>
public sealed record BoardConfig
{
    [JsonPropertyName("source")] public string Source { get; init; } = "";

    /// <summary>
    /// The board's id on its source: the slug in boards.greenhouse.io/&lt;token&gt;,
    /// jobs.lever.co/&lt;token&gt; or comeet.com/jobs/&lt;token&gt;/.
    /// </summary>
    [JsonPropertyName("token")] public string Token { get; init; } = "";

    /// <summary>The company's own web domain, for its logo and the one-domain-one-board rule. Optional.</summary>
    [JsonPropertyName("domain")] public string? Domain { get; init; }

    /// <summary>
    /// The display name, for sources whose postings do not carry a usable one
    /// (Workday's is a legal entity). Optional; Greenhouse boards leave it out.
    /// </summary>
    [JsonPropertyName("name")] public string? Name { get; init; }

    /// <summary>Workday: the site's host, <c>&lt;name&gt;.wd&lt;n&gt;</c> of <c>&lt;name&gt;.wd&lt;n&gt;.myworkdayjobs.com</c>.</summary>
    [JsonPropertyName("host")] public string? Host { get; init; }

    /// <summary>Workday: the tenant in the API path.</summary>
    [JsonPropertyName("tenant")] public string? Tenant { get; init; }

    /// <summary>Workday: the careers site in the API path.</summary>
    [JsonPropertyName("site")] public string? Site { get; init; }

    /// <summary>
    /// Workday: facets applied to the listing, narrowing it server-side --
    /// e.g. <c>{ "locationHierarchy1": ["&lt;Israel id&gt;"] }</c>. What makes a
    /// whole-company site listable at all: its total is capped at 2000.
    /// </summary>
    [JsonPropertyName("facets")] public Dictionary<string, List<string>>? Facets { get; init; }

    /// <summary>Comeet: the company's uid in the API path, e.g. <c>43.001</c>.</summary>
    [JsonPropertyName("company_uid")] public string? CompanyUid { get; init; }

    /// <summary>
    /// Comeet: the careers token. Public -- the company's own careers page
    /// embeds it to call the same API -- so it is config, not a secret.
    /// </summary>
    [JsonPropertyName("api_token")] public string? ApiToken { get; init; }

    /// <summary>
    /// Lever: <c>eu</c> for a board on Lever's EU instance (<c>jobs.eu.lever.co</c>),
    /// left out for the global one. The same API on another host; the company's
    /// data lives on only one of them, and the other answers 404.
    /// </summary>
    [JsonPropertyName("region")] public string? Region { get; init; }

    [JsonIgnore] public string Key => GreenhouseJob.KeyFor(Source, Token);
}

/// <summary>
/// The boards this ingest reads, loaded from a config file rather than code.
/// </summary>
/// <remarks>
/// <para>
/// The part that matters most: <see cref="Load"/> <b>throws</b> on a missing file, an empty list or
/// any malformed entry rather than falling back to a default. A daily run
/// against a silently-defaulted list would ingest the wrong boards for as long
/// as nobody noticed, and the failure mode is invisible -- jobs appear, they
/// are simply the wrong company's.
/// </para>
/// <para>
/// <b>No board token appears anywhere in code or in a test.</b> Tests that need
/// one build a config in memory (<see cref="ForTesting"/>). Going from one board
/// to fifty is an edit to <c>config/boards.json</c> and nothing else.
/// </para>
/// <para>
/// <b>Two shapes load.</b> <c>boards</c>, a list of <see cref="BoardConfig"/>; and
/// the shape before sources existed, <c>companies</c> (Greenhouse tokens) plus
/// <c>company_domains</c>, read as Greenhouse boards so a path still pointing at
/// an old file keeps working. A file with both is fatal: two lists that can
/// disagree about what runs.
/// </para>
/// </remarks>
public sealed record BoardsConfig
{
    [JsonPropertyName("boards")] public List<BoardConfig>? Boards { get; init; }

    /// <summary>The old shape: Greenhouse tokens. Read into <see cref="Boards"/> at load.</summary>
    [JsonPropertyName("companies")] public List<string>? Companies { get; init; }

    /// <summary>The old shape's domains, by token. Read into <see cref="Boards"/> at load.</summary>
    [JsonPropertyName("company_domains")] public Dictionary<string, string>? CompanyDomains { get; init; }

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

    /// <summary>What an embedding batch is filled to, in estimated tokens.</summary>
    /// <remarks>
    /// A budget, not the limit. voyage-4's real ceiling is 320K tokens per
    /// request -- over three times this -- so in production the split-and-retry
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

    /// <summary>Every configured board, in the file's order. Never empty after load.</summary>
    [JsonIgnore] public IReadOnlyList<BoardConfig> All => Boards ?? [];

    /// <summary>The board with this key, or null when it is not configured (any more).</summary>
    public BoardConfig? BoardFor(string key) =>
        All.FirstOrDefault(b => string.Equals(b.Key, key, StringComparison.OrdinalIgnoreCase));

    /// <summary>The logo URL for this board, or null when it has no domain.</summary>
    public string? LogoUrlFor(BoardConfig board) =>
        board.Domain is { } domain
            ? LogoUrlTemplate.Replace("{domain}", domain, StringComparison.Ordinal)
            : null;

    /// <summary>The sources this build can read. A board on any other is a config error.</summary>
    public static readonly IReadOnlySet<string> KnownSources =
        new HashSet<string>(StringComparer.Ordinal)
        {
            GreenhouseSource.SourceName, WorkdaySource.SourceName, LeverSource.SourceName, ComeetSource.SourceName,
        };

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>The file this process loads: <c>Boards:ConfigPath</c>, else the default.</summary>
    /// <remarks>
    /// <c>Companies:ConfigPath</c>, the setting's name before sources, is still
    /// honoured so an environment that set it keeps working -- which is exactly
    /// how the phase 3 deploy broke: the ingest's own appsettings.json still set
    /// it to companies.json, and it outranked the new default. One method, so
    /// <c>BoardsConfigTests</c> checks the path the process really resolves.
    /// </remarks>
    public static string PathFrom(IConfiguration configuration) =>
        configuration["Boards:ConfigPath"]
        ?? configuration["Companies:ConfigPath"]
        ?? DefaultPath;

    public const string DefaultPath = "config/boards.json";

    public static BoardsConfig Load(string path)
    {
        if (!File.Exists(path))
            throw new FileNotFoundException(
                $"Boards config not found at {path}. Set Boards__ConfigPath or restore the file. "
                + "This is deliberately fatal: there is no default board list, because a run against "
                + "a guessed one would ingest the wrong companies silently.");

        return Parse(File.ReadAllText(path), $"Boards config at {path}");
    }

    /// <summary>
    /// Build a config from the file's JSON, with the file's validation. Tests
    /// that need more than tokens use this rather than <c>with</c>, which would
    /// skip the validation.
    /// </summary>
    public static BoardsConfig Parse(string json, string what = "Boards config")
    {
        var config = JsonSerializer.Deserialize<BoardsConfig>(json, Json)
            ?? throw new InvalidOperationException($"{what} did not parse.");

        return config.Validated(what);
    }

    /// <summary>
    /// Build a config in memory: Greenhouse boards with these tokens. The only
    /// way a test gets a board token.
    /// </summary>
    public static BoardsConfig ForTesting(params string[] tokens) =>
        new BoardsConfig
        {
            Boards = [.. tokens.Select(t => new BoardConfig { Source = GreenhouseSource.SourceName, Token = t })],
        }.Validated("In-memory boards config");

    private BoardsConfig Validated(string what)
    {
        if (Boards is not null && (Companies is not null || CompanyDomains is not null))
            throw new InvalidOperationException(
                $"{what} has both boards and companies. They are two lists that can disagree about "
                + "what runs; move every company into boards and delete the old list.");

        var boards = Boards is not null ? FromBoards(what) : FromCompanies(what);

        if (boards.Count == 0)
            throw new InvalidOperationException($"{what} lists no boards.");

        if (EmbedBatchTokenBudget <= 0 || MaxBatchItems <= 0)
            throw new InvalidOperationException($"{what} has a non-positive batch budget or item cap.");

        if (!LogoUrlTemplate.StartsWith("https://", StringComparison.Ordinal)
            || !LogoUrlTemplate.Contains("{domain}", StringComparison.Ordinal))
            throw new InvalidOperationException(
                $"{what} has logo_url_template {LogoUrlTemplate}, which must be an https URL "
                + "containing {domain}. Without the placeholder every company would get the same logo.");

        // One domain, one board. Two boards with the same domain are the same
        // company listed twice -- mid-move between tokens or between sources,
        // or added again under a second one -- and every one of its postings
        // would be stored, read, embedded, shown and scored twice. The domain is
        // exact; names are not. (docs/plans/multi-source-ingest.md -> Duplicates.)
        var twice = boards
            .Where(b => b.Domain is not null)
            .GroupBy(b => b.Domain!, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(g => g.Count() > 1);
        if (twice is not null)
            throw new InvalidOperationException(
                $"{what} lists {twice.Key} on two boards ({string.Join(", ", twice.Select(b => b.Key))}). "
                + "A company must come from one board, or every posting is duplicated.");

        var served = ServedLocations
            .Where(l => !string.IsNullOrWhiteSpace(l))
            .Select(l => l.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return this with { Boards = boards, Companies = null, CompanyDomains = null, ServedLocations = served };
    }

    /// <summary>The <c>boards</c> shape: every entry validated, a repeated key fatal.</summary>
    private List<BoardConfig> FromBoards(string what)
    {
        var result = new List<BoardConfig>(Boards!.Count);
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var raw in Boards)
        {
            var board = raw with
            {
                Source = raw.Source?.Trim() ?? "",
                Token = raw.Token?.Trim() ?? "",
                Domain = Domain(raw.Domain, raw.Token, what),
                Name = string.IsNullOrWhiteSpace(raw.Name) ? null : raw.Name.Trim(),
                Host = raw.Host?.Trim(),
                Tenant = raw.Tenant?.Trim(),
                Site = raw.Site?.Trim(),
                CompanyUid = raw.CompanyUid?.Trim(),
                ApiToken = raw.ApiToken?.Trim(),
                Region = raw.Region?.Trim(),
            };

            if (!KnownSources.Contains(board.Source))
                throw new InvalidOperationException(
                    $"{what} has a board on source '{board.Source}' ({board.Token}). "
                    + $"Known sources: {string.Join(", ", KnownSources.Order())}.");

            CheckToken(board.Source, board.Token, what);
            CheckSourceFields(board, what);

            // Unlike the old list, a repeat is fatal rather than dropped: with a
            // source and a domain on each entry, two entries can disagree.
            if (!keys.Add(board.Key))
                throw new InvalidOperationException($"{what} lists {board.Key} twice.");

            result.Add(board);
        }
        return result;
    }

    /// <summary>The old shape, read as Greenhouse boards -- its behaviour exactly as before.</summary>
    private List<BoardConfig> FromCompanies(string what)
    {
        var tokens = (Companies ?? [])
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c.Trim())
            .ToList();

        foreach (var token in tokens)
            CheckToken(GreenhouseSource.SourceName, token, what);

        // De-dupe case-insensitively, keeping the file's own order: the run log
        // then reads in the order a human wrote the list.
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var unique = tokens.Where(t => seen.Add(t)).ToList();

        var domains = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (token, raw) in CompanyDomains ?? [])
        {
            if (!seen.Contains(token.Trim()))
                throw new InvalidOperationException(
                    $"{what} has a domain for {token}, which is not in companies. "
                    + "One of the two is a typo, and guessing which would put a logo on the wrong board.");
            domains[token.Trim()] = Domain(raw, token, what) ?? "";
        }

        return [.. unique.Select(t => new BoardConfig
        {
            Source = GreenhouseSource.SourceName,
            Token = t,
            Domain = domains.TryGetValue(t, out var d) ? d : null,
        })];
    }

    // A board token is a URL path segment. Anything else is a typo that would
    // otherwise become a 404 attributed to the company rather than to the file
    // -- or, worse, a path traversal into another API route.
    private static void CheckToken(string source, string token, string what)
    {
        if (token.Length == 0 || !token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
            throw new InvalidOperationException(
                $"{what} contains '{token}', which is not a valid {source} board token "
                + "(letters, digits, '-' and '_' only). For Greenhouse the token is the slug in "
                + "boards.greenhouse.io/<token>, not a company's display name or URL.");
    }

    // Each source's own fields: required where the source needs them, and
    // refused where it does not -- a Workday field on a Greenhouse board is a
    // board filed under the wrong source, and ignoring it would hide that.
    private static void CheckSourceFields(BoardConfig board, string what)
    {
        var workdayFields = board.Host is not null || board.Tenant is not null
                            || board.Site is not null || board.Facets is not null;
        var comeetFields = board.CompanyUid is not null || board.ApiToken is not null;

        if (board.Source != WorkdaySource.SourceName && workdayFields)
            throw new InvalidOperationException(
                $"{what}: {board.Key} has host/tenant/site/facets, which only a workday board takes.");
        if (board.Source != ComeetSource.SourceName && comeetFields)
            throw new InvalidOperationException(
                $"{what}: {board.Key} has company_uid/api_token, which only a comeet board takes.");
        if (board.Source != LeverSource.SourceName && board.Region is not null)
            throw new InvalidOperationException($"{what}: {board.Key} has region, which only a lever board takes.");

        string Required(string? value, string field) => string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"{what}: {board.Key} is a {board.Source} board and needs {field}.")
            : value;

        switch (board.Source)
        {
            case LeverSource.SourceName:
                Required(board.Name, "name");   // a Lever posting carries no company name
                if (board.Region is not null && board.Region != LeverSource.EuRegion)
                    throw new InvalidOperationException(
                        $"{what}: {board.Key} has region '{board.Region}'. The only one is '{LeverSource.EuRegion}' "
                        + "(jobs.eu.lever.co); leave it out for the global instance.");
                return;
            case ComeetSource.SourceName:
                CheckComeetFields(board, what, Required);
                return;
            case WorkdaySource.SourceName:
                break;
            default:
                return;
        }

        Required(board.Name, "name");   // the posting's own is a legal entity, not a display name

        // The host is put into a URL: it must be exactly a Workday host, so a
        // typo cannot send the fetch to another domain.
        if (!System.Text.RegularExpressions.Regex.IsMatch(Required(board.Host, "host"), @"^[a-z0-9-]+\.wd[0-9]+$"))
            throw new InvalidOperationException(
                $"{what}: {board.Key} has host '{board.Host}'. Expected <name>.wd<n>, as in nvidia.wd5 "
                + "for nvidia.wd5.myworkdayjobs.com.");

        foreach (var (field, value) in new[] { ("tenant", board.Tenant), ("site", board.Site) })
            if (!Required(value, field).All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
                throw new InvalidOperationException($"{what}: {board.Key} has {field} '{value}': letters, digits, '-' and '_' only.");

        foreach (var (facet, ids) in board.Facets ?? [])
            if (facet.Length == 0 || !facet.All(char.IsAsciiLetterOrDigit) || ids is null || ids.Count == 0
                || ids.Any(id => string.IsNullOrEmpty(id) || !id.All(char.IsAsciiLetterOrDigit)))
                throw new InvalidOperationException(
                    $"{what}: {board.Key} has a malformed facet '{facet}'. Expected a facet parameter name "
                    + "mapped to a non-empty list of facet value ids, as the site's own listing reports them.");
    }

    // Both go into the request URL, so each must be exactly its shape: a typo
    // becomes a 400 blamed on the file, never a request to another path.
    private static void CheckComeetFields(BoardConfig board, string what, Func<string?, string, string> required)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(required(board.CompanyUid, "company_uid"), @"^[0-9A-Fa-f]{2}\.[0-9A-Fa-f]{3}$"))
            throw new InvalidOperationException(
                $"{what}: {board.Key} has company_uid '{board.CompanyUid}'. Expected the uid in the careers URL, "
                + "as in 43.001 for comeet.com/jobs/vastdata/43.001.");

        if (!required(board.ApiToken, "api_token").All(char.IsAsciiLetterOrDigit))
            throw new InvalidOperationException($"{what}: {board.Key} has api_token '{board.ApiToken}': letters and digits only.");
    }

    // A bare hostname: no scheme, no path. It is substituted into a URL, so
    // anything else is either a broken logo or a different URL. Null or blank
    // is "no domain": the card falls back to its initial.
    private static string? Domain(string? raw, string? token, string what)
    {
        if (raw is null) return null;
        var domain = raw.Trim().ToLowerInvariant();
        if (domain.Length == 0 || !domain.Contains('.')
            || !domain.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '.'))
            throw new InvalidOperationException(
                $"{what} has domain {raw} for {token}. Expected a bare hostname like example.com, "
                + "with no scheme or path.");
        return domain;
    }
}
