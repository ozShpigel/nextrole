using System.Text.RegularExpressions;
using ApplicationTracker.Core.Matching;

namespace ApplicationTracker.Greenhouse;

/// <summary>Whether the pre-read filter runs, and whether it acts.</summary>
public enum PrefilterMode
{
    /// <summary>Not evaluated at all.</summary>
    Off,
    /// <summary>Evaluated and logged; nothing is skipped. The default.</summary>
    Log,
    /// <summary>New postings it rules out are neither embedded, read nor stored.</summary>
    On,
}

/// <param name="Reason"><c>location</c> or <c>function</c>.</param>
/// <param name="Detail">The location text, or the function the title/department was taken for.</param>
public sealed record PrefilterSkip(string Reason, string Detail)
{
    public const string Location = "location";
    public const string Function = "function";
}

/// <summary>
/// Which NEW postings are not worth paying for, decided from what the board
/// returns for free: the title, the location, the departments and offices.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why.</b> Every posting on every board was read by Claude (facts + parse),
/// embedded and stored -- an Account Executive in Tokyo included -- and the
/// Matches filters then hid it from everyone. The reads are the ingest's cost,
/// and they scale with how many companies are listed, not with who uses the
/// product.
/// </para>
/// <para>
/// <b>Knowingly inexact, so it leans hard towards reading.</b> A title keyword
/// is exactly the weak proxy <see cref="JobFunctions"/> refuses to use as a
/// check. Here it only decides whether a read is paid for, and every rule is
/// one-sided: a posting is skipped only when it CLEARLY belongs elsewhere. Any
/// technical word in the title, an empty location, an unrecognised department
/// -- all read. A wrong guess must cost an extra read, never a lost job.
/// </para>
/// <para>
/// <b>Measured before it acts.</b> It ships in <see cref="PrefilterMode.Log"/>:
/// the handler logs what it would skip, and checks its function guesses against
/// the labels Claude already put on stored postings. Only after that log has
/// been read is it switched on.
/// </para>
/// <para>
/// <b>Nothing is lost for good.</b> A skipped posting is not stored, so every
/// run sees it as new and asks again. When a user arrives wanting its function,
/// the next run reads it -- no backfill.
/// </para>
/// </remarks>
public static class Prefilter
{
    // Any of these in a title and the function is not guessed: the posting is
    // read. "Technical Recruiter", "Sales Engineer", "Marketing Analyst" and
    // "Finance Data Engineer" all land here on purpose.
    private static readonly Regex Technical = Words(
        "engineer", "engineering", "developer", "programmer", "architect", "devops", "sre",
        "site reliability", "data", "scientist", "analyst", "analytics", "security", "qa",
        "quality", "test", "tester", "machine learning", "ml", "ai", "platform", "infrastructure",
        "software", "technical", "technology", "it", "systems", "cloud", "network", "research");

    // Checked in order; the first match wins. Design first, so "Product
    // Designer" and "Brand Designer" are design; marketing before product, so
    // "Product Marketing Manager" is marketing; product before operations, so
    // "Group Product Manager, Regulatory Finance" is product (measured: it was
    // taken for finance on a real board). Not "development" as a
    // technical word -- it would turn every Business Development role into a
    // read -- and not "revenue" as sales: a Revenue Accountant is finance.
    private static readonly (string Function, Regex Pattern)[] TitleRules =
    [
        (JobFunctions.Design, Words("designer")),
        (JobFunctions.Sales, Words(
            "sales", "account executive", "business development", "bdr", "sdr", "account manager",
            "partnerships")),
        (JobFunctions.Marketing, Words(
            "marketing", "brand", "communications", "copywriter", "seo", "social media",
            "public relations", "events")),
        (JobFunctions.CustomerSuccess, Words(
            "customer success", "customer support", "customer service", "customer experience",
            "support specialist", "support agent", "support representative")),
        (JobFunctions.Product, Words("product manager", "product owner", "product lead", "head of product")),
        (JobFunctions.Operations, Words(
            "recruiter", "recruiting", "recruitment", "talent acquisition", "talent partner", "sourcer",
            "people partner", "people operations", "hr", "human resources", "legal", "counsel", "paralegal",
            "attorney", "lawyer", "finance", "financial", "accountant", "accounting", "controller", "payroll",
            "tax", "treasury", "fp&a", "office manager", "executive assistant", "workplace", "facilities",
            "procurement", "administrative", "receptionist")),
    ];

