using System.Text.Json;
using System.Text.Json.Serialization;

namespace ApplicationTracker.Core.Matching;

// A posting's required technologies as REQUIREMENTS rather than names: each
// inner array is one requirement, satisfied by any one of its members.
//
// Why this exists: the facts extraction used to return one flat list, and a
// posting that asks for "Go, Ruby, or Python" and "PostgreSQL or MySQL" came
// back as five required technologies. Every consumer that counts -- the
// server's stackedGaps and the Core Stack cap -- then counted a Python +
// PostgreSQL candidate as missing three requirements the posting never made.
// Measured on Deliveroo's "Software Engineer": 6 of 8 "absent", cap fired,
// Technical 15/35, against a candidate who met every stated requirement.
public static class RequirementGroups
{
    // The groups a stored row or an API result carries, or -- for everything
    // extracted before groups existed -- each flat entry as a group of one,
    // which is exactly how those rows were counted before. Old rows are
    // therefore never counted differently than they were; they just do not
    // get the benefit until they are re-read.
    public static string[][] From(string[][]? groups, IEnumerable<string>? flat)
    {
        var cleaned = Clean(groups);
        if (cleaned.Length > 0) return cleaned;
        return Clean((flat ?? []).Select(t => new[] { t }).ToArray());
    }

    // Every name in every group, first-seen order, case-insensitively distinct:
    // the flat must_have_tech the candidate filter's $in reads.
    public static string[] Flatten(IEnumerable<string[]> groups) =>
        groups.SelectMany(g => g)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    // How a group is shown in a gap list: "Go / Ruby / Python" reads as the
    // alternatives the posting offered, not as three separate absences.
    public static string Label(string[] group) => string.Join(" / ", group);

    // Trims, drops blanks and empty groups, de-duplicates within a group, and
    // drops a group that repeats an earlier one exactly. A group is never
    // merged with another: two requirements that share a member are still two
    // requirements.
    public static string[][] Clean(string[][]? groups)
    {
        if (groups is null) return [];
        var result = new List<string[]>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var g in groups)
        {
            var members = (g ?? [])
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Select(t => t.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (members.Length == 0) continue;
            var key = string.Join("\u0001", members.Select(m => m.ToLowerInvariant()).Order());
            if (seen.Add(key)) result.Add(members);
        }
        return [.. result];
    }
}

// Model output is not trusted to have the declared shape. The prompt asks for
// an array of arrays; a model that answers ["Go", ["PostgreSQL","MySQL"]] has
// still said something usable, and a strict deserializer would throw -- which
// fails the whole chunk of fifty postings, not just the one. A bare string is
// read as a group of one; anything else that is not a string is skipped.
public sealed class RequirementGroupsJsonConverter : JsonConverter<string[][]>
{
    public override string[][] Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var doc = JsonDocument.ParseValue(ref reader);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];

        var groups = new List<string[]>();
        foreach (var item in doc.RootElement.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String)
                groups.Add([item.GetString()!]);
            else if (item.ValueKind == JsonValueKind.Array)
                groups.Add([.. item.EnumerateArray()
                    .Where(m => m.ValueKind == JsonValueKind.String)
                    .Select(m => m.GetString()!)]);
        }
        return [.. groups];
    }

    public override void Write(Utf8JsonWriter writer, string[][] value, JsonSerializerOptions options)
    {
        writer.WriteStartArray();
        foreach (var g in value)
        {
            writer.WriteStartArray();
            foreach (var m in g) writer.WriteStringValue(m);
            writer.WriteEndArray();
        }
        writer.WriteEndArray();
    }
}
