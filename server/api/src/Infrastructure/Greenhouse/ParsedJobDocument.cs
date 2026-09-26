using System.Text.Json;
using ApplicationTracker.Core.Matching;
using MongoDB.Bson;

namespace ApplicationTracker.Infrastructure.Greenhouse;

/// <summary>
/// A stored parse (<c>parsed</c> on a posting) to and from <see cref="ParsedJob"/>,
/// in the one shape every writer uses: the API's camelCase JSON.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why it exists.</b> The ingest stores the job-parse endpoint's JSON as is
/// -- <c>jobTitle</c>, <c>requiredSkills</c> -- and the Greenhouse reader used
/// <c>BsonSerializer.Deserialize&lt;ParsedJob&gt;</c>, whose default class map
/// expects <c>JobTitle</c>. Every read threw, the catch returned null, and the
/// scan parsed inline: measured on 20 stored parses, 0 were read back. Every
/// ingest parse was paid for and never used, and every user re-parsed every
/// posting they scored. Nothing failed loudly, because null is the documented
/// "parse it inline" answer.
/// </para>
/// <para>
/// Reading goes through JSON, case-insensitive -- the way the LinkedIn pool's
/// reader always did -- and a parse saved while scoring is written as the same
/// camelCase JSON, so both writers produce one shape and one reader reads it.
/// </para>
/// </remarks>
public static class ParsedJobDocument
{
    private static readonly JsonSerializerOptions Read = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions Write = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    /// <summary>The stored parse, or null when it cannot be read -- which the scan treats as "parse inline".</summary>
    public static ParsedJob? From(BsonDocument doc)
    {
        try
        {
            return JsonSerializer.Deserialize<ParsedJob>(doc.ToJson(), Read);
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>A parse as the ingest stores one.</summary>
    public static BsonDocument To(ParsedJob parsed) =>
        BsonDocument.Parse(JsonSerializer.Serialize(parsed, Write));
}
