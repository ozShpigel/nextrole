using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ApplicationTracker.EvalHarness;

public sealed record ScoreComponent
{
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("score")] public int? Score { get; init; }
    [JsonPropertyName("maxScore")] public int? MaxScore { get; init; }
}

public sealed record MatchResult
{
    [JsonPropertyName("overallScore")] public int? OverallScore { get; init; }
    [JsonPropertyName("verdict")] public string? Verdict { get; init; }
    [JsonPropertyName("components")] public List<ScoreComponent>? Components { get; init; }

    /// <summary>
    /// Sub-scores by dimension name, as the Evaluator reports them. Kept as raw
    /// JSON because the harness only reads score/maxScore pairs and must not
    /// break when the rest of the shape moves.
    /// </summary>
    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; init; }
}

/// <summary>
/// The golden-set harness's one dependency: <c>POST /api/match</c>, over HTTP.
/// </summary>
/// <remarks>
/// Only <c>jobDescription</c> is sent, matching how the manual "Score a Job"
/// page calls it — the Analyst extracts title and company itself. Sending them
/// would measure a path no user takes.
///
/// **Fails loud.** A case whose call errors raises rather than being skipped: a
/// run over fewer cases than expected is a different, incomparable denominator,
/// not a smaller version of the same measurement.
/// </remarks>
public sealed class MatchClient(HttpClient http)
{
    public async Task<MatchResult> ScoreAsync(string jobDescription, CancellationToken ct = default)
    {
        using var response = await http.PostAsJsonAsync("/api/match", new { jobDescription }, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"/api/match returned {(int)response.StatusCode}: {Truncate(body)}");
        }

        return await response.Content.ReadFromJsonAsync<MatchResult>(cancellationToken: ct)
            ?? throw new InvalidOperationException("/api/match returned no body");
    }

    /// <summary>
    /// Refuse to run against anything but a Fixed-mode instance.
    /// </summary>
    /// <remarks>
    /// The evals score a known profile. A Cookie-mode API resolves identity from
    /// a cookie this harness does not send, so it would mint a fresh anonymous
    /// user with no profile — and every case would score against nothing while
    /// still producing numbers. Numbers that look like a result and measure
    /// nothing are worse than an error, which is why this is a refusal rather
    /// than a warning. The Python it replaces did the same via
    /// <c>identity.instance_identity</c>.
    /// </remarks>
    public async Task EnsureFixedModeAsync(CancellationToken ct = default)
    {
        string? mode;
        try
        {
            var config = await http.GetFromJsonAsync<JsonElement>("/api/config", ct);
            mode = config.TryGetProperty("identityMode", out var m) ? m.GetString() : null;
        }
        catch (Exception e)
        {
            throw new InvalidOperationException(
                $"Could not reach {http.BaseAddress}api/config to check the identity mode. "
                + "Start a local API with Identity__Mode=Fixed and point Api__BaseUrl at it.", e);
        }

        if (!string.Equals(mode, "Fixed", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"This instance reports Identity:Mode={mode ?? "unknown"}. The golden-set evals need "
                + "Fixed, where the profile comes from configuration. Against Cookie mode every case "
                + "would be scored for a freshly minted user with no profile, and the run would report "
                + "numbers that measure nothing.");
    }

    private static string Truncate(string s) => s.Length <= 300 ? s : s[..300] + "…";
}
