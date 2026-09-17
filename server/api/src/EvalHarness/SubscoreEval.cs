using System.Text;
using System.Text.Json;

namespace ApplicationTracker.EvalHarness;

public sealed record DimensionCheck(
    string Dimension, string ExpectedBand, string? ActualBand, int? Score, int? MaxScore)
{
    public bool Passed => ActualBand == ExpectedBand;
}

public sealed record SubscoreResult
{
    public required string Id { get; init; }
    public string? Title { get; init; }
    public List<DimensionCheck> Checked { get; init; } = [];
    public int HardBlockers { get; init; }
    public bool BlockersOk { get; init; }
    public bool Passed => BlockersOk && Checked.All(c => c.Passed);
}

/// <summary>
/// Golden-set evaluation of the Evaluator's per-dimension sub-scores, against a
/// frozen profile.
/// </summary>
/// <remarks>
/// The verdict eval asks whether the overall call is right. This asks whether
/// it is right for the right reasons — a posting can land in the correct band
/// while the dimension that should have driven it scored flat.
///
/// The profile is sent with the request and frozen in
/// <c>fixtures/golden-profile.json</c>, so the measurement does not move when
/// the real profile is edited. Candidate signal comes only from the injected
/// profile (AGENTS.md), which is what makes freezing it sufficient.
/// </remarks>
public static class SubscoreEval
{
    private static readonly string[] Dimensions =
        ["technicalFit", "engineeringExecutionFit", "sustainabilityPaceFit"];

    // Banded by percentage of each dimension's OWN maxScore, not a hardcoded
    // point value: maxScore is model-reported and dimension-specific.
    private const int LowCeiling = 28;   // < 28%   -> low
    private const int MidCeiling = 57;   // 28-57%  -> mid; above -> high

    private static readonly TimeSpan Pacing = TimeSpan.FromSeconds(3);

    /// <summary>
    /// Null when the response carried no usable score/maxScore pair — kept
    /// distinct from a real band so a missing dimension never silently reads as
    /// a pass, or as a specific band.
    /// </summary>
    public static string? BandFor(int? score, int? maxScore)
    {
        if (score is null || maxScore is null or 0) return null;
        var pct = score.Value * 100.0 / maxScore.Value;
        return pct < LowCeiling ? "low" : pct <= MidCeiling ? "mid" : "high";
    }

