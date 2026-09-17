using System.Text;
using System.Text.Json;

namespace ApplicationTracker.EvalHarness;

public sealed record GoldenCase
{
    public string Id { get; init; } = "";
    public string Title { get; init; } = "";
    public string Expected { get; init; } = "";
    public string JdText { get; init; } = "";
    public bool Uncertain { get; init; }
    public List<string> Tags { get; init; } = [];
}

public sealed record VerdictResult
{
    public required GoldenCase Case { get; init; }
    public string? Verdict { get; init; }
    public int? Score { get; init; }
    public required string Band { get; init; }
    public bool Passed { get; init; }
}

/// <summary>
/// Golden-set evaluation for the Evaluator.
/// </summary>
/// <remarks>
/// The primary regression gate for the whole scoring architecture: every
/// discovered job depends on Evaluator correctness, in a way the manual page
/// alone never exposed.
///
/// The model's six-value verdict is mapped onto the golden set's three bands.
/// <c>INSUFFICIENT_DATA</c> and anything unrecognised become "unscoreable"
/// rather than being folded into a pass or a fail — a case the model could not
/// judge is a different outcome from one it judged wrongly, and averaging them
/// together hides the one that matters.
/// </remarks>
public static class VerdictEval
{
    private static readonly Dictionary<string, string> VerdictBand = new(StringComparer.Ordinal)
    {
        ["STRONG_YES"] = "strong",
        ["YES"] = "strong",
        ["MAYBE"] = "weak",
        ["NO"] = "reject",
        ["STRONG_NO"] = "reject",
    };

    // /api/match is rate-limited under the "match" bucket at 10/min, and this
    // harness is a client of it like any other.
    private static readonly TimeSpan Pacing = TimeSpan.FromSeconds(3);

    public static string Classify(string? verdict) =>
        VerdictBand.GetValueOrDefault((verdict ?? "").Trim(), "unscoreable");

    public static List<GoldenCase> Load(string fixturePath)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(fixturePath));
        var cases = new List<GoldenCase>();

        foreach (var c in doc.RootElement.GetProperty("cases").EnumerateArray())
        {
            cases.Add(new GoldenCase
            {
                Id = Str(c, "id") ?? "",
                Title = Str(c, "title") ?? "",
                Expected = Str(c, "expected") ?? "",
                JdText = Str(c, "jdText") ?? "",
                Uncertain = c.TryGetProperty("uncertain", out var u) && u.ValueKind == JsonValueKind.True,
                Tags = c.TryGetProperty("tags", out var t) && t.ValueKind == JsonValueKind.Array
                    ? [.. t.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!)]
                    : [],
            });
        }
        return cases;
    }

    public static async Task<List<VerdictResult>> RunAsync(
        MatchClient client, List<GoldenCase> cases, CancellationToken ct = default)
    {
        var results = new List<VerdictResult>();

        for (var i = 0; i < cases.Count; i++)
        {
            var c = cases[i];
            if (i > 0) await Task.Delay(Pacing, ct);

            // Deliberately not caught. A partial run is a different denominator.
            var match = await client.ScoreAsync(c.JdText, ct);
            var band = Classify(match.Verdict);

            results.Add(new VerdictResult
            {
                Case = c,
                Verdict = match.Verdict,
                Score = match.OverallScore,
                Band = band,
                Passed = band == c.Expected,
            });

            Console.Error.WriteLine($"  [{i + 1}/{cases.Count}] {c.Id}: {match.Verdict} -> {band}");
        }

        return results;
    }

    public static string Report(List<VerdictResult> results)
    {
        var sb = new StringBuilder();
        var passed = results.Count(r => r.Passed);

        sb.AppendLine();
        sb.AppendLine($"Verdict golden set: {passed}/{results.Count} passed");

        var unscoreable = results.Where(r => r.Band == "unscoreable").ToList();
        if (unscoreable.Count > 0)
            sb.AppendLine($"  unscoreable: {unscoreable.Count} " +
                $"({string.Join(", ", unscoreable.Select(r => r.Case.Id))})");

        var failures = results.Where(r => !r.Passed).ToList();
        if (failures.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("Failures:");
            foreach (var f in failures)
                sb.AppendLine($"    {f.Case.Id}: expected {f.Case.Expected}, got {f.Band} "
                    + $"({f.Verdict}, score {f.Score}){(f.Case.Uncertain ? "  [uncertain]" : "")}");
        }

        // Grouped by tag, because a failure concentrated in one failure-mode is
        // a different signal from the same count spread across all of them.
        var byTag = results
            .SelectMany(r => r.Case.Tags.Select(t => (Tag: t, Result: r)))
            .GroupBy(x => x.Tag)
            .OrderBy(g => g.Key);

        if (byTag.Any())
        {
            sb.AppendLine();
            sb.AppendLine("By tag:");
            foreach (var g in byTag)
                sb.AppendLine($"    {g.Key,-28} {g.Count(x => x.Result.Passed)}/{g.Count()}");
        }

        return sb.ToString();
    }

    /// <summary>
    /// Multi-run report: the pass-rate spread and which cases are flaky.
    /// </summary>
    /// <remarks>
    /// A single run cannot distinguish a real regression from model noise. The
    /// spread is what makes a later comparison meaningful — a one-case drop
    /// means nothing if the baseline already varies by two.
    /// </remarks>
    public static string MultiRunReport(List<List<VerdictResult>> runs)
    {
        var sb = new StringBuilder();
        var rates = runs.Select(r => r.Count(x => x.Passed)).ToList();

        sb.AppendLine();
        sb.AppendLine($"Verdict golden set, {runs.Count} runs of {runs[0].Count} cases");
        sb.AppendLine($"  pass counts : {string.Join(", ", rates)}");
        sb.AppendLine($"  spread      : {rates.Max() - rates.Min()} "
            + $"({(rates.Max() == rates.Min() ? "stable" : "NOISY — treat single-run diffs with care")})");

        var flaky = runs[0].Select(r => r.Case.Id)
            .Where(id => runs.Select(run => run.First(r => r.Case.Id == id).Passed).Distinct().Count() > 1)
            .ToList();

        sb.AppendLine(flaky.Count == 0
            ? "  flaky cases : none"
            : $"  flaky cases : {string.Join(", ", flaky)}");

        return sb.ToString();
    }

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
