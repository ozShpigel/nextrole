using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// LinkedIn search results, through the jobspy scraper (<c>server/scraper</c>,
/// <c>POST /scrape</c>), as an <see cref="IJobSource"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Not a board.</b> A LinkedIn "board" in <c>boards.json</c> is a search --
/// job titles in locations -- and its job is to fill the gaps between the
/// company boards (smaller and Israeli companies), not to compete with them.
/// The rules below are the ones <c>Tasks.md</c> set before it was built, and
/// they are deliberately all simple.
/// </para>
/// <para>
/// <b>Never complete.</b> A search returns a slice, so a posting missing from
/// today's results is not closed: <see cref="Listing.Complete"/> is always
/// false and the close diff never runs for it. A LinkedIn posting leaves by age
/// instead -- <c>JobStore</c> stamps a delete date when it first stores one
/// (<see cref="DeleteAfterDays"/> after it was posted, or after NextRole first
/// saw it when LinkedIn gives no date), and a TTL index removes it then. The
/// search asks only for recent postings (<c>hours_old</c>), so one that has been
/// deleted is not fetched back.
/// </para>
/// <para>
/// <b>Duplicates by construction.</b> A posting from a company that has its own
/// board in <c>boards.json</c> is skipped: that company's jobs come from its
/// board, never from LinkedIn. Two independent checks, either one enough:
/// the posting's own "Apply" link (<c>job_url_direct</c>) points at a board we
/// read, or at a board company's domain -- which holds however LinkedIn spells
/// the name; or the company's normalised name equals a board's name, token,
/// domain stem or one of its <c>aliases</c>. Nothing fuzzier: a false match
/// would hide a real job. What both miss -- an Easy Apply posting under a
/// spelling no alias covers -- shows in the kept-companies log line, and an
/// alias closes it. Within LinkedIn the job id in the posting URL is the key;
/// the scraper's own row id is a fresh UUID per scrape and is not used.
/// </para>
/// <para>
/// <b>No description, no posting.</b> jobspy fetches each description with a
/// separate request that LinkedIn throttles, and a throttled one comes back
/// empty or cut short. Stored, it would be read for facts and scored as if it
/// were the job. So a posting with too little text has no detail this run
/// (<see cref="DetailAsync"/> returns null): skipped, and retried if it comes
/// back.
/// </para>
/// <para>
/// <b>Fails quietly, alone.</b> Scraping LinkedIn breaks without warning. A
/// failure throws <see cref="BoardFetchException"/>, which fails this one
/// message and touches no company board.
/// </para>
/// </remarks>
public sealed partial class LinkedInSource : IJobSource
{
    /// <summary>The source name in <c>boards.json</c> and in every stored board key.</summary>
    public const string SourceName = "linkedin";

    /// <summary>
    /// Days after posting (or first seen) that a LinkedIn posting is deleted.
    /// Also its whole visible life: no close diff ever ends it sooner.
    /// </summary>
    public const int DeleteAfterDays = 21;

    /// <summary>Shorter than this, a description is treated as not fetched.</summary>
    public const int MinDescriptionLength = 300;

    private readonly HttpClient _scraper;
    private readonly IReadOnlySet<string> _boardCompanies;
    private readonly BoardLinks _boardLinks;
    private readonly ILogger<LinkedInSource> _log;

    /// <param name="scraper">An HttpClient whose BaseAddress is the scraper; null when none is configured.</param>
    /// <param name="boards">Every configured board: their companies are skipped here.</param>
    public LinkedInSource(HttpClient? scraper, IEnumerable<BoardConfig> boards, ILogger<LinkedInSource> log)
    {
        _scraper = scraper ?? new HttpClient();
        var all = boards.ToList();
        _boardCompanies = CompanyNamesOf(all);
        _boardLinks = BoardLinks.Of(all);
        _log = log;
    }

    public string Name => SourceName;

    public async Task<Listing> ListAsync(BoardConfig board, CancellationToken ct)
    {
        if (_scraper.BaseAddress is null)
            throw new BoardFetchException(
                $"Board {board.Key}: no scraper configured (Scraper:BaseUrl). LinkedIn is read through it.");

        var request = new ScrapeRequest
        {
            JobTitles = board.Titles ?? [],
            Locations = board.Locations ?? [],
            ResultsWanted = board.ResultsWanted ?? 50,
            HoursOld = board.HoursOld ?? 48,
        };

        ScrapeResponse? response;
        try
        {
            using var http = await _scraper.PostAsJsonAsync("scrape", request, ct);
            if (!http.IsSuccessStatusCode)
                throw new BoardFetchException($"Board {board.Key}: the scraper returned {(int)http.StatusCode}.");
            response = await http.Content.ReadFromJsonAsync<ScrapeResponse>(ct);
        }
        catch (BoardFetchException) { throw; }
        catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            throw new BoardFetchException($"Board {board.Key}: the scraper could not be reached or answered garbage.", e);
        }

