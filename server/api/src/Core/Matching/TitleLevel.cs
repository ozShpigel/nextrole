using System.Text.RegularExpressions;

namespace ApplicationTracker.Core.Matching;

/// <summary>
/// The Matches page's Seniority and AI-roles filters, read from the job title.
/// </summary>
/// <remarks>
/// <para>
/// From the title, not from <c>extracted.seniority</c>: the extraction's five
/// bands are LinkedIn's (entry level / associate / mid-senior level / director
/// / executive), and <c>mid-senior level</c> deliberately lumps a plain Senior
/// with Staff and Principal, so "Senior" and "Staff+" cannot be told apart from
/// it, and there is no band for an internship at all. The words that separate
/// them are in the title, where the company put them. Free, and right for every
/// stored posting at once, with no re-read.
/// </para>
/// <para>
/// <b>One level per title</b>, decided in <see cref="Ordered"/>'s order: the
/// first level whose words appear wins, so "Senior Staff Engineer" is Staff+,
/// not both. <see cref="Mid"/> is a title with none of the words. The known
/// weakness: a plain "Software Engineer" counts as Mid even when the posting
/// asks for eight years -- the title does not say, and this does not guess.
/// </para>
/// <para>
/// The Mongo filter (<c>GreenhouseJobRepository</c>) is built from these same
/// patterns, so <see cref="Of"/> -- what the tests pin -- is what the query does.
/// The patterns use only syntax .NET and MongoDB's PCRE read identically.
/// </para>
/// </remarks>
public static class TitleLevel
{
    public const string Intern = "intern";
    public const string Junior = "junior";
    public const string Mid = "mid";
    public const string Senior = "senior";
    public const string Staff = "staff";
    public const string Director = "director";

    /// <summary>Every level but <see cref="Mid"/>, in the order that decides a title's one level.</summary>
    /// <remarks>
    /// Intern first, so "Software Engineering Intern" is never Mid; Director
    /// before Staff, so "Head of Platform, Principal" is Director+; Staff
    /// before Senior, so "Senior Staff" is Staff+.
    /// </remarks>
    public static readonly IReadOnlyList<(string Level, string Pattern)> Ordered =
    [
        (Intern, @"\b(intern|interns|internship|student)\b"),
        (Director, @"\b(director|vp|vice president|head of|chief|cto|ciso|cpo|ceo|coo|cfo)\b"),
        (Staff, @"\b(staff|principal|distinguished|lead|leader|architect)\b"),
        (Senior, @"\b(senior|sr)\b"),
        (Junior, @"\b(junior|jr|associate|graduate|new grad|entry level|entry-level)\b"),
    ];

    /// <summary>The levels a client may ask for. Anything else is ignored.</summary>
    public static readonly IReadOnlySet<string> All =
        new HashSet<string>([.. Ordered.Select(o => o.Level), Mid], StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// AI work named in the title. Data Scientist and Data Engineer are left
    /// out: much of that work is analytics or pipelines, not AI.
    /// </summary>
    public const string AiPattern =
        @"\b(ai|a\.i\.|ml|llm|llms|genai|gen ai|generative|machine learning|deep learning|nlp|computer vision|applied scientist|research scientist|mlops)\b";

    /// <summary>This title's one level.</summary>
    public static string Of(string? title)
    {
        foreach (var (level, pattern) in Ordered)
            if (Matches(title, pattern)) return level;
        return Mid;
    }

    public static bool IsAiRole(string? title) => Matches(title, AiPattern);

    private static bool Matches(string? title, string pattern) =>
        !string.IsNullOrEmpty(title) && Regex.IsMatch(title, pattern, RegexOptions.IgnoreCase);
}