    // Department names are team labels, not job titles -- "People", "G&A",
    // "Go To Market" -- so they get a few extra words. Only consulted when the
    // title gave no answer and had no technical word in it.
    private static readonly (string Function, Regex Pattern)[] DepartmentRules =
    [
        .. TitleRules,
        (JobFunctions.Sales, Words("go to market", "go-to-market", "gtm")),
        (JobFunctions.Operations, Words("people", "talent", "g&a", "general and administrative")),
    ];

    /// <summary>
    /// The function a posting clearly belongs to, or null when it is not clear.
    /// </summary>
    public static string? GuessFunction(string? title, IEnumerable<string?>? departments)
    {
        var t = title ?? "";
        if (Technical.IsMatch(t)) return null;

        var byTitle = FirstMatch(TitleRules, t);
        if (byTitle is not null) return byTitle;

        // The title said nothing either way ("Manager, EMEA"): the department
        // decides, but only a department with no technical word in it -- a
        // "Data & Engineering" department is read however its title reads.
        var guesses = (departments ?? [])
            .Where(d => !string.IsNullOrWhiteSpace(d) && !Technical.IsMatch(d!))
            .Select(d => FirstMatch(DepartmentRules, d!))
            .Distinct()
            .ToList();

        // Two departments saying two different things is not clear.
        return guesses.Count == 1 ? guesses[0] : null;
    }

    /// <summary>Whether any of the posting's location texts names a served location.</summary>
    /// <remarks>
    /// Whole words, case-insensitive: "UK" must not match "Ukraine". No served
    /// locations configured, or no location text at all, is a pass.
    /// </remarks>
    public static bool InServedLocation(IEnumerable<string?> locationTexts, IReadOnlyList<string> served)
    {
        if (served.Count == 0) return true;

        var texts = locationTexts.Where(t => !string.IsNullOrWhiteSpace(t)).ToList();
        if (texts.Count == 0) return true;

        // The static IsMatch goes through Regex's own cache: one parse per
        // served list, not one per posting.
        var pattern = WordsPattern(served);
        return texts.Any(t => Regex.IsMatch(t!, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant));
    }

    /// <summary>Why this posting need not be read, or null to read it.</summary>
    /// <param name="accepted">
    /// The functions users accept (their own, widened by neighbours). Null means
    /// no user has recorded any, and then nothing is skipped by function.
    /// </param>
    public static PrefilterSkip? Decide(
        BoardJob job, IReadOnlyList<string> servedLocations, IReadOnlyCollection<string>? accepted)
    {
        var locations = new[] { job.Location?.Name }
            .Concat((job.Offices ?? []).Select(o => o.Name));
        if (!InServedLocation(locations, servedLocations))
            return new PrefilterSkip(PrefilterSkip.Location, job.Location?.Name ?? "");

        if (accepted is null || accepted.Count == 0) return null;

        var guess = GuessFunction(job.Title, (job.Departments ?? []).Select(d => d.Name));
        return guess is not null && !accepted.Contains(guess)
            ? new PrefilterSkip(PrefilterSkip.Function, guess)
            : null;
    }

    /// <summary>Every function the given ones accept, neighbours included.</summary>
    /// <remarks>
    /// Per function, then unioned: each user's own list is widened by
    /// <see cref="JobFunctions.AcceptedFor"/>, so the union over the functions
    /// they hold is what all of them together accept.
    /// </remarks>
    public static IReadOnlyCollection<string> Accepted(IEnumerable<string> wanted) =>
        wanted.SelectMany(f => JobFunctions.AcceptedFor([f])).ToHashSet(StringComparer.Ordinal);

    private static string? FirstMatch((string Function, Regex Pattern)[] rules, string text) =>
        rules.FirstOrDefault(r => r.Pattern.IsMatch(text)).Function;

    // Whole words or phrases. A lookaround rather than \b, because \b is
    // meaningless next to "&" ("fp&a", "g&a").
    private static Regex Words(params string[] words) =>
        new(WordsPattern(words), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static string WordsPattern(IEnumerable<string> words) =>
        $@"(?<![\p{{L}}\p{{N}}])(?:{string.Join("|", words.Select(w => Regex.Escape(w.Trim())))})(?![\p{{L}}\p{{N}}])";
}
