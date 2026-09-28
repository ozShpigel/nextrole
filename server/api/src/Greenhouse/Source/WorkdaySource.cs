using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Greenhouse;

/// <summary>How gently one Workday careers site is read.</summary>
/// <param name="Pause">Between any two requests this source makes.</param>
/// <param name="MaxAttempts">Per request, counting the first; a 429 or a 5xx is retried.</param>
/// <param name="Backoff">The first retry's wait, doubled for each after (or the site's Retry-After, capped).</param>
public sealed record WorkdayLimits(TimeSpan Pause, int MaxAttempts, TimeSpan Backoff)
{
    /// <summary>A careers site's own backend, not an API built for this: one request a second.</summary>
    public static readonly WorkdayLimits Default = new(TimeSpan.FromSeconds(1), 3, TimeSpan.FromSeconds(5));
}

/// <summary>
/// Workday careers sites (<c>*.myworkdayjobs.com</c>), as an <see cref="IJobSource"/>.
/// </summary>
/// <remarks>
/// <para>
/// The public, undocumented API each site's own page calls -- measured
/// 2026-09-28, docs/plans/workday-adapter.md. The listing is pages of 20
/// carrying a title, a location text and a fuzzy age; the body, the exact date
/// and the full location list are one request per posting, which is why the
/// pre-read filter runs before and after it (phase 4).
/// </para>
/// <para>
/// <b>A failed fetch is not an empty board</b>, here as for Greenhouse. The
/// listing's <c>total</c> is on its first page only (every later page says
/// 0), so completeness is page one's total against the ids collected over all
/// pages: any failed page, a count that differs, or a repeated id throws. A
/// total of 2000 is Workday's cap, not a count, and such a listing is reported
/// <see cref="Listing.Complete"/> = false -- stored, nothing closed -- until the
/// board is narrowed with facets.
/// </para>
/// <para>
/// <b>One request at a time</b>, with a pause between any two and a bounded
/// retry on 429/5xx. Built for one daily run per board, not for speed.
/// </para>
/// </remarks>
public sealed partial class WorkdaySource : IJobSource
{
    /// <summary>The source name in <c>boards.json</c> and in every stored board key.</summary>
    public const string SourceName = "workday";

    /// <summary>The page size the site's own page uses; larger is refused.</summary>
    public const int PageSize = 20;

    /// <summary>What <c>total</c> says when a site has more postings than it will count.</summary>
    public const int TotalCap = 2000;

    private readonly HttpClient _http;
    private readonly ILogger<WorkdaySource> _log;
    private readonly WorkdayLimits _limits;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private readonly SemaphoreSlim _oneAtATime = new(1, 1);
    private bool _requested;

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public WorkdaySource(
        HttpClient http, ILogger<WorkdaySource> log, WorkdayLimits? limits = null,
        Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        _http = http;
        _log = log;
        _limits = limits ?? WorkdayLimits.Default;
        _delay = delay ?? Task.Delay;
    }

    public string Name => SourceName;

