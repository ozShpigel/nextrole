using System.Text.Json.Serialization;

namespace ApplicationTracker.Core.Matching;

/// <summary>An annual pay range, in whole units of <see cref="Currency"/> (ISO 4217).</summary>
public sealed record SalaryRange(
    [property: JsonPropertyName("min")] int Min,
    [property: JsonPropertyName("max")] int Max,
    [property: JsonPropertyName("currency")] string Currency);

/// <summary>
/// The exact checks a salary range must pass before it is stored or shown.
/// </summary>
/// <remarks>
/// The facts prompt is told what an estimate may be; this is the code behind
/// that telling (AGENTS.md: a prompt rule with no check is not a rule). It is
/// deliberately narrow and exact rather than clever: a known currency, a
/// positive range, min ≤ max, and annual bounds converted to USD at rough,
/// fixed rates. The rates only need to separate "a year's pay" from "an hour's"
/// or "a month's" -- an order of magnitude apart -- so they are not kept current.
/// Published ranges get the same bounds (that is what drops Greenhouse's hourly
/// and monthly ranges) but not the spread limit: a company may publish a wide
/// band, and it is their number, not ours.
/// </remarks>
public static class SalaryBounds
{
    /// <summary>Approximate USD per one unit of each accepted currency.</summary>
    private static readonly Dictionary<string, double> UsdPerUnit = new(StringComparer.Ordinal)
    {
        ["USD"] = 1.0, ["EUR"] = 1.08, ["GBP"] = 1.27, ["ILS"] = 0.27, ["CAD"] = 0.73,
        ["AUD"] = 0.66, ["NZD"] = 0.60, ["CHF"] = 1.12, ["SEK"] = 0.095, ["NOK"] = 0.094,
        ["DKK"] = 0.145, ["PLN"] = 0.25, ["CZK"] = 0.043, ["HUF"] = 0.0028, ["RON"] = 0.22,
        ["INR"] = 0.012, ["SGD"] = 0.74, ["JPY"] = 0.0067, ["BRL"] = 0.18, ["MXN"] = 0.055,
        ["ZAR"] = 0.054, ["AED"] = 0.27, ["HKD"] = 0.13,
    };

    /// <summary>A year's pay, in USD, below which a range is not annual.</summary>
    /// <remarks>
    /// High enough to catch an Israeli MONTHLY figure read as a year's -- the
    /// likeliest slip, since Israel quotes pay monthly: up to ₪55,000 a month
    /// is under it. The cost: a genuinely annual range under $15k (junior
    /// roles in low-wage markets) shows as "not listed" rather than risk
    /// showing a month's pay as a year's.
    /// </remarks>
    public const double MinAnnualUsd = 15_000;

    /// <summary>A year's base pay, in USD, above which a range is not believable.</summary>
    public const double MaxAnnualUsd = 2_000_000;

    /// <summary>An estimate's max may be at most this multiple of its min.</summary>
    // The prompt asks for about 1.3x and never more than 1.5x; the check
    // allows a little over the stated ceiling so rounding never drops an
    // estimate the prompt would call valid.
    public const double MaxEstimateSpread = 1.6;

    public static bool IsKnownCurrency(string? currency) =>
        currency is not null && UsdPerUnit.ContainsKey(currency);

    /// <summary>The range, normalised, or null when it fails any check.</summary>
    /// <param name="estimate">True for a model estimate: the spread limit applies too.</param>
    public static SalaryRange? Check(long min, long max, string? currency, bool estimate)
    {
        var code = currency?.Trim().ToUpperInvariant();
        if (code is null || !UsdPerUnit.TryGetValue(code, out var rate)) return null;
        if (min <= 0 || max < min) return null;
        if (min * rate < MinAnnualUsd || max * rate > MaxAnnualUsd) return null;
        if (estimate && max > min * MaxEstimateSpread) return null;
        if (max > int.MaxValue) return null;
        return new SalaryRange((int)min, (int)max, code);
    }
}

/// <summary>What a job card shows about pay: the range and where it came from.</summary>
public sealed record JobSalary(
    [property: JsonPropertyName("min")] int Min,
    [property: JsonPropertyName("max")] int Max,
    [property: JsonPropertyName("currency")] string Currency,
    // "posted": the company's own published range. "estimated": the facts
    // read's estimate. A posted range always wins over an estimate.
    [property: JsonPropertyName("source")] string Source)
{
    public static JobSalary? From(SalaryRange? posted, SalaryRange? estimated) =>
        posted is not null ? new(posted.Min, posted.Max, posted.Currency, "posted")
        : estimated is not null ? new(estimated.Min, estimated.Max, estimated.Currency, "estimated")
        : null;
}
