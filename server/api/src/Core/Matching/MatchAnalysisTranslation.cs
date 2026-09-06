using System.Text.Json;
using System.Text.Json.Nodes;

namespace ApplicationTracker.Core.Matching;

// Validates a Hebrew translation of a stored MatchAnalysis JSON blob (see
// MatchResponse) against the original English JSON it was translated from.
// The translation call (IClaudeClient.TranslateMatchAnalysisAsync) is trusted
// for nothing beyond "plausible JSON" — this is the actual gate that decides
// whether a translation is safe to store/serve. Never call the two-string
// overload with an untrusted original; both inputs are assumed to already be
// server-generated JSON (the stored MatchAnalysis and the model's response).
public static class MatchAnalysisTranslation
{
    // These keys must come back byte-identical, at any nesting depth, even
    // though several of them (filter, verdict, name) are JSON strings a naive
    // "translate every string" pass would otherwise touch:
    //   - filter: HardBlocker.Filter — fixed vocabulary, validated server-side
    //     against an enum-like set elsewhere (JobMatchService).
    //   - verdict: MatchResponse.Verdict — one of a fixed set of bands.
    //   - name: ScoreComponent.Name — not a C# enum, but effectively fixed
    //     vocabulary in practice: PromptSeeds.Evaluator hardcodes the six
    //     component names verbatim ("Core Stack", "System Design", "Role
    //     Clarity & Ownership", "Engineering Maturity & Stability", "Pace &
    //     Workload", "Long-term Risk") and instructs the model to keep them in
    //     English; JobMatchService.EnforceStackedGapsCap/EnforceReviewCaps
    //     both match against these exact English strings. A translated Name
    //     would silently break nothing in THIS request (Correct() already ran
    //     on the English original before this translation ever happens), but
    //     there is no reason to let a second, translated copy of the same
    //     document drift from the vocabulary the rest of the system assumes.
    //   - score, maxScore, base, delta, overallScore, shouldApply: numbers/
    //     booleans, already covered by the generic numeric/boolean rule below;
    //     listed here too so the contract is explicit and self-documenting.
    public static readonly IReadOnlyCollection<string> UntranslatedKeys = new HashSet<string>(StringComparer.Ordinal)
    {
        "filter", "verdict", "name",
        "score", "maxScore", "base", "delta", "overallScore", "shouldApply",
    };

    // A translation is valid only if:
    //  - the key sets match exactly, at every level of nesting
    //  - every array has the same length
    //  - every number and boolean is identical
    //  - every value under UntranslatedKeys is identical
    // Anything else (a free-text string not in UntranslatedKeys) may differ.
    public static bool Validate(string originalJson, string translatedJson, out string? error)
    {
        JsonNode? original;
        JsonNode? translated;
        try
        {
            original = JsonNode.Parse(originalJson);
        }
        catch (JsonException ex)
        {
            error = $"original JSON failed to parse: {ex.Message}";
            return false;
        }
        try
        {
            translated = JsonNode.Parse(translatedJson);
        }
        catch (JsonException ex)
        {
            error = $"translated JSON failed to parse: {ex.Message}";
            return false;
        }

        return ValidateNode(original, translated, "$", out error);
    }

    private static bool ValidateNode(JsonNode? original, JsonNode? translated, string path, out string? error)
    {
        error = null;
        var originalKind = original?.GetValueKind() ?? JsonValueKind.Null;
        var translatedKind = translated?.GetValueKind() ?? JsonValueKind.Null;
        if (originalKind != translatedKind)
        {
            error = $"{path}: type mismatch ({originalKind} vs {translatedKind})";
            return false;
        }

        switch (originalKind)
        {
            case JsonValueKind.Object:
                var originalObj = (JsonObject)original!;
                var translatedObj = (JsonObject)translated!;
                var originalKeys = originalObj.Select(kv => kv.Key).ToHashSet(StringComparer.Ordinal);
                var translatedKeys = translatedObj.Select(kv => kv.Key).ToHashSet(StringComparer.Ordinal);
                if (!originalKeys.SetEquals(translatedKeys))
                {
                    error = $"{path}: key set mismatch (expected [{string.Join(", ", originalKeys)}], got [{string.Join(", ", translatedKeys)}])";
                    return false;
                }

                foreach (var key in originalKeys)
                {
                    var childPath = $"{path}.{key}";
                    if (UntranslatedKeys.Contains(key))
                    {
                        if (originalObj[key]?.ToJsonString() != translatedObj[key]?.ToJsonString())
                        {
                            error = $"{childPath}: must be byte-identical (untranslated key)";
                            return false;
                        }
                        continue;
                    }
                    if (!ValidateNode(originalObj[key], translatedObj[key], childPath, out error))
                        return false;
                }
                return true;

            case JsonValueKind.Array:
                var originalArr = (JsonArray)original!;
                var translatedArr = (JsonArray)translated!;
                if (originalArr.Count != translatedArr.Count)
                {
                    error = $"{path}: array length mismatch ({originalArr.Count} vs {translatedArr.Count})";
                    return false;
                }
                for (var i = 0; i < originalArr.Count; i++)
                {
                    if (!ValidateNode(originalArr[i], translatedArr[i], $"{path}[{i}]", out error))
                        return false;
                }
                return true;

            case JsonValueKind.Number:
                // Compared as values, not raw text — the model echoing a
                // number back as "20.0" instead of "20" is still the same
                // number and must not fail validation over formatting.
                var originalNumber = original!.GetValue<double>();
                var translatedNumber = translated!.GetValue<double>();
                if (originalNumber != translatedNumber)
                {
                    error = $"{path}: number value changed ({originalNumber} -> {translatedNumber})";
                    return false;
                }
                error = null;
                return true;

            // True/False: the kind itself already fully encodes the value —
            // both sides matched Kind above, so there is nothing left to compare.
            //
            // String: free to differ (translated free text) — already
            // type-checked above, and any string under an UntranslatedKeys
            // key was already required to be byte-identical by the caller.
            //
            // Null: both sides already confirmed Null above.
            case JsonValueKind.True:
            case JsonValueKind.False:
            case JsonValueKind.String:
            case JsonValueKind.Null:
            default:
                error = null;
                return true;
        }
    }
}
