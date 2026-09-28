using System.Reflection;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Profile;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// <c>hardware_engineering</c> (docs/plans/hardware-engineering-function.md):
/// hardware roles labelled as what they are, so a software profile's filter
/// leaves them out -- without hiding embedded work from either side.
/// </summary>
public class HardwareEngineeringTests
{
    private const string Hardware = JobFunctions.HardwareEngineering;

    private static IReadOnlyList<string> AcceptedFor(params string[] functions) =>
        CandidateFilter.FromProfile(new StructuredProfile { Functions = functions }).Functions;

    [Fact]
    public void It_is_on_the_list_and_normalises_from_how_a_model_may_spell_it() =>
        Assert.Equal([Hardware], JobFunctions.Normalize(["Hardware Engineering"], JobFunctions.MaxPerJob));

    [Theory]
    [InlineData(JobFunctions.SoftwareEngineering)]
    [InlineData(JobFunctions.Infrastructure)]
    [InlineData(JobFunctions.Qa)]
    [InlineData(JobFunctions.DataEngineering)]
    [InlineData(JobFunctions.Security)]
    public void No_other_kind_of_work_accepts_it(string function)
    {
        // The whole point: a DevOps or software profile no longer draws
        // "Mechanical Design Engineer" into its candidates.
        Assert.DoesNotContain(Hardware, AcceptedFor(function));
        Assert.False(JobFunctions.Matches([Hardware], AcceptedFor(function)));
    }

    [Fact]
    public void A_hardware_profile_accepts_hardware_and_nothing_else() =>
        Assert.Equal([Hardware], AcceptedFor(Hardware));

    [Fact]
    public void Embedded_work_labelled_both_reaches_both()
    {
        string[] embedded = [JobFunctions.SoftwareEngineering, Hardware];

        Assert.True(JobFunctions.Matches(embedded, AcceptedFor(JobFunctions.SoftwareEngineering)));
        Assert.True(JobFunctions.Matches(embedded, AcceptedFor(JobFunctions.Infrastructure)));
        Assert.True(JobFunctions.Matches(embedded, AcceptedFor(Hardware)));
    }

    /// <summary>
    /// Both prompts that write a function -- job-facts and CV normalisation --
    /// list every value <see cref="JobFunctions.All"/> accepts. A value missing
    /// from a prompt is one the model can never produce, and nothing else would
    /// notice: <see cref="JobFunctions.Normalize"/> keeps only listed values.
    /// </summary>
    [Theory]
    [InlineData("JobFactsExtraction")]
    [InlineData("NormalizeProfile")]
    public void Every_listed_function_is_offered_by_the_prompt(string prompt)
    {
        var seeds = typeof(ApplicationTracker.Infrastructure.Greenhouse.GreenhouseJobRepository).Assembly
            .GetType("ApplicationTracker.Infrastructure.AI.PromptSeeds", throwOnError: true)!;
        var text = (string)seeds.GetField(prompt, BindingFlags.Public | BindingFlags.Static)!.GetRawConstantValue()!;

        // The list itself -- the `functions` bullet up to its first sub-bullet
        // or the next bullet -- not the whole prompt: a value the prompt only
        // mentions in passing ("embedded roles are both ... and ...") is not one
        // the model is offered.
        var start = text.IndexOf("- `functions`:", StringComparison.Ordinal);
        Assert.True(start >= 0, $"{prompt} has no `functions` bullet");
        var ends = new[] { "\n  -", "\n-" }
            .Select(m => text.IndexOf(m, start + 1, StringComparison.Ordinal))
            .Where(i => i > 0)
            .DefaultIfEmpty(text.Length);
        var list = text[start..ends.Min()];

        Assert.All(JobFunctions.All, f => Assert.Contains($"\"{f}\"", list));
    }
}
