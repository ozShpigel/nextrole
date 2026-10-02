using System.Text;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// Comeet's Careers API (<c>comeet.co/careers-api/2.0</c>), as an <see cref="IJobSource"/>.
/// </summary>
/// <remarks>
/// <para>
/// Measured 2026-10-02 on VAST Data (256 positions, 1.3 MB): with
/// <c>details=true</c> one request returns every position with its body, so
/// every posting arrives with its <see cref="ListedPosting.Detail"/> set and
/// <see cref="DetailAsync"/> is never needed -- as for Greenhouse.
/// </para>
/// <para>
/// A board is addressed by the company's uid and its careers token
/// (<see cref="BoardConfig.CompanyUid"/>, <see cref="BoardConfig.ApiToken"/>).
/// Both are public: the company's own careers page embeds them to call this
/// same API. A wrong pair is a 400 ("Account uid or token are not valid"),
/// which throws -- a rotated token fails loudly rather than emptying the board.
/// </para>
/// <para>
/// <b>Complete without a count</b>, for the reason given on <see cref="LeverSource"/>:
/// no total to check against, and a truncated array does not parse.
/// </para>
/// <para>
/// <b>No posting date.</b> Comeet gives only <c>time_updated</c>, so
/// <see cref="ListedPosting.PostedAt"/> stays null and the prefilter's own
/// fallback to the update date is what ages a posting.
/// </para>
/// </remarks>
public sealed class ComeetSource : IJobSource
{
    /// <summary>The source name in <c>boards.json</c> and in every stored board key.</summary>
    public const string SourceName = "comeet";

    private readonly HttpClient _http;
    private readonly ILogger<ComeetSource> _log;

    public ComeetSource(HttpClient http, ILogger<ComeetSource> log)
    {
        _http = http;
        _log = log;
    }

    public string Name => SourceName;

    public async Task<Listing> ListAsync(BoardConfig board, CancellationToken ct)
    {
        var url = $"https://www.comeet.co/careers-api/2.0/company/{Uri.EscapeDataString(board.CompanyUid!)}/positions"
                  + $"?token={Uri.EscapeDataString(board.ApiToken!)}&details=true";
        var positions = await PublicBoardApi.GetAsync<List<ComeetPosition>>(_http, url, board, ct);

        // The uid is the upsert's key; an internal position is not public, and
        // never on the company's own careers page.
        var usable = positions.Where(p => !string.IsNullOrWhiteSpace(p.Uid) && p.IsInternal != true).ToList();
        if (usable.Count != positions.Count)
            _log.LogInformation("Board {Board}: left out {Count} internal or unidentified position(s)",
                board.Key, positions.Count - usable.Count);

        return new Listing([.. usable.Select(Map)], Complete: true, Total: null);
    }

    public Task<SourcePosting?> DetailAsync(BoardConfig board, ListedPosting posting, CancellationToken ct) =>
        Task.FromResult(posting.Detail);

    private static ListedPosting Map(ComeetPosition p)
    {
        var listed = new ListedPosting(
            SourceJobId: p.Uid!,
            Title: p.Name,
            Location: Blank(p.Location?.Name),
            Offices: [],
            Departments: Blank(p.Department) is { } department ? [department] : [],
            PostedAt: null,
            UpdatedAt: p.TimeUpdated?.UtcDateTime);

        // The company's own careers page when it has one, else Comeet's.
        var url = Blank(p.UrlActivePage) ?? Blank(p.UrlComeetHostedPage);
        return listed with
        {
            Detail = new SourcePosting(listed, Body(p), url, Blank(p.CompanyName), Blank(p.InternalUseCustomId)),
        };
    }

    /// <summary>Each detail section ("Description", "Requirements") under its own heading, in Comeet's order.</summary>
    internal static string Body(ComeetPosition p)
    {
        var html = new StringBuilder();
        foreach (var section in (p.Details ?? []).OrderBy(d => d.Order ?? int.MaxValue))
            html.Append("<h3>").Append(section.Name).Append("</h3>").Append(section.Value);
        return html.ToString();
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    internal sealed record ComeetPosition
    {
        [JsonPropertyName("uid")] public string? Uid { get; init; }
        [JsonPropertyName("name")] public string? Name { get; init; }
        [JsonPropertyName("department")] public string? Department { get; init; }
        [JsonPropertyName("company_name")] public string? CompanyName { get; init; }
        [JsonPropertyName("internal_use_custom_id")] public string? InternalUseCustomId { get; init; }
        [JsonPropertyName("time_updated")] public DateTimeOffset? TimeUpdated { get; init; }
        [JsonPropertyName("url_active_page")] public string? UrlActivePage { get; init; }
        [JsonPropertyName("url_comeet_hosted_page")] public string? UrlComeetHostedPage { get; init; }
        [JsonPropertyName("is_internal")] public bool? IsInternal { get; init; }
        [JsonPropertyName("location")] public ComeetLocation? Location { get; init; }
        [JsonPropertyName("details")] public List<ComeetDetail>? Details { get; init; }
    }

    internal sealed record ComeetLocation
    {
        [JsonPropertyName("name")] public string? Name { get; init; }
    }

    internal sealed record ComeetDetail
    {
        [JsonPropertyName("name")] public string? Name { get; init; }
        [JsonPropertyName("value")] public string? Value { get; init; }
        [JsonPropertyName("order")] public int? Order { get; init; }
    }
}