        if (response?.Jobs is null)
            throw new BoardFetchException($"Board {board.Key}: the scraper returned no job list.");

        // jobspy swallows rate-limit errors and returns fewer rows, so the
        // stats are the only sign of a blocked run. Every search failing is a
        // failed fetch, not a quiet day.
        if (response.Stats is { SearchesTotal: > 0 } stats && stats.SearchesFailed == stats.SearchesTotal)
            throw new BoardFetchException(
                $"Board {board.Key}: every one of {stats.SearchesTotal} LinkedIn searches failed (blocked?).");

        var excluded = (board.ExcludeCompanies ?? []).Select(Normalize).Where(n => n.Length > 0)
            .ToHashSet(StringComparer.Ordinal);

        var postings = new List<ListedPosting>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        int noId = 0, boardCompany = 0, agency = 0, thin = 0;
        var keptCompanies = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var job in response.Jobs)
        {
            var id = JobIdFrom(job.JobUrl);
            if (id is null) { noId++; continue; }
            if (!seen.Add(id)) continue;
            if (_boardLinks.Matches(job.JobUrlDirect) || _boardCompanies.Contains(Normalize(job.Company)))
            {
                boardCompany++;
                continue;
            }
            // Agencies listed in the entry's exclude_companies: skipped before
            // anything is paid for them.
            if (excluded.Contains(Normalize(job.Company))) { agency++; continue; }
            if (Blank(job.Company) is { } company) keptCompanies.Add(company);

            var listed = new ListedPosting(
                SourceJobId: id,
                Title: Blank(job.Title),
                Location: Blank(job.Location),
                Offices: [],
                Departments: [],
                PostedAt: DateFrom(job.DatePosted),
                UpdatedAt: null);

            var text = job.Description?.Trim() ?? "";
            if (text.Length < MinDescriptionLength) thin++;
            postings.Add(text.Length < MinDescriptionLength
                ? listed
                : listed with
                {
                    Detail = new SourcePosting(listed, text, Blank(job.JobUrl), Blank(job.Company), RequisitionId: null,
                        CompanyLogo: HttpsUrl(job.CompanyLogo)),
                });
        }

        _log.LogInformation(
            "Board {Board}: {Kept} LinkedIn posting(s); skipped {NoId} without a job id, {BoardCompany} from companies with their own board and {Agency} from excluded companies; {Thin} without a usable description (retried if seen again)",
            board.Key, postings.Count, noId, boardCompany, agency, thin);
        // The duplicate check's trail: a company here that also has a board
        // under another spelling is a missing alias.
        _log.LogInformation("Board {Board}: LinkedIn companies kept: {Companies}",
            board.Key, string.Join(", ", keptCompanies));

        return new Listing(postings, Complete: false, Total: null);
    }

    /// <summary>
    /// The posting's detail is the description the search already carried; a
    /// posting without one is skipped this run.
    /// </summary>
    public Task<SourcePosting?> DetailAsync(BoardConfig board, ListedPosting posting, CancellationToken ct) =>
        Task.FromResult(posting.Detail);

    /// <summary>LinkedIn's own job id, from /jobs/view/[slug-]&lt;id&gt;; null when the URL has none.</summary>
    public static string? JobIdFrom(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        var m = JobIdPattern().Match(url);
        return m.Success ? m.Groups[1].Value : null;
    }

    /// <summary>
    /// A company name for comparison: lowercase letters and digits only, with a
    /// trailing legal suffix dropped -- "Wiz Inc." and "wiz" compare equal.
    /// </summary>
    public static string Normalize(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "";
        var words = WordPattern().Matches(name.ToLowerInvariant()).Select(m => m.Value).ToList();
        while (words.Count > 1 && LegalSuffixes.Contains(words[^1])) words.RemoveAt(words.Count - 1);
        return string.Concat(words);
    }

    /// <summary>The normalised names of every company with its own board.</summary>
    public static IReadOnlySet<string> CompanyNamesOf(IEnumerable<BoardConfig> boards)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var b in boards.Where(b => b.Source != SourceName))
        {
            names.Add(Normalize(b.Name));
            names.Add(Normalize(b.Token));
            if (b.Domain is { } domain) names.Add(Normalize(domain.Split('.')[0]));
            foreach (var alias in b.Aliases ?? []) names.Add(Normalize(alias));
        }
        names.Remove("");
        return names;
    }

    /// <summary>
    /// Whether an apply link leads to a board <c>boards.json</c> already reads.
    /// </summary>
    public sealed class BoardLinks
    {
        private readonly HashSet<string> _hostTokens = new(StringComparer.OrdinalIgnoreCase); // "host|first-path-segment"
        private readonly HashSet<string> _hosts = new(StringComparer.OrdinalIgnoreCase);      // whole hosts (Workday)
        private readonly List<string> _domains = [];                                          // company domains

        public static BoardLinks Of(IEnumerable<BoardConfig> boards)
        {
            var links = new BoardLinks();
            foreach (var b in boards.Where(b => b.Source != SourceName))
            {
                switch (b.Source)
                {
                    case GreenhouseSource.SourceName:
                        links._hostTokens.Add($"boards.greenhouse.io|{b.Token}");
                        links._hostTokens.Add($"job-boards.greenhouse.io|{b.Token}");
                        links._hostTokens.Add($"job-boards.eu.greenhouse.io|{b.Token}");
                        break;
                    case LeverSource.SourceName:
                        links._hostTokens.Add($"jobs.lever.co|{b.Token}");
                        links._hostTokens.Add($"jobs.eu.lever.co|{b.Token}");
                        break;
                    case ComeetSource.SourceName:
                        links._hostTokens.Add($"www.comeet.com|jobs/{b.Token}");
                        links._hostTokens.Add($"comeet.com|jobs/{b.Token}");
                        break;
                    case WorkdaySource.SourceName when b.Host is not null:
                        links._hosts.Add($"{b.Host}.myworkdayjobs.com");
                        break;
                }
                if (b.Domain is { } domain) links._domains.Add(domain.ToLowerInvariant());
            }
            return links;
        }

        public bool Matches(string? url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
            var host = uri.Host.ToLowerInvariant();
            if (_hosts.Contains(host)) return true;
            if (_domains.Any(d => host == d || host.EndsWith("." + d, StringComparison.Ordinal))) return true;

            var segments = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length == 0) return false;
            return _hostTokens.Contains($"{host}|{segments[0]}")
                || (segments.Length > 1 && _hostTokens.Contains($"{host}|{segments[0]}/{segments[1]}"));
        }
    }

    private static readonly HashSet<string> LegalSuffixes =
        new(StringComparer.Ordinal) { "inc", "ltd", "llc", "corp", "corporation", "gmbh", "co", "limited" };

    private static DateTime? DateFrom(string? value) =>
        DateTime.TryParse(value, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var d)
            ? DateTime.SpecifyKind(d, DateTimeKind.Utc)
            : null;

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    // Scraped, and rendered as an image source: an absolute https URL or nothing.
    internal static string? HttpsUrl(string? s) =>
        Uri.TryCreate(Blank(s), UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps
            ? uri.AbsoluteUri
            : null;

    [GeneratedRegex(@"/jobs/view/(?:[^/?#]*-)?(\d{6,})")]
    private static partial Regex JobIdPattern();

    [GeneratedRegex(@"[a-z0-9]+")]
    private static partial Regex WordPattern();

    private sealed record ScrapeRequest
    {
        [JsonPropertyName("job_titles")] public List<string> JobTitles { get; init; } = [];
        [JsonPropertyName("locations")] public List<string> Locations { get; init; } = [];
        [JsonPropertyName("site_names")] public List<string> SiteNames { get; init; } = ["linkedin"];
        [JsonPropertyName("results_wanted")] public int ResultsWanted { get; init; }
        [JsonPropertyName("hours_old")] public int HoursOld { get; init; }
    }

    internal sealed record ScrapeResponse
    {
        [JsonPropertyName("jobs")] public List<ScrapedJob>? Jobs { get; init; }
        [JsonPropertyName("stats")] public ScrapeStats? Stats { get; init; }
    }

    internal sealed record ScrapeStats
    {
        [JsonPropertyName("searches_total")] public int SearchesTotal { get; init; }
        [JsonPropertyName("searches_failed")] public int SearchesFailed { get; init; }
    }

    internal sealed record ScrapedJob
    {
        [JsonPropertyName("title")] public string? Title { get; init; }
        [JsonPropertyName("company")] public string? Company { get; init; }
        [JsonPropertyName("location")] public string? Location { get; init; }
        [JsonPropertyName("description")] public string? Description { get; init; }
        [JsonPropertyName("job_url")] public string? JobUrl { get; init; }
        [JsonPropertyName("job_url_direct")] public string? JobUrlDirect { get; init; }
        [JsonPropertyName("date_posted")] public string? DatePosted { get; init; }
        [JsonPropertyName("company_logo")] public string? CompanyLogo { get; init; }
    }
}
