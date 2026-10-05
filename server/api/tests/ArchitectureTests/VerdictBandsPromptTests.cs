using ApplicationTracker.Core.Profile;
using ApplicationTracker.Infrastructure.AI;

namespace ArchitectureTests;

/// <summary>
/// The Evaluator prompt's DECISION THRESHOLDS are the bands the server applies.
/// </summary>
/// <remarks>
/// They used to be two numbers: the prompt said 80/60/40/20, the server's
/// VerdictFromScore applied 85/68/50/25 and overwrote the model's verdict. The
/// model then picked terse or full output by one scale and was judged by the
/// other. The prompt now carries a placeholder filled from VerdictBands.
/// </remarks>
public class VerdictBandsPromptTests
{
    // PromptSeeds is internal to Infrastructure; read the seed from source, as
    // the other scanning tests here do.
    private static readonly string Seeds = File.ReadAllText(Path.Combine(
        RepoSources.Root, "server", "api", "src", "Infrastructure", "AI", "PromptSeeds.cs"));

    private const string Section = "# DECISION THRESHOLDS\n\n{{VERDICT_BANDS}}\n";

    [Fact]
    public void The_seed_prompt_takes_its_thresholds_from_config()
    {
        Assert.Contains("{{VERDICT_BANDS}}", Seeds);
        Assert.DoesNotContain("STRONG_YES → 80–100", Seeds);
    }

    [Fact]
    public void The_rendered_thresholds_are_the_configured_bands()
    {
        var rendered = PromptBuilder.WithVerdictBands(Section, new VerdictBands());

        Assert.DoesNotContain("{{VERDICT_BANDS}}", rendered);
        Assert.Contains("- STRONG_YES → 85–100", rendered);
        Assert.Contains("- YES → 68–84", rendered);
        Assert.Contains("- MAYBE → 50–67", rendered);
        Assert.Contains("- NO → 25–49", rendered);
        Assert.Contains("- STRONG_NO → 0–24 OR any FAIL in hard filters", rendered);
    }

    [Fact]
    public void Changed_bands_change_the_prompt_with_them()
    {
        var rendered = PromptBuilder.WithVerdictBands(
            Section, new VerdictBands { StrongYes = 90, Yes = 70, Maybe = 55, No = 30 });

        Assert.Contains("- STRONG_YES → 90–100", rendered);
        Assert.Contains("- YES → 70–89", rendered);
        Assert.Contains("- STRONG_NO → 0–29", rendered);
    }

    [Fact]
    public void An_override_prompt_without_the_placeholder_is_left_alone()
    {
        const string custom = "custom evaluator prompt";
        Assert.Equal(custom, PromptBuilder.WithVerdictBands(custom, new VerdictBands()));
    }
}
