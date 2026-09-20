using ApplicationTracker.Core.Greenhouse;
using System.Net;
using System.Text.RegularExpressions;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// Turns a Greenhouse <c>content</c> field into the plain text that gets hashed,
/// stored and embedded.
/// </summary>
/// <remarks>
/// <para>
/// <b>The decode happens twice, and the order is not negotiable.</b> The field
/// arrives entity-encoded — <c>&amp;lt;p&amp;gt;</c> rather than <c>&lt;p&gt;</c>
/// — so a tag-stripping regex run against the raw field matches nothing and
/// returns the markup verbatim. First decode turns the entities into real tags;
/// the strip removes them; the second decode handles entities that were inside
/// the HTML (<c>&amp;amp;nbsp;</c> becomes <c>&amp;nbsp;</c> becomes a space).
/// </para>
/// <para>
/// Getting this wrong is silent and permanent rather than loud: the stored text
/// would be markup, the SHA-256 of that markup is perfectly stable, and every
/// later run would compare an unchanged hash and skip. The embedding would be
/// of HTML. Nothing throws, ever.
/// </para>
/// </remarks>
public static partial class ContentCleaner
{
    [GeneratedRegex(@"<(script|style)\b[^>]*>.*?</\1\s*>", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex ScriptOrStyle();

    // Block-level closers become newlines so the structure of a bullet list
    // survives as line breaks. Without this every requirement runs into the
    // next one as a single paragraph.
    [GeneratedRegex(@"<br\s*/?>|</p\s*>|</li\s*>|</h[1-6]\s*>|</div\s*>|</tr\s*>", RegexOptions.IgnoreCase)]
    private static partial Regex BlockBreak();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex AnyTag();

    [GeneratedRegex(@"[ \t ]+")]
    private static partial Regex Spaces();

    [GeneratedRegex(@"\n\s*\n\s*(\n\s*)+")]
    private static partial Regex BlankRuns();

    public static string Clean(string? content)
    {
        if (string.IsNullOrWhiteSpace(content)) return string.Empty;

        // Pass 1: &lt;h2&gt; -> <h2>. Everything below depends on this.
        var text = WebUtility.HtmlDecode(content);

        text = ScriptOrStyle().Replace(text, " ");
        text = BlockBreak().Replace(text, "\n");
        text = AnyTag().Replace(text, " ");

        // Pass 2: entities that lived inside the HTML rather than around it.
        text = WebUtility.HtmlDecode(text);

        // A non-breaking space is whitespace to a reader and a distinct
        // codepoint to SHA-256. Left in, a board that swaps one for a plain
        // space on a cosmetic edit re-embeds its entire posting list.
        text = text.Replace(' ', ' ');
        text = Spaces().Replace(text, " ");
        text = string.Join("\n", text.Split('\n').Select(l => l.Trim()));
        text = BlankRuns().Replace(text, "\n\n");

        return StripTrailingBoilerplate(text.Trim());
    }

    /// <summary>
    /// Headings that begin a trailing block of text about the company rather
    /// than about the job.
    /// </summary>
    /// <remarks>
    /// <b>Anchored to a heading on its own line, and only in the last third of
    /// the posting.</b> Both conditions are load-bearing. "Benefits" appears
    /// mid-posting in plenty of real listings, and an unanchored match would
    /// truncate a job description at its first mention of the word — removing
    /// requirements, which is precisely the signal this source exists to
    /// retrieve on.
    ///
    /// Conservative on purpose: leaving boilerplate in costs a few tokens and
    /// some retrieval noise, while cutting too early destroys the content. When
    /// in doubt this keeps the text.
    /// </remarks>
    private static readonly string[] BoilerplateHeadings =
    [
        "equal employment opportunity",
        "equal opportunity employer",
        "eeo statement",
        "eeoc statement",
        "e-verify",
        "americans with disabilities act",
        "pay transparency",
        "privacy notice",
        "privacy policy",
        "applicant privacy",
        "candidate privacy",
        "accommodations",
        "reasonable accommodation",
        "our commitment to diversity",
        "diversity, equity and inclusion",
        "diversity, equity & inclusion",
    ];

    private static string StripTrailingBoilerplate(string text)
    {
        if (text.Length == 0) return text;

        var lines = text.Split('\n');

        // Only the last third is eligible. A posting that opens with an EEO
        // statement keeps it; one that closes with three of them loses all
        // three, because the cut is at the FIRST eligible match.
        var earliest = (int)(lines.Length * 2L / 3);

        for (var i = earliest; i < lines.Length; i++)
        {
            var line = lines[i].Trim();

            // A heading, not a sentence. Real EEO sections are titled; a
            // requirement that happens to mention "accommodations" inside a
            // paragraph is not, and the length bound is what tells them apart.
            if (line.Length is 0 or > 80) continue;

            var normalized = line.ToLowerInvariant().TrimEnd(':', '.', '!', '*', ' ');
            if (!BoilerplateHeadings.Any(h => normalized.Contains(h))) continue;

            var kept = string.Join("\n", lines[..i]).TrimEnd();

            // Never let the strip gut the posting. If what remains is under a
            // quarter of what we had, the match was structural nonsense — a
            // board that formats the whole job as one block, say — and the
            // original is the safer answer.
            return kept.Length < text.Length / 4 ? text : kept;
        }

        return text;
    }
}
