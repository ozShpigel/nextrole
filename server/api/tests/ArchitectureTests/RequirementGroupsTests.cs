using System.Text.Json;
using ApplicationTracker.Core.Matching;

namespace ArchitectureTests;

// The shape the facts extraction returns, and what the server does with a
// model that does not quite return it.
public class RequirementGroupsTests
{
    private static readonly JsonSerializerOptions CaseInsensitive = new() { PropertyNameCaseInsensitive = true };

    [Fact]
    public void Groups_win_over_the_flat_list_when_present()
    {
        var groups = RequirementGroups.From([["Go", "Python"]], ["Go", "Python", "Rust"]);
        Assert.Single(groups);
    }

    [Fact]
    public void Without_groups_every_flat_name_is_its_own_requirement()
    {
        Assert.Equal([["Go"], ["Python"]], RequirementGroups.From([], ["Go", " Python ", ""]));
    }

    [Fact]
    public void Cleaning_drops_blanks_and_repeats_but_never_merges_requirements()
    {
        var cleaned = RequirementGroups.Clean([["Go", "go", " "], [], ["Python", "Go"], ["go"]]);
        Assert.Equal([["Go"], ["Python", "Go"]], cleaned);
    }

    [Fact]
    public void The_flat_list_is_every_member_once()
    {
        Assert.Equal(["Go", "Python", "MySQL"],
            RequirementGroups.Flatten([["Go", "Python"], ["python", "MySQL"]]));
    }

    [Fact]
    public void A_half_right_model_answer_still_deserializes()
    {
        // A strict reader would throw here, and the throw fails the whole chunk
        // of fifty postings rather than this one field.
        const string json = """{ "jobId": "1", "mustHaveGroups": ["Terraform", ["PostgreSQL", "MySQL"], 7, null] }""";
        var facts = JsonSerializer.Deserialize<JobFacts>(json, CaseInsensitive)!;
        Assert.Equal([["Terraform"], ["PostgreSQL", "MySQL"]], facts.MustHaveGroups);
    }

    [Fact]
    public void Groups_round_trip_through_the_api_response()
    {
        var facts = new JobFacts { JobId = "1", MustHaveGroups = [["Go", "Ruby"], ["SQL"]] };
        var json = JsonSerializer.Serialize(facts, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Contains("\"mustHaveGroups\":[[\"Go\",\"Ruby\"],[\"SQL\"]]", json);
        Assert.Equal(facts.MustHaveGroups, JsonSerializer.Deserialize<JobFacts>(json, CaseInsensitive)!.MustHaveGroups);
    }
}