    public static async Task<List<SubscoreResult>> RunAsync(
        HttpClient http, List<GoldenCase> cases, string profilePath, CancellationToken ct = default)
    {
        using var profileDoc = JsonDocument.Parse(File.ReadAllText(profilePath));
        var profile = profileDoc.RootElement.Clone();

        using var rawCases = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(Path.GetDirectoryName(profilePath)!, "golden-set.json")));
        var expectations = rawCases.RootElement.GetProperty("cases")
            .EnumerateArray()
            .ToDictionary(c => c.GetProperty("id").GetString()!, c => c.Clone());

        var results = new List<SubscoreResult>();

        for (var i = 0; i < cases.Count; i++)
        {
            var c = cases[i];
            if (i > 0) await Task.Delay(Pacing, ct);

            using var response = await http.PostAsJsonAsyncWithProfile(c.JdText, profile, ct);
            if (!response.IsSuccessStatusCode)
                // Aborts the whole run rather than reporting a partial result:
                // a run over fewer cases is a different denominator.
                throw new InvalidOperationException(
                    $"eval-subscore: /api/match returned {(int)response.StatusCode} for case '{c.Id}'");

            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var root = body.RootElement;

            var breakdown = root.TryGetProperty("breakdown", out var b) ? b : default;
            var blockers = root.TryGetProperty("hardBlockers", out var hb) && hb.ValueKind == JsonValueKind.Array
                ? hb.GetArrayLength() : 0;

            var spec = expectations.GetValueOrDefault(c.Id);
            var checks = new List<DimensionCheck>();

            if (spec.ValueKind == JsonValueKind.Object
                && spec.TryGetProperty("expected", out var expected)
                && expected.ValueKind == JsonValueKind.Object)
            {
                foreach (var e in expected.EnumerateObject())
                {
                    var (score, max) = ReadDimension(breakdown, e.Name);
                    checks.Add(new DimensionCheck(e.Name, e.Value.GetString() ?? "", BandFor(score, max), score, max));
                }
            }

            // expectBlocked is tri-state: true/false assert on hardBlockers
            // being non-empty/empty, and absent means this flag has no opinion.
            // Cases that test the veto itself carry no `expected` dict at all.
            var blockersOk = true;
            if (spec.ValueKind == JsonValueKind.Object)
            {
                if (spec.TryGetProperty("expectNoBlockers", out var enb)
                    && enb.ValueKind == JsonValueKind.True && blockers > 0)
                    blockersOk = false;

                if (spec.TryGetProperty("expectBlocked", out var eb)
                    && eb.ValueKind is JsonValueKind.True or JsonValueKind.False
                    && (blockers > 0) != eb.GetBoolean())
                    blockersOk = false;
            }

            results.Add(new SubscoreResult
            {
                Id = c.Id,
                Title = c.Title,
                Checked = checks,
                HardBlockers = blockers,
                BlockersOk = blockersOk,
            });

            Console.Error.WriteLine($"  [{i + 1}/{cases.Count}] {c.Id}: "
                + string.Join(" ", checks.Select(x => $"{x.Dimension}={x.ActualBand ?? "?"}")));
        }

        return results;
    }

    private static (int? Score, int? Max) ReadDimension(JsonElement breakdown, string dimension)
    {
        if (breakdown.ValueKind != JsonValueKind.Object
            || !breakdown.TryGetProperty(dimension, out var d)
            || d.ValueKind != JsonValueKind.Object)
            return (null, null);

        int? Read(string name) =>
            d.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : null;

        return (Read("score"), Read("maxScore"));
    }

    public static string Report(List<SubscoreResult> results)
    {
        var sb = new StringBuilder();
        sb.AppendLine();
        sb.AppendLine($"Sub-score golden set: {results.Count(r => r.Passed)}/{results.Count} passed");

        foreach (var r in results.Where(r => !r.Passed))
        {
            sb.AppendLine();
            sb.AppendLine($"  {r.Id} — {r.Title}");
            if (!r.BlockersOk)
                sb.AppendLine($"      hardBlockers: {r.HardBlockers} (not what the case expects)");
            foreach (var c in r.Checked.Where(c => !c.Passed))
                sb.AppendLine($"      {c.Dimension,-26} expected {c.ExpectedBand,-5} got "
                    + $"{c.ActualBand ?? "none",-5} ({c.Score}/{c.MaxScore})");
        }

        // Per-dimension totals: a failure concentrated in one dimension is a
        // different signal from the same count spread across all three.
        sb.AppendLine();
        sb.AppendLine("By dimension:");
        foreach (var dim in Dimensions)
        {
            var checks = results.SelectMany(r => r.Checked).Where(c => c.Dimension == dim).ToList();
            if (checks.Count > 0)
                sb.AppendLine($"    {dim,-28} {checks.Count(c => c.Passed)}/{checks.Count}");
        }

        return sb.ToString();
    }
}

internal static class HttpExtensions
{
    /// <summary>
    /// <c>POST /api/match</c> with a frozen profile override.
    /// </summary>
    /// <remarks>
    /// Hand-built rather than serialised from a typed request, because this
    /// project deliberately has no reference to Core — it measures the endpoint
    /// as a caller sees it, and a shared type would let a change to the model
    /// silently change what is being measured.
    /// </remarks>
    public static Task<HttpResponseMessage> PostAsJsonAsyncWithProfile(
        this HttpClient http, string jobDescription, JsonElement profile, CancellationToken ct)
    {
        var payload = new Dictionary<string, object?>
        {
            ["jobDescription"] = jobDescription,
            ["profile"] = profile,
        };
        return http.PostAsync("/api/match",
            new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"), ct);
    }
}
