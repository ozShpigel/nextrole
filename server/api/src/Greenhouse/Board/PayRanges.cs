using System.Net;
using System.Text.RegularExpressions;
using ApplicationTracker.Core.Matching;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// A job's published pay ranges → one annual range, or null.
/// </summary>
/// <remarks>
/// <para>
/// Greenhouse gives amounts in cents with no interval, so an hourly range and
/// an annual one look alike. Two exact checks tell them apart: a range whose
/// title or blurb says "hour"/"hourly" is dropped, and whatever survives must
/// clear <see cref="SalaryBounds"/>'s annual floor -- $30/hour is 3,000 cents,
/// four orders of magnitude under it.
/// </para>
/// <para>
/// Several ranges (US zones, levels) in one currency merge into their overall
/// low and high. A job publishing in more than one currency keeps the first
/// currency's ranges: the board lists the primary one first.
/// </para>
/// </remarks>
public static partial class PayRanges
{
    public static SalaryRange? Annual(IReadOnlyList<BoardPayRange>? ranges)
    {
        if (ranges is null || ranges.Count == 0) return null;

        var usable = ranges
            .Where(r => r.MinCents > 0 && r.MaxCents >= r.MinCents && !string.IsNullOrWhiteSpace(r.CurrencyType))
            .Where(r => !MentionsHourly(r.Title) && !MentionsHourly(r.Blurb))
            .ToList();
        if (usable.Count == 0) return null;

        var currency = usable[0].CurrencyType!.Trim().ToUpperInvariant();
        var same = usable.Where(r => string.Equals(r.CurrencyType!.Trim(), currency, StringComparison.OrdinalIgnoreCase)).ToList();

        return SalaryBounds.Check(
            same.Min(r => r.MinCents!.Value) / 100,
            same.Max(r => r.MaxCents!.Value) / 100,
            currency,
            estimate: false);
    }

    // The blurb is HTML, sometimes entity-encoded; decoding first keeps
    // "per&nbsp;hour" from slipping past.
    private static bool MentionsHourly(string? text) =>
        text is not null && HourlyPattern().IsMatch(WebUtility.HtmlDecode(WebUtility.HtmlDecode(text)));

    [GeneratedRegex(@"\b(hour|hourly|per\s+hr)\b", RegexOptions.IgnoreCase)]
    private static partial Regex HourlyPattern();
}
