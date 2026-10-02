using System.Text;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// Lever's public postings API (<c>api.lever.co/v0/postings/&lt;site&gt;</c>), as an <see cref="IJobSource"/>.
/// </summary>
/// <remarks>
/// <para>
/// Measured 2026-10-02 on palantir (320 postings, 6.2 MB) and spotify (80): with
/// no <c>limit</c> the endpoint returns the whole board in one array, bodies
/// included, so every posting arrives with its <see cref="ListedPosting.Detail"/>
/// set and <see cref="DetailAsync"/> is never needed -- as for Greenhouse.
/// </para>
/// <para>
/// <b>Complete without a count.</b> Lever gives no total to check the array
/// against. What it can give is a truncated body, and that stops being valid
/// JSON, so <see cref="PublicBoardApi"/> throws on it. A parsed array is the
/// whole board, as a Greenhouse board with no <c>meta.total</c> is accepted;
/// <c>CloseDiff</c> still refuses to empty a large stored board on an empty one.
/// </para>
/// <para>
/// Not read: <c>salaryRange</c> (absent on all 400 postings measured -- mapping
/// a shape never seen is a guess), and Lever's EU instance (<c>api.eu.lever.co</c>):
/// a board hosted there answers 404 here and fails loudly rather than emptily.
/// </para>
/// </remarks>
public sealed class LeverSource : IJobSource
{
    /// <summary>The source name in <c>boards.json</c> and in every stored board key.</summary>
    public const string SourceName = "lever";

    private readonly HttpClient _http;
    private readonly ILogger<LeverSource> _log;

    public LeverSource(HttpClient http, ILogger<LeverSource> log)
    {
        _http = http;
        _log = log;
    }

    public string Name => SourceName;

    public async Task<Listing> ListAsync(BoardConfig board, CancellationToken ct)
    {
        var url = $"https://api.lever.co/v0/postings/{Uri.EscapeDataString(board.Token)}?mode=json";
        var postings = await PublicBoardApi.GetAsync<List<LeverPosting>>(_http, url, board, ct);

        // The id is the upsert's key: a posting without one cannot be followed
        // across runs, so it is dropped rather than stored under one we invent.
        var usable = postings.Where(p => !string.IsNullOrWhiteSpace(p.Id)).ToList();
        if (usable.Count != postings.Count)
            _log.LogWarning("Board {Board}: dropped {Count} posting(s) with no id", board.Key, postings.Count - usable.Count);

        return new Listing([.. usable.Select(p => Map(board, p))], Complete: true, Total: null);
    }

    public Task<SourcePosting?> DetailAsync(BoardConfig board, ListedPosting posting, CancellationToken ct) =>
        Task.FromResult(posting.Detail);

    private static ListedPosting Map(BoardConfig board, LeverPosting p)
    {
        var location = Blank(p.Categories?.Location);
        var listed = new ListedPosting(
            SourceJobId: p.Id!,
            Title: p.Text,
            Location: location,
            Offices: [.. (p.Categories?.AllLocations ?? [])
                .Where(l => !string.IsNullOrWhiteSpace(l) && !string.Equals(l, location, StringComparison.OrdinalIgnoreCase))],
            Departments: [.. new[] { p.Categories?.Department, p.Categories?.Team }
                .Select(Blank).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase)],
            // Epoch milliseconds. The only date Lever gives; it has no edit date.
            PostedAt: p.CreatedAt is { } ms ? DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime : null,
            UpdatedAt: null);

        // Lever postings carry no company name, so the board's configured one.
        return listed with { Detail = new SourcePosting(listed, Body(p), p.HostedUrl, board.Name, RequisitionId: null) };
    }

    /// <summary>
    /// The posting as Lever's own page shows it: the description, each list
    /// under its heading ("Requirements", "What you'll do"), then the closing
    /// text. The lists are where the requirements are -- the description alone
    /// is mostly the company pitch.
    /// </summary>
    internal static string Body(LeverPosting p)
    {
        var html = new StringBuilder(p.Description ?? "");
        foreach (var list in p.Lists ?? [])
            html.Append("<h3>").Append(list.Text).Append("</h3><ul>").Append(list.Content).Append("</ul>");
        html.Append(p.Additional);
        return html.ToString();
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    internal sealed record LeverPosting
    {
        [JsonPropertyName("id")] public string? Id { get; init; }
        [JsonPropertyName("text")] public string? Text { get; init; }
        [JsonPropertyName("createdAt")] public long? CreatedAt { get; init; }
        [JsonPropertyName("hostedUrl")] public string? HostedUrl { get; init; }
        [JsonPropertyName("description")] public string? Description { get; init; }
        [JsonPropertyName("lists")] public List<LeverList>? Lists { get; init; }
        [JsonPropertyName("additional")] public string? Additional { get; init; }
        [JsonPropertyName("categories")] public LeverCategories? Categories { get; init; }
    }

    internal sealed record LeverList
    {
        [JsonPropertyName("text")] public string? Text { get; init; }
        [JsonPropertyName("content")] public string? Content { get; init; }
    }

    internal sealed record LeverCategories
    {
        [JsonPropertyName("location")] public string? Location { get; init; }
        [JsonPropertyName("allLocations")] public List<string>? AllLocations { get; init; }
        [JsonPropertyName("department")] public string? Department { get; init; }
        [JsonPropertyName("team")] public string? Team { get; init; }
    }
}
