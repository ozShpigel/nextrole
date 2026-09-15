using System.Security.Cryptography;
using System.Text;

namespace ApplicationTracker.Core.Matching;

/// <summary>
/// The stamp stored beside a cached <see cref="ParsedJob"/>, identifying what
/// produced it.
/// </summary>
/// <remarks>
/// <para>
/// A hash of the real inputs rather than a hand-maintained integer, because a
/// version someone has to remember to bump is a version that silently stops
/// matching what shipped. Edit the Analyst prompt, change the model, change the
/// temperature, and the stamp changes on its own — there is no step to forget.
/// </para>
/// <para>
/// <see cref="SchemaMarker"/> is the one piece that IS hand-maintained, and only
/// for a change the prompt text cannot express: a new field on
/// <see cref="ParsedJob"/> that the prompt already happened to produce, or a
/// change to how a stored parse is interpreted downstream. Bump it then, and
/// only then.
/// </para>
/// <para>
/// A changed stamp marks a stored parse STALE, not wrong. Nothing re-parses on
/// sight of one: a prompt edit would otherwise turn into an immediate re-parse
/// of the whole pool, which is $0.41 at ninety jobs and eleven dollars at the
/// steady-state size the pool is heading for. Staleness drains through the
/// ingest backfill instead.
/// </para>
/// </remarks>
public static class ParseVersioning
{
    // Bump ONLY for a change the prompt text does not express. See remarks.
    private const string SchemaMarker = "v1";

    public static string Compute(string analystPrompt, string model, decimal temperature)
    {
        var material = $"{SchemaMarker}|{model}|{temperature}|{analystPrompt}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return Convert.ToHexString(hash)[..12].ToLowerInvariant();
    }
}