    public async Task<Listing> ListAsync(BoardConfig board, CancellationToken ct)
    {
        var url = $"{Root(board)}/jobs";
        var postings = new List<ListedPosting>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var returned = 0;
        var stubs = 0;
        int? total = null;

        for (var offset = 0; ; offset += PageSize)
        {
            // A site that never returns a short page must not page forever.
            if (offset > TotalCap + PageSize)
                throw new BoardFetchException($"Board {board.Key}: still paging at offset {offset}; refusing to go on.");

            var body = JsonSerializer.Serialize(new
            {
                appliedFacets = board.Facets ?? new Dictionary<string, List<string>>(),
                limit = PageSize,
                offset,
                searchText = "",
            });

            string text;
            try
            {
                text = await SendAsync(() => new HttpRequestMessage(HttpMethod.Post, url)
                {
                    Content = new StringContent(body, Encoding.UTF8, "application/json"),
                }, ct);
            }
            catch (WorkdayRequestException e)
            {
                throw new BoardFetchException($"Board {board.Key}: the listing page at offset {offset} failed. {e.Message}", e);
            }

            WorkdayPage? page;
            try { page = JsonSerializer.Deserialize<WorkdayPage>(text, Json); }
            catch (JsonException e)
            {
                throw new BoardFetchException($"Board {board.Key}: the listing page at offset {offset} did not parse.", e);
            }
            if (page?.JobPostings is null)
                throw new BoardFetchException($"Board {board.Key}: the listing page at offset {offset} had no jobPostings.");

            // On page one only: every later page says 0.
            if (offset == 0)
                total = page.Total
                    ?? throw new BoardFetchException($"Board {board.Key}: the first listing page gave no total.");

            foreach (var item in page.JobPostings)
            {
                // Counted whatever it is: completeness is about whether the site
                // returned every posting it counts, not whether we can use each.
                returned++;

                // A stub -- measured on NVIDIA, 2026-09-28: {"bulletFields": ["JR2018715"]},
                // no title, no path, gone again an hour later (a posting being
                // unpublished). Nothing to identify or read it by, so it is never
                // stored -- and so can never be closed by mistake either.
                var id = IdOf(item.ExternalPath);
                if (id is null)
                {
                    stubs++;
                    continue;
                }
                // Pages shift when postings are added mid-listing: one seen twice
                // means another was missed, and the count cannot be trusted.
                if (!ids.Add(id))
                    throw new BoardFetchException(
                        $"Board {board.Key}: posting {id} listed twice; the pages shifted during the listing.");

                postings.Add(new ListedPosting(
                    SourceJobId: id,
                    Title: item.Title,
                    Location: PlaceOf(item.LocationsText),
                    Offices: [],
                    Departments: [],
                    PostedAt: null,     // "Posted 30+ Days Ago" is not a date; the detail has one
                    UpdatedAt: null,
                    DetailRef: item.ExternalPath));
            }

            if (page.JobPostings.Count < PageSize) break;
        }

        if (total == TotalCap)
        {
            _log.LogWarning(
                "Board {Board}: the site reports {Total} postings, which is Workday's cap, not a count; {Listed} listed. "
                + "Stored, but nothing is closed until the board is narrowed with facets in boards.json.",
                board.Key, total, postings.Count);
            return new Listing(postings, Complete: false, Total: total);
        }

        if (stubs > 0)
            _log.LogWarning(
                "Board {Board}: {Count} listed posting(s) had no usable path (a posting being unpublished); skipped",
                board.Key, stubs);

        if (returned != total)
            throw new BoardFetchException(
                $"Board {board.Key}: the site said total={total} but {returned} posting(s) were listed. "
                + "Treating a short listing as the full board would close the missing postings.");

        return new Listing(postings, Complete: true, Total: total);
    }

    /// <returns>Null when it could not be read: skipped this run, retried next, never closed for it.</returns>
    public async Task<SourcePosting?> DetailAsync(BoardConfig board, ListedPosting posting, CancellationToken ct)
    {
        if (posting.DetailRef is not { } path || !IsPostingPath(path))
        {
            _log.LogWarning("Board {Board}: posting {Id} has no usable path to read it by", board.Key, posting.SourceJobId);
            return null;
        }

        WorkdayInfo? info;
        try
        {
            var text = await SendAsync(() => new HttpRequestMessage(HttpMethod.Get, Root(board) + path), ct);
            info = JsonSerializer.Deserialize<WorkdayDetail>(text, Json)?.Info;
        }
        catch (Exception e) when (e is WorkdayRequestException or JsonException)
        {
            _log.LogWarning("Board {Board}: posting {Id} could not be read ({Error})",
                board.Key, posting.SourceJobId, e.Message);
            return null;
        }
        if (info is null)
        {
            _log.LogWarning("Board {Board}: posting {Id} came back without jobPostingInfo", board.Key, posting.SourceJobId);
            return null;
        }

        var listed = posting with
        {
            Title = string.IsNullOrWhiteSpace(info.Title) ? posting.Title : info.Title,
            Location = info.Location ?? posting.Location,
            Offices = [.. (info.AdditionalLocations ?? []).Where(l => !string.IsNullOrWhiteSpace(l))],
            PostedAt = DateOf(info.StartDate),
            DetailRef = null,
        };

        // The posting's own legal entity ("Orbotech LTD") is not a display
        // name, so the company is the board's configured one.
        return new SourcePosting(listed, info.JobDescription, info.ExternalUrl, board.Name, info.JobReqId);
    }

    private static string Root(BoardConfig board) =>
        $"https://{board.Host}.myworkdayjobs.com/wday/cxs/{Uri.EscapeDataString(board.Tenant!)}/{Uri.EscapeDataString(board.Site!)}";

    /// <summary>
    /// The posting's id: its path's last segment, which is Workday's own
    /// <c>jobPostingId</c> -- unique by construction, and on every tenant.
    /// </summary>
    /// <remarks>
    /// Not <c>bulletFields</c>: that is a display field each tenant configures,
    /// and on KLA it misses the repost suffix of 19 in 75 (<c>..._2640335-2</c>).
    /// </remarks>
    internal static string? IdOf(string? externalPath)
    {
        if (externalPath is null || !IsPostingPath(externalPath)) return null;
        var id = externalPath[(externalPath.LastIndexOf('/') + 1)..];
        return id.Length == 0 ? null : id;
    }

