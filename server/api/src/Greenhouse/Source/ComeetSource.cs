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
/// <b>One position, one posting.</b> A position published to several offices
/// comes back once per office: the base uid (<c>73.276</c>, Netanya) and one
/// <c>base-location</c> uid per extra office (<c>73.276-9D.50A</c>, Tel Aviv),
/// with the same title, body and careers-page link. Mapped one-to-one, each
/// became its own job: a duplicate card that opened the same page, and a second
/// score paid for. Measured 2026-10-03 over the 14 Comeet boards: 233 of 1,056
/// positions were such copies, in 135 groups of 2-10; every group had its base
/// uid and identical title and details. So a group collapses to the base
/// posting, carrying every office in <see cref="ListedPosting.Location"/>
/// ("Netanya; Tel Aviv") so the location filters still see each one.
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

        var groups = usable.GroupBy(p => BaseUid(p.Uid!)).ToList();
        if (groups.Count != usable.Count)
            _log.LogInformation("Board {Board}: merged {Count} per-location copies into {Groups} position(s)",
                board.Key, usable.Count - groups.Count, groups.Count(g => g.Count() > 1));

        return new Listing([.. groups.Select(g => Map(Merge(g.Key, [.. g])))], Complete: true, Total: null);
    }

    /// <summary>The position's own uid: <c>73.276-9D.50A</c> is <c>73.276</c> published to one more office.</summary>
    public static string BaseUid(string uid) => uid.Split('-', 2)[0];

    /// <summary>The base posting, with every office in the group as its location, the base's first.</summary>
    private static ComeetPosition Merge(string baseUid, List<ComeetPosition> group)
    {
        // The base uid has been in every measured group; without it, the first
        // copy stands in, so the posting is still kept rather than dropped.
        var primary = group.FirstOrDefault(p => p.Uid == baseUid) ?? group[0];
        if (group.Count == 1) return primary;

        var offices = new[] { primary }.Concat(group.Where(p => p != primary))
            .Select(p => Blank(p.Location?.Name))
            .OfType<string>()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        return primary with
        {
            Location = offices.Count == 0 ? primary.Location : new ComeetLocation { Name = string.Join("; ", offices) },
        };
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
