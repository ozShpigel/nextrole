using ApplicationTracker.Infrastructure.Greenhouse;

namespace ApplicationTracker.Greenhouse;

/// <summary>What the product serves: location terms, and the countries they unambiguously mean.</summary>
/// <param name="Terms">Configured <c>served_locations</c> plus terms learned from profiles.</param>
/// <param name="Countries">The countries those terms mean (<see cref="Places.CountryOfTerm"/>).</param>
public sealed record ServedPlaces(IReadOnlyList<string> Terms, IReadOnlySet<string> Countries)
{
    /// <summary>No terms at all: no location filtering.</summary>
    public bool IsEmpty => Terms.Count == 0;

    public static readonly ServedPlaces None = new([], new HashSet<string>());

    public static ServedPlaces From(IEnumerable<string> terms)
    {
        var list = terms.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var countries = list.Select(Places.CountryOfTerm).OfType<string>().ToHashSet(StringComparer.Ordinal);
        return new ServedPlaces(list, countries);
    }
}
