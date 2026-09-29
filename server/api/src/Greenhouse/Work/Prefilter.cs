using System.Text.RegularExpressions;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Infrastructure.Greenhouse;

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
    public const string Age = "age";
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

    // Words where Claude's own label is split, so no guess is safe: the
    // posting is read. Measured on the box (2026-09-26, 121 postings checked
    // against Claude's labels): "Senior Financial Crime Investigator" was
    // guessed operations and labelled security -- a function infra users
    // accept, so On would have hidden it; and three "Product Marketing"
    // roles were labelled product, not marketing. Fraud, risk and compliance
    // sit next to security the same way. Abstaining is the cheap side of the
    // two errors: a wrong read costs cents, a wrong skip loses a job.
    private static readonly Regex Ambiguous = Words(
        "financial crime", "fincrime", "fraud", "aml", "anti-money laundering", "risk", "compliance",
        "trust", "safety", "investigator", "investigations", "product marketing");

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
            "attorney", "lawyer", "finance", "accountant", "accounting", "controller", "payroll",
            "tax", "treasury", "fp&a", "office manager", "executive assistant", "workplace", "facilities",
            "procurement", "administrative", "receptionist")),
    ];

    // Hardware work, by words that name it plainly (docs/plans/hardware-
    // engineering-function.md). Chosen from KLA's and NVIDIA's real titles:
    // "Senior Package Layout Engineer", "Senior Opto-Mechanical Engineer",
    // "Physical Design STA Engineer", "Senior IC Failure Analysis Engineer".
    // No "soc": in a security title it is the Security Operations Center, and
    // "SOC Analyst" was skipped as hardware (measured 2026-09-29). A chip SoC
    // title carries another word here ("SoC Physical Design", "ASIC").
    private static readonly Regex Hardware = Words(
        "hardware", "mechanical", "electrical", "electronics", "electronic", "optics", "optical", "opto",
        "photonics", "laser", "rf", "analog", "pcb", "board design", "layout", "vlsi", "asic", "rtl", "dft",
        "sta", "physical design", "chip design", "chip", "silicon", "post-silicon", "thermal",
        "technician", "practical engineer", "physicist", "failure analysis", "signal integrity",
        "power integrity", "interposer", "packaging", "npi");

    // Any of these and a hardware word is not enough: software written for
    // hardware is software ("Senior Software Engineer, Chip Design", "Senior
    // Firmware Engineer - NVLink Switch", "Linux Driver Developer"), and a
    // security or AI title is read however hardware it sounds. So are IT
    // support ("Help Desk Technician", "End User Support Technician") and
    // quality ("Senior NPI Hardware Quality Engineer", which Claude files as
    // qa) -- each measured as a wrong hardware guess on 2026-09-29.
    private static readonly Regex SoftwareForHardware = Words(
        "software", "firmware", "embedded", "developer", "programmer", "sdk", "driver", "drivers", "devops",
        "sre", "site reliability", "cloud", "platform", "data", "machine learning", "ml", "ai", "algorithm",
        "algorithms", "security", "linux", "kubernetes", "backend", "frontend", "full stack", "web", "mobile",
        "qa", "quality", "help desk", "service desk", "desktop support", "it support", "end user support");

    /// <summary>
    /// Whether a title plainly names hardware work -- a hardware word, and no
    /// word that makes it software written for hardware.
    /// </summary>
    public static bool IsHardwareTitle(string? title)
    {
        var t = title ?? "";
        return Hardware.IsMatch(t) && !SoftwareForHardware.IsMatch(t) && !Ambiguous.IsMatch(t);
    }

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
    /// <param name="hardwareTitles">
    /// Guess <c>hardware_engineering</c> from the title. Off, a technical word
    /// always means read -- which is every hardware title ("Mechanical Engineer").
    /// </param>
    public static string? GuessFunction(
        string? title, IEnumerable<string?>? departments, bool hardwareTitles = false)
    {
        var t = title ?? "";
        if (Ambiguous.IsMatch(t)) return null;

        // The one guess a technical word does not stop: hardware is the kind of
        // work whose titles are full of them.
        var hardware = hardwareTitles && IsHardwareTitle(t);
        if (Technical.IsMatch(t)) return hardware ? JobFunctions.HardwareEngineering : null;

        // The plain title rules first, so "HR Business Partner, Hardware" is
        // operations, not hardware.
        var byTitle = FirstMatch(TitleRules, t);
        if (byTitle is not null) return byTitle;
        if (hardware) return JobFunctions.HardwareEngineering;

        // The title said nothing either way ("Manager, EMEA"): the department
        // decides, but only a department with no technical or ambiguous word
        // in it -- a "Data & Engineering" or "Risk & Compliance" department is
        // read however its title reads.
        var guesses = (departments ?? [])
            .Where(d => !string.IsNullOrWhiteSpace(d) && !Technical.IsMatch(d!) && !Ambiguous.IsMatch(d!))
            .Select(d => FirstMatch(DepartmentRules, d!))
            .Distinct()
            .ToList();

        // Two departments saying two different things is not clear.
        return guesses.Count == 1 ? guesses[0] : null;
    }

    /// <summary>
    /// Whether a posting could be somewhere the product serves -- false only
    /// when its location is CLEARLY elsewhere.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The same shape as the function rule: skip only on a clear answer. A
    /// posting passes when any location text names a served term (whole words,
    /// so "UK" does not match "Ukraine"), or when it resolves to a served
    /// country (<see cref="Places"/>: "Munich" is Germany), or when it resolves
    /// to nothing at all ("Hybrid", "HQ", a town not in the list). Only text
    /// that resolves, and only to countries nobody is in, is skipped.
    /// </para>
    /// <para>
    /// No served terms, or no location text at all, is a pass.
    /// </para>
    /// </remarks>
    public static bool InServedLocation(IEnumerable<string?> locationTexts, ServedPlaces served) =>
        LocationSkip(locationTexts, served) is null;

    /// <inheritdoc cref="InServedLocation(IEnumerable{string?}, ServedPlaces)"/>
    public static bool InServedLocation(IEnumerable<string?> locationTexts, IReadOnlyList<string> served) =>
        InServedLocation(locationTexts, ServedPlaces.From(served));

    /// <summary>The countries a clearly-elsewhere location resolved to, or null to read it.</summary>
    public static IReadOnlySet<string>? LocationSkip(IEnumerable<string?> locationTexts, ServedPlaces served)
    {
        if (served.IsEmpty) return null;

        var texts = locationTexts.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t!).ToList();
        if (texts.Count == 0) return null;

        // The static IsMatch goes through Regex's own cache: one parse per
        // served list, not one per posting.
        var pattern = WordsPattern(served.Terms);
        if (texts.Any(t => Regex.IsMatch(t, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)))
            return null;

        var countries = texts.SelectMany(Places.CountriesOf).ToHashSet(StringComparer.Ordinal);
        if (countries.Count == 0) return null;                       // unknown: read it
        return countries.Overlaps(served.Countries) ? null : countries;
    }

    /// <summary>Why this posting need not be read, or null to read it.</summary>
    /// <param name="accepted">
    /// The functions users accept (their own, widened by neighbours). Null means
    /// no user has recorded any, and then nothing is skipped by function.
    /// </param>
    /// <param name="hardwareTitles">Skip by a hardware title guess (<see cref="GuessFunction"/>).</param>
    public static PrefilterSkip? Decide(
        ListedPosting job, ServedPlaces served, IReadOnlyCollection<string>? accepted, DateTime? now = null,
        bool hardwareTitles = false)
    {
        // Older than Matches ever shows ("Any" is three months), by the
        // posting's own date -- the same rule and the same limit as the board
        // (PoolBrowseQuery.MaxAgeDays), so nothing that could be shown is
        // skipped. A posting with no date is read, as it would be shown.
        if (PostedAt(job) is { } posted
            && posted < (now ?? DateTime.UtcNow).AddDays(-PoolBrowseQuery.MaxAgeDays))
            return new PrefilterSkip(PrefilterSkip.Age, posted.ToString("yyyy-MM-dd"));

        var locations = new[] { job.Location }.Concat(job.Offices);
        if (LocationSkip(locations, served) is { } elsewhere)
            return new PrefilterSkip(PrefilterSkip.Location,
                $"{job.Location} ({string.Join(",", elsewhere.Order())})");

        if (accepted is null || accepted.Count == 0) return null;

        var guess = GuessFunction(job.Title, job.Departments, hardwareTitles);
        return guess is not null && !accepted.Contains(guess)
            ? new PrefilterSkip(PrefilterSkip.Function, guess)
            : null;
    }

    /// <inheritdoc cref="Decide(ListedPosting, ServedPlaces, IReadOnlyCollection{string}?, DateTime?, bool)"/>
    public static PrefilterSkip? Decide(
        ListedPosting job, IReadOnlyList<string> servedLocations, IReadOnlyCollection<string>? accepted) =>
        Decide(job, ServedPlaces.From(servedLocations), accepted);

    /// <summary>
    /// When the posting went up: its own posted date, the board's update date
    /// only when there is none, null when neither is given.
    /// </summary>
    public static DateTime? PostedAt(ListedPosting job) => job.PostedAt ?? job.UpdatedAt;

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
