using System.Text.RegularExpressions;

namespace ApplicationTracker.Infrastructure.Greenhouse;

/// <summary>
/// Place name -> the countries it can mean, from GeoNames (cities over 15,000
/// people, countries and their ISO codes, common aliases, US and Canadian
/// states). Offline, no AI. Shared by the ingest's pre-read filter and
/// Matches' location rule (<see cref="GreenhouseJobRepository.MatchesLocation"/>).
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

    /// <summary>
    /// The countries a candidate's own location means: the ones it names
    /// unambiguously when there are any, otherwise everything it can mean.
    /// </summary>
    /// <remarks>
    /// "London, UK" is GB, not GB and Canada: the profile said which London.
    /// A bare "London" is both -- the one reading that cannot hide a UK job.
    /// Prose ("Open to relocation to London, UK") resolves by its pieces, and
    /// the pieces that are not places resolve to nothing. Empty when nothing
    /// is recognised.
    /// </remarks>
    public static IReadOnlySet<string> CountriesOfProfile(string? location) => NamedFirst(location);

    /// <summary>
    /// The countries a posting's location means, each place in its list read
    /// the way a profile is (<see cref="CountriesOfProfile"/>), then unioned.
    /// </summary>
    /// <remarks>
    /// Not <see cref="CountriesOf"/>'s plain union: "Birmingham, Alabama, United
    /// States" would be GB and US there -- England has a Birmingham -- and
    /// Matches would score a US posting for every UK candidate. Per place,
    /// because a posting lists several: "Germany; London (hybrid)" is Germany,
    /// and London too. Empty when nothing is recognised.
    /// </remarks>
    public static IReadOnlySet<string> CountriesOfPosting(string? location)
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(location)) return result;

        foreach (var place in PlaceList.Split(location))
            result.UnionWith(NamedFirst(place));
        return result;
    }

    // What separates the places in a posting's list: "Amsterdam, Netherlands;
    // London, United Kingdom", "London | Remote". Commas separate the parts of
    // ONE place ("Birmingham, Alabama, United States"), so they are not here.
    private static readonly Regex PlaceList = new(@"[;|]", RegexOptions.Compiled);

    // The countries one place means. In order: the ones its parts name
    // unambiguously; else the ones every part agrees on -- the parts of one
    // place describe the same place, so "Rochester, MN" (GB/US, US/Mongolia)
    // is the US; else everything any part can mean.
    private static HashSet<string> NamedFirst(string? text)
    {
        var all = new HashSet<string>(StringComparer.Ordinal);
        var named = new HashSet<string>(StringComparer.Ordinal);
        HashSet<string>? agreed = null;
        if (string.IsNullOrWhiteSpace(text)) return all;

        foreach (var piece in Separators.Split(text).Append(text))
        {
            if (!Table.Value.TryGetValue(Key(piece), out var countries)) continue;
            all.UnionWith(countries);
            if (countries.Length == 1) named.Add(countries[0]);
            if (agreed is null) agreed = new HashSet<string>(countries, StringComparer.Ordinal);
            else agreed.IntersectWith(countries);
        }
        if (named.Count > 0) return named;
        return agreed is { Count: > 0 } ? agreed : all;
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
