using System.Text.RegularExpressions;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// Place name -> the countries it can mean, from GeoNames (cities over 15,000
/// people, countries, common aliases, US and Canadian states). Offline, no AI.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why.</b> A board that writes only "Munich" names no served term, and the
/// text match alone would skip it for a user in Berlin. Resolved, Munich is
/// Germany -- served -- and it is read.
/// </para>
/// <para>
/// <b>A set, and unioned.</b> Names are ambiguous: London is GB and CA, "IL" is
/// Israel and Illinois. A posting's countries are the union over every piece of
/// its location text, and it is read if ANY of them is served -- so ambiguity
/// can only cost a read. "Tel Aviv, IL" is {IL, US}: read for an Israeli user.
/// </para>
/// <para>
/// Data: <c>Data/places.tsv</c>, built by <c>Data/build_places.py</c>.
/// Source: GeoNames (https://www.geonames.org), CC BY 4.0.
/// </para>
/// </remarks>
public static class Places
{
    private static readonly Lazy<Dictionary<string, string[]>> Table = new(Load);

    // What separates places inside one location field: "Cardiff, London or
    // Remote (UK)", "London, United Kingdom - Deliveroo", "London; Remote (UK)".
    // Hyphens inside a name ("Tel Aviv-Yafo") are not separators; spaced ones are.
    private static readonly Regex Separators = new(
        @"[,;/|()\[\]&]| [-–—] | or | and ", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Every country any piece of this location text can mean. Empty when nothing is recognised.</summary>
    public static IReadOnlySet<string> CountriesOf(string? text)
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(text)) return result;

        foreach (var piece in Separators.Split(text).Append(text))
            if (Table.Value.TryGetValue(Key(piece), out var countries))
                result.UnionWith(countries);

        return result;
    }

    /// <summary>The one country a served term means, or null when it is not a place or is ambiguous.</summary>
    /// <remarks>
    /// Served side only. "UK", "Israel", "Tel Aviv" each serve their country;
    /// "London" (GB and CA) serves none -- otherwise a London user would switch
    /// on every Canadian posting. The term still serves its own text match, so
    /// a board that writes "London" is read either way.
    /// </remarks>
    public static string? CountryOfTerm(string term)
    {
        var countries = CountriesOf(term);
        return countries.Count == 1 ? countries.First() : null;
    }

    private static string Key(string piece) =>
        string.Join(' ', piece.Trim().ToLowerInvariant()
            .Replace('‘', '\'').Replace('’', '\'')
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));

    private static Dictionary<string, string[]> Load()
    {
        using var stream = typeof(Places).Assembly.GetManifestResourceStream("places.tsv")
            ?? throw new InvalidOperationException(
                "places.tsv is not embedded in the Greenhouse assembly. It is the pre-read filter's "
                + "place list; without it every city-only location would read as unknown.");
        using var reader = new StreamReader(stream);

        var table = new Dictionary<string, string[]>(StringComparer.Ordinal);
        while (reader.ReadLine() is { } line)
        {
            if (line.Length == 0 || line[0] == '#') continue;
            var tab = line.IndexOf('\t');
            if (tab <= 0) continue;
            table[line[..tab]] = line[(tab + 1)..].Split(',');
        }
        return table;
    }
}

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
