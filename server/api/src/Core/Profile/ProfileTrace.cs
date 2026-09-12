namespace ApplicationTracker.Core.Profile;

// Does a claim trace back to something the candidate's profile actually says?
//
// Lifted out of ResumePackValidator, which has asked this question about
// résumé-pack skill items since the pack shipped, so the Evaluator's rationale
// check can ask it the same way rather than inventing a second answer. Both
// callers compare generated text against profile text; a claim that traces in
// one place must trace in the other.
public static class ProfileTrace
{
    // All comparisons run on normalized text. Generated output is expected to
    // differ from the profile in *representation* without differing in content:
    // prompts order ASCII punctuation ("plain hyphens, straight quotes") while
    // the profile stores real typography, so a date range held as "2023–2026"
    // comes back as "2023-2026" and an exact comparison calls it fabricated.
    // Every ExperienceTripleNotInProfile across 53 stored packs was that en-dash.
    //
    // Normalization is deliberately narrow — dash forms, quote forms, whitespace
    // runs, letter case. It never strips or trims words: dropping a qualifier
    // changes the claim, which is content.
    public static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";

        var sb = new System.Text.StringBuilder(value.Length);
        var pendingSpace = false;
        foreach (var ch in value)
        {
            var c = ch switch
            {
                // Hyphen/dash family: U+2010..U+2015, non-breaking hyphen, minus sign.
                '‐' or '‑' or '‒' or '–' or '—' or '―' or '−' => '-',
                // Curly apostrophes and quotes.
                '‘' or '’' or '‛' or 'ʼ' => '\'',
                '“' or '”' or '‟' => '"',
                _ => ch,
            };

            // Collapse any whitespace run to a single space: the rendered profile
            // hard-wraps, so a quoted source can carry newlines the original does
            // not. char.IsWhiteSpace covers NBSP (U+00A0) and friends.
            if (char.IsWhiteSpace(c))
            {
                pendingSpace = sb.Length > 0;
                continue;
            }
            if (pendingSpace) { sb.Append(' '); pendingSpace = false; }
            sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }

    // Splits on whitespace and grouping punctuation only — NOT on every symbol,
    // because "c#", ".net", "ci/cd" and "pl/sql" are single skills whose
    // punctuation is part of the name.
    private static readonly char[] TokenSeparators = [' ', '(', ')', '[', ']', ',', ';'];

    public static string[] Tokenize(string normalized) =>
        normalized.Split(TokenSeparators, StringSplitOptions.RemoveEmptyEntries);

    // Prepares one side of the comparison: the phrases a claim may trace to.
    public static List<string[]> ItemTokens(IEnumerable<string?> items) => items
        .Select(i => Tokenize(Normalize(i)))
        .Where(t => t.Length > 0)
        .ToList();

    // A claim traces when its tokens appear as a contiguous run inside some
    // source phrase's tokens. Token-level rather than raw substring, so
    // splitting "LLM integration (Anthropic API)" into "LLM integration" and
    // "Anthropic API" lets both trace, while "Go" does not falsely trace to
    // "Django".
    public static bool Traces(string? claim, List<string[]> sourceTokens)
    {
        var tokens = Tokenize(Normalize(claim));
        if (tokens.Length == 0) return false;

        foreach (var candidate in sourceTokens)
        {
            for (var start = 0; start + tokens.Length <= candidate.Length; start++)
            {
                var all = true;
                for (var i = 0; i < tokens.Length && all; i++)
                {
                    if (!string.Equals(candidate[start + i], tokens[i], StringComparison.Ordinal)) all = false;
                }
                if (all) return true;
            }
        }
        return false;
    }
}
