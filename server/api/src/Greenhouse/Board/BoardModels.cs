using ApplicationTracker.Core.Greenhouse;
using System.Text.Json.Serialization;

namespace ApplicationTracker.Greenhouse;

/// <summary>One board's whole response from <c>/v1/boards/{token}/jobs?content=true</c>.</summary>
public sealed record BoardResponse
{
    [JsonPropertyName("jobs")] public List<BoardJob> Jobs { get; init; } = [];
    [JsonPropertyName("meta")] public BoardMeta? Meta { get; init; }
}

/// <summary>
/// The board's own count of its jobs.
/// </summary>
/// <remarks>
/// Measured on four boards (stripe 665, gitlab 216, airbnb 168, similarweb 66):
/// <c>meta.total</c> equalled the number of jobs returned every time. The
/// endpoint does not paginate — one call is the whole board, 5.1 MB and 1.7s
/// for the largest of those.
///
/// That makes this field a free integrity check rather than a pagination
/// cursor, and it is used as one: see <see cref="BoardClient"/>.
/// </remarks>
public sealed record BoardMeta
{
    [JsonPropertyName("total")] public int? Total { get; init; }
}

public sealed record BoardJob
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("absolute_url")] public string? AbsoluteUrl { get; init; }
    [JsonPropertyName("company_name")] public string? CompanyName { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
    [JsonPropertyName("first_published")] public DateTimeOffset? FirstPublished { get; init; }
    [JsonPropertyName("requisition_id")] public string? RequisitionId { get; init; }

    /// <summary>
    /// The posting body — <b>HTML, entity-encoded</b>.
    /// </summary>
    /// <remarks>
    /// Not a typo and not optional to handle: the field literally contains
    /// <c>&amp;lt;h2&amp;gt;&amp;lt;strong&amp;gt;Who we are&amp;lt;/strong&amp;gt;</c>.
    /// It must be HTML-decoded BEFORE tags can be stripped. Skipping that first
    /// decode stores markup as prose, and because the content hash is perfectly
    /// stable over that garbage, the mistake never corrects itself on a later
    /// run — every subsequent run sees an unchanged hash and skips.
    /// See <see cref="ContentCleaner"/>.
    /// </remarks>
    [JsonPropertyName("content")] public string? Content { get; init; }

    [JsonPropertyName("location")] public BoardLocation? Location { get; init; }

    /// <summary>
    /// Stored, never filtered on at ingest.
    /// </summary>
    /// <remarks>
    /// The whole board is kept. Narrowing later must be a query, not a
    /// re-ingest — a department filter applied at write time is a decision that
    /// can only be revisited by re-fetching and re-embedding every board.
    /// </remarks>
    [JsonPropertyName("departments")] public List<BoardTaxonomy>? Departments { get; init; }
    [JsonPropertyName("offices")] public List<BoardTaxonomy>? Offices { get; init; }
}

public sealed record BoardLocation
{
    [JsonPropertyName("name")] public string? Name { get; init; }
}

public sealed record BoardTaxonomy
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
}
