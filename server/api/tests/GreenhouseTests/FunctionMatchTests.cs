using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Profile;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The job-function filter: a fixed list, a candidate's functions widened by
/// their neighbours, and permissive on absence on both sides.
/// </summary>
/// <remarks>
/// Why it exists: an infra engineer in Israel was shown every Israeli posting
/// in the collection, down to "Senior Brand Designer" scored 0 -- each one a
/// Claude call spent to learn it was irrelevant.
/// </remarks>
public class FunctionMatchTests
{
    private static IReadOnlyList<string> AcceptedFor(params string[] functions) =>
        CandidateFilter.FromProfile(new StructuredProfile { Functions = functions }).Functions;

    [Fact]
    public void Normalize_keeps_only_listed_values_whatever_the_spelling()
    {
        Assert.Equal(
            ["software_engineering", "data_engineering"],
            JobFunctions.Normalize(["Software Engineering", "data-engineering", "wizardry", null, " "], max: 5));
    }

    [Fact]
    public void Normalize_dedupes_and_caps_in_the_order_given()
    {
        Assert.Equal(
            ["sales", "marketing"],
            JobFunctions.Normalize(["sales", "SALES", "marketing", "design"], JobFunctions.MaxPerJob));
    }

    [Fact]
    public void An_infra_candidate_accepts_neighbouring_engineering_but_not_sales()
    {
        var accepted = AcceptedFor("infrastructure");

        Assert.Contains("infrastructure", accepted);
        Assert.Contains("software_engineering", accepted);
        Assert.Contains("data_engineering", accepted);
        Assert.DoesNotContain("sales", accepted);
        Assert.DoesNotContain("design", accepted);
    }

    [Theory]
    [InlineData(new[] { "infrastructure" }, true)]           // Senior DevOps Engineer
    [InlineData(new[] { "data_engineering" }, true)]         // Big Data Engineer: a neighbour
    [InlineData(new[] { "sales" }, false)]                   // Sales Manager
    [InlineData(new[] { "design" }, false)]                  // Senior Brand Designer
    [InlineData(new[] { "product", "analytics" }, false)]    // Product Analyst
    [InlineData(new[] { "sales", "software_engineering" }, true)] // Solutions Engineer: either label
    public void Postings_are_kept_when_any_of_their_functions_is_accepted(string[] job, bool expected)
    {
        Assert.Equal(expected, JobFunctions.Matches(job, AcceptedFor("infrastructure", "software_engineering")));
    }

    [Fact]
    public void A_posting_with_no_function_is_never_hidden()
    {
        // Unread, or read and unclear. A failed read must not hide a job.
        Assert.True(JobFunctions.Matches([], AcceptedFor("infrastructure")));
    }

    [Fact]
    public void A_profile_with_no_functions_constrains_nothing()
    {
        Assert.Empty(AcceptedFor());
        Assert.True(JobFunctions.Matches(["sales"], AcceptedFor()));
    }

    [Fact]
    public void An_off_list_profile_value_constrains_nothing_rather_than_everything()
    {
        // A profile saved with a value that is not on the list must not turn
        // into an accepted set that matches no posting at all.
        Assert.Empty(AcceptedFor("wizardry"));
    }

    [Fact]
    public void Every_listed_function_has_neighbours_defined()
    {
        // A function added to the list without an adjacency entry would throw
        // at match time for every candidate who has it.
        foreach (var function in JobFunctions.All)
            Assert.Contains(function, JobFunctions.AcceptedFor([function]));
    }
}
