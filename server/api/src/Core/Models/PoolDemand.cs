using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// Something at least one user's profile wants -- a job function
// (JobFunctions.All) or a location term -- and which users want it.
//
// Read by the Greenhouse ingest's pre-read filter: a NEW posting of a function
// nobody wants, or in a place nobody is, is not paid for (docs/greenhouse.md ->
// "The pre-read filter"). One shape, two collections. Deliberately NOT
// user-scoped, like PoolRole: it is a property of the shared pool, and it
// records WHICH users want the value only so it can leave when the last of
// them does.
public sealed record PoolDemand
{
    public const string FunctionsCollection = "pool_functions";
    public const string LocationsCollection = "pool_locations";

    // The value itself: "infrastructure", or a lower-cased location term
    // ("tel aviv", "israel"). Being the _id makes "one document per value" a
    // constraint rather than a convention.
    [BsonId]
    public string Id { get; init; } = "";

    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public List<Guid> UserIds { get; init; } = new();

    public DateTime UpdatedAt { get; init; } = DateTime.UtcNow;

    /// <summary>At most this many terms from one profile location.</summary>
    public const int MaxLocationTerms = 4;

    /// <summary>
    /// The terms a profile location is matched by: every comma segment, lower-
    /// cased -- "Tel Aviv, Israel" gives "tel aviv" and "israel".
    /// </summary>
    /// <remarks>
    /// City AND country, because a board names either, and spellings differ:
    /// "Tel Aviv-Yafo" on a board misses "Tel Aviv" in a profile only if the
    /// country is missing too. A phrase segment ("open to relocation to
    /// london") matches no board and costs nothing; its country still does.
    /// The one-time fill in docs/greenhouse.md mirrors this split -- change
    /// both together, or the next profile save corrects the difference.
    /// </remarks>
    public static IReadOnlyList<string> LocationTermsOf(string? location) =>
        string.IsNullOrWhiteSpace(location)
            ? []
            : [.. location.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => s.ToLowerInvariant())
                .Where(s => s.Length is > 1 and <= 60 && s.Any(char.IsLetter))
                .Distinct()
                .Take(MaxLocationTerms)];
}
