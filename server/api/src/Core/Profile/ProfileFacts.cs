using System.Text.RegularExpressions;

namespace ApplicationTracker.Core.Profile;

// Figures the résumé may state that are NOT quotable from the profile text,
// because they are computed rather than written down.
//
// The verbatim-figure rule (ResumePackValidator) exists because a model that
// does arithmetic on a CV invents facts. But "N years of experience" is a real,
// checkable number that no candidate should have to type as a literal string
// into their profile — it goes stale the moment the year turns, and a shared
// demo persona would carry whatever number was hardcoded when it was seeded.
//
// So the number is derived here, injected into the prompt as a given fact the
// model may quote, and accepted by the validator as a legal source alongside
// the profile text. Deliberately ONE derived figure: every additional one is
// another thing that can be silently wrong in a document about someone's career.
public sealed record ProfileFacts
{
    // Null when no experience entry carries a parseable year — in that case the
    // prompt gets no fact and the model has nothing extra to quote.
    public int? YearsOfExperience { get; init; }

    private static readonly Regex YearPattern =
        new(@"\b(19|20)\d{2}\b", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static ProfileFacts From(StructuredProfile profile, DateOnly today)
    {
        int? earliest = null;
        foreach (var entry in profile.Experience)
        {
            foreach (Match m in YearPattern.Matches(entry.Dates ?? ""))
            {
                if (!int.TryParse(m.Value, out var year)) continue;
                // Ignore anything that can't be an employment start.
                if (year < 1950 || year > today.Year) continue;
                if (earliest is null || year < earliest) earliest = year;
            }
        }

        return new ProfileFacts { YearsOfExperience = ElapsedYears(earliest, today) };
    }

    // Elapsed years from the earliest employment start, not the sum of the
    // entries: no gap logic, and it matches what a résumé means by "years of
    // experience".
    //
    // Profile dates carry a year but no month, so the start could be anywhere in
    // that year. We take the LATEST possible start — 31 December — which is the
    // only choice that cannot overstate the candidate. Someone who started in
    // 2011, read on 2026-09-10, gets 14 rather than 15: 15 would be a claim the
    // data does not support if they actually started that November.
    private static int? ElapsedYears(int? startYear, DateOnly today)
    {
        if (startYear is not { } year) return null;

        var latestPossibleStart = new DateOnly(year, 12, 31);
        var elapsed = today.Year - latestPossibleStart.Year;
        if (today < latestPossibleStart.AddYears(elapsed)) elapsed--;
        return elapsed > 0 ? elapsed : null;
    }

    // Rendered into the system prompt so the model can quote it. Empty when
    // nothing could be derived, so no section is added.
    public string ToPromptBlock() =>
        YearsOfExperience is { } years
            ? $"yearsOfExperience: {years}"
            : "";

    // The figure strings the validator accepts as grounded on top of the profile
    // text. Bare digits only — "14" backs "14 years", while "14+" remains an
    // embellishment the profile does not support.
    public IReadOnlyCollection<string> Figures =>
        YearsOfExperience is { } years ? [years.ToString()] : [];
}
