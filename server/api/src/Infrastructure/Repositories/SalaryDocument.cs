using ApplicationTracker.Core.Matching;
using MongoDB.Bson;

namespace ApplicationTracker.Infrastructure.Repositories;

/// <summary>
/// Reads a stored <c>{ min, max, currency }</c> salary document back.
/// </summary>
/// <remarks>
/// Re-checked on the way out with the same bounds it was written under, so a
/// hand-edited or older row can never put an unchecked number on a card.
/// </remarks>
public static class SalaryDocument
{
    public static SalaryRange? Read(BsonDocument? parent, string field, bool estimate) =>
        parent is not null
        && parent.TryGetValue(field, out var v) && v.IsBsonDocument
        && v.AsBsonDocument.TryGetValue("min", out var min) && min.IsNumeric
        && v.AsBsonDocument.TryGetValue("max", out var max) && max.IsNumeric
        && v.AsBsonDocument.TryGetValue("currency", out var cur) && cur.IsString
            ? SalaryBounds.Check(min.ToInt64(), max.ToInt64(), cur.AsString, estimate)
            : null;

    /// <summary>The <c>extracted</c> sub-document of a pool row, or null.</summary>
    public static BsonDocument? Extracted(BsonDocument d) =>
        d.TryGetValue("extracted", out var e) && e.IsBsonDocument ? e.AsBsonDocument : null;
}