    // It comes from the site's own response and is appended to our URL, so it
    // must be a posting path and nothing else: no scheme, no host, no "..".
    private static bool IsPostingPath(string path) =>
        PostingPath().IsMatch(path) && !path.Split('/').Any(segment => segment is "." or "..");

    [GeneratedRegex(@"^/job/[A-Za-z0-9._~%'()!*,-]+(/[A-Za-z0-9._~%'()!*,-]+)*$")]
    private static partial Regex PostingPath();

    // "Yavne, Israel" is a place; "2 Locations" is a count and names none, so
    // it is left out and the filter reads the posting (the detail has them).
    internal static string? PlaceOf(string? locationsText) =>
        string.IsNullOrWhiteSpace(locationsText) || LocationCount().IsMatch(locationsText) ? null : locationsText;

    [GeneratedRegex(@"^\d+\s+Locations?$", RegexOptions.IgnoreCase)]
    private static partial Regex LocationCount();

    // "2026-09-28": the exact posting date, as UTC midnight -- the age rule
    // works in days, and every other date the pipeline stores is UTC.
    internal static DateTime? DateOf(string? startDate) =>
        DateTime.TryParseExact(startDate, "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d)
            ? DateTime.SpecifyKind(d, DateTimeKind.Utc)
            : null;

    /// <summary>One request, paced and retried: a 429 or a 5xx waits and tries again.</summary>
    private async Task<string> SendAsync(Func<HttpRequestMessage> build, CancellationToken ct)
    {
        await _oneAtATime.WaitAsync(ct);
        try
        {
            for (var attempt = 1; ; attempt++)
            {
                if (_requested) await _delay(_limits.Pause, ct);
                _requested = true;

                HttpResponseMessage response;
                try
                {
                    using var request = build();
                    request.Headers.Accept.ParseAdd("application/json");
                    response = await _http.SendAsync(request, ct);
                }
                catch (Exception e) when (e is HttpRequestException
                                          || (e is TaskCanceledException && !ct.IsCancellationRequested))
                {
                    if (attempt >= _limits.MaxAttempts)
                        throw new WorkdayRequestException($"Unreachable after {attempt} attempt(s): {e.Message}", e);
                    await _delay(BackoffFor(attempt, null), ct);
                    continue;
                }

                using (response)
                {
                    if (response.IsSuccessStatusCode)
                        return await response.Content.ReadAsStringAsync(ct);

                    var retryable = response.StatusCode == HttpStatusCode.TooManyRequests || (int)response.StatusCode >= 500;
                    if (!retryable || attempt >= _limits.MaxAttempts)
                        throw new WorkdayRequestException(
                            $"{(int)response.StatusCode} {response.StatusCode} after {attempt} attempt(s).");

                    await _delay(BackoffFor(attempt, response.Headers.RetryAfter?.Delta), ct);
                }
            }
        }
        finally
        {
            _oneAtATime.Release();
        }
    }

    // The site's own Retry-After when it gives one, never more than a minute:
    // one board must not hold the queue for longer than that per request.
    private TimeSpan BackoffFor(int attempt, TimeSpan? retryAfter)
    {
        var doubled = TimeSpan.FromTicks(_limits.Backoff.Ticks * (1L << Math.Min(attempt - 1, 10)));
        var wait = retryAfter ?? doubled;
        return wait > TimeSpan.FromMinutes(1) ? TimeSpan.FromMinutes(1) : wait;
    }

    private sealed class WorkdayRequestException(string message, Exception? inner = null) : Exception(message, inner);

    private sealed record WorkdayPage
    {
        [JsonPropertyName("total")] public int? Total { get; init; }
        [JsonPropertyName("jobPostings")] public List<WorkdayListed>? JobPostings { get; init; }
    }

    private sealed record WorkdayListed
    {
        [JsonPropertyName("title")] public string? Title { get; init; }
        [JsonPropertyName("externalPath")] public string? ExternalPath { get; init; }
        [JsonPropertyName("locationsText")] public string? LocationsText { get; init; }
    }

    private sealed record WorkdayDetail
    {
        [JsonPropertyName("jobPostingInfo")] public WorkdayInfo? Info { get; init; }
    }

    private sealed record WorkdayInfo
    {
        [JsonPropertyName("title")] public string? Title { get; init; }
        [JsonPropertyName("jobDescription")] public string? JobDescription { get; init; }
        [JsonPropertyName("location")] public string? Location { get; init; }
        [JsonPropertyName("additionalLocations")] public List<string>? AdditionalLocations { get; init; }
        [JsonPropertyName("startDate")] public string? StartDate { get; init; }
        [JsonPropertyName("jobReqId")] public string? JobReqId { get; init; }
        [JsonPropertyName("externalUrl")] public string? ExternalUrl { get; init; }
    }
}
