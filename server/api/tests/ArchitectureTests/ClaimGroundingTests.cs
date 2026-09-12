using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Profile;

namespace ArchitectureTests;

// The Evaluator claimed technologies the candidate did not have, and the one
// mechanical check that could have caught it read its input from the model.
// Every case below is a real line from stored output, scored against the real
// profile it was scored against: a Lead Data Engineer whose profile contains
// Python, SQL, Scala, Airflow, dbt, Kafka, Spark, Dagster, Snowflake,
// PostgreSQL, S3, Delta Lake, Docker, Terraform, GitHub Actions, Datadog,
// Java and C, and does NOT contain Kubernetes, AWS, Prometheus, or the word
// "cloud" anywhere.
public class ClaimGroundingTests
{
    private static StructuredProfile Profile() => new()
    {
        Summary = "Data engineer with a decade building batch and streaming pipelines in Python and Scala.",
        Experience =
        [
            new ExperienceItem
            {
                Title = "Lead Data Engineer",
                Company = "Tavor Analytics",
                Highlights =
                [
                    "Own the ingestion platform: ~2.3 TB/day across Kafka into Snowflake, 60+ source systems",
                    "Replaced a nightly Airflow DAG that had grown to 340 tasks with a dbt project",
                ],
            },
            new ExperienceItem
            {
                Title = "Data Engineer",
                Company = "Negev Grid",
                Highlights =
                [
                    "Spark jobs in Scala over 5 years of historical consumption data",
                    "Introduced Great Expectations checks after a bad load reached billing",
                ],
            },
        ],
        Skills =
        [
            new SkillGroup { Category = "Languages (daily)", Items = ["Python", "SQL", "Scala"] },
            new SkillGroup { Category = "Pipelines", Items = ["Airflow", "dbt", "Kafka", "Spark", "Dagster"] },
            new SkillGroup { Category = "Storage", Items = ["Snowflake", "PostgreSQL", "S3", "Delta Lake"] },
            new SkillGroup { Category = "Ops", Items = ["Docker", "Terraform", "GitHub Actions", "Datadog"] },
        ],
    };

    private static List<string[]> Evidence() => ClaimGrounding.ProfileEvidence(Profile());

    // ---- the gap list the cap now reads -----------------------------------

    [Fact]
    public void Gaps_are_the_posting_requirements_the_profile_does_not_evidence()
    {
        // Zscaler, Sr. DevOps Engineer: his highest-scored job at 88, whose
        // rationale read "AWS/EKS/Kubernetes/Terraform - perfect stack match".
        string[] required =
        [
            "AWS", "Kubernetes", "EKS", "Docker", "Helm", "Terraform", "Terragrunt",
            "GitHub Actions", "GitLab CI", "ArgoCD", "Grafana", "Datadog",
            "OpenTelemetry", "Prometheus", "Alertmanager", "Python", "Go",
        ];

        var gaps = ClaimGrounding.RequiredButAbsent(required, Evidence());

        // The five he has are not gaps.
        Assert.DoesNotContain("Docker", gaps);
        Assert.DoesNotContain("Terraform", gaps);
        Assert.DoesNotContain("GitHub Actions", gaps);
        Assert.DoesNotContain("Datadog", gaps);
        Assert.DoesNotContain("Python", gaps);
        // The ones he has not, are.
        Assert.Contains("AWS", gaps);
        Assert.Contains("Helm", gaps);
        Assert.Contains("Prometheus", gaps);
        // EKS collapses into Kubernetes: one absent technology, not two.
        Assert.Single(gaps.Where(g => g is "Kubernetes" or "EKS"));
        // Far past the >=4 the Core Stack cap needs, where the model
        // self-reported one gap and Core Stack came back 20/20.
        Assert.True(gaps.Length >= 4,
            $"expected the cap to fire; got {gaps.Length}: {string.Join(", ", gaps)}");
    }

    [Fact]
    public void An_alias_of_something_the_profile_has_is_not_a_gap()
    {
        var profile = new StructuredProfile
        {
            Skills = [new SkillGroup { Category = "Ops", Items = ["Kubernetes", "PostgreSQL"] }],
        };
        var gaps = ClaimGrounding.RequiredButAbsent(
            ["EKS", "Postgres"], ClaimGrounding.ProfileEvidence(profile));
        Assert.Empty(gaps);
    }

    [Fact]
    public void A_posting_with_no_stated_requirements_yields_no_gaps()
    {
        Assert.Empty(ClaimGrounding.RequiredButAbsent([], Evidence()));
    }

    // ---- the positive claims that had no rule at all ----------------------

    [Theory]
    // Real quickHighlights from stored output.
    [InlineData("Python/Kubernetes/AWS - strong match", "Kubernetes")]
    [InlineData("AWS/EKS/Kubernetes/Terraform - perfect stack match", "Kubernetes")]
    [InlineData("Python/Kubernetes match - core strength", "Kubernetes")]
    [InlineData("Kubernetes/Terraform/Python - excellent match", "Kubernetes")]
    [InlineData("Core stack match - Kubernetes", "Kubernetes")]
    // Real component reasons.
    [InlineData("Python/Kubernetes/cloud platforms strong", "Kubernetes")]
    [InlineData("Terraform, Kubernetes, AWS, ArgoCD all demonstrated", "AWS")]
    public void A_technology_asserted_as_his_is_flagged_when_the_profile_lacks_it(
        string text, string expected)
    {
        var claims = ClaimGrounding.ClaimsIn(text, ["Kubernetes", "AWS", "Prometheus", "ArgoCD"]);
        Assert.Contains(expected, claims);
    }

    [Theory]
    // Saying the role needs something he lacks is correct reporting, not a claim.
    [InlineData("GCP required; no GCP, Kubernetes, or cloud infrastructure experience demonstrated.")]
    [InlineData("C/Java rusty; C++/Rust required; no Linux/CUDA/TCP-IP experience.")]
    [InlineData("Kubernetes - partial match only")]
    [InlineData("Junior level for infrastructure lead role; steep learning curve on AWS/Azure.")]
    [InlineData("Python strong; Docker, AWS basics transferable")]
    [InlineData("ArgoCD/Terragrunt - learnable tools")]
    public void Naming_a_technology_as_missing_is_not_a_claim(string text)
    {
        var claims = ClaimGrounding.ClaimsIn(
            text, ["Kubernetes", "AWS", "GCP", "Prometheus", "ArgoCD", "Linux"]);
        Assert.Empty(claims);
    }

    [Fact]
    public void One_sentence_can_assert_one_technology_and_deny_another()
    {
        // The clause split is what makes this possible: reading the sentence as
        // a unit would either miss "Kubernetes strong" or wrongly flag the
        // honest half.
        var claims = ClaimGrounding.ClaimsIn(
            "Kubernetes and Terraform strong; Prometheus not demonstrated.",
            ["Kubernetes", "Prometheus"]);
        Assert.Equal(["Kubernetes"], claims);
    }

    [Fact]
    public void A_technology_evidenced_only_in_an_experience_highlight_is_supported()
    {
        // "Great Expectations" appears in an experience highlight and nowhere
        // in Skills. Grounding on the Skills list alone would call it
        // fabricated, so Find must read the whole profile.
        var response = new MatchResponse
        {
            QuickHighlights = ["Great Expectations and dbt - data quality strength"],
        };
        Assert.Empty(ClaimGrounding.Find(response, ["Great Expectations", "dbt"], Profile()));
    }

    [Fact]
    public void Find_walks_highlights_reasons_and_the_narrative()
    {
        var response = new MatchResponse
        {
            QuickHighlights = ["Python/Kubernetes/AWS - strong match", "ML lifecycle new"],
            Breakdown = new Breakdown
            {
                TechnicalFit = new TechnicalFitScore
                {
                    Components =
                    [
                        new ScoreComponent
                        {
                            Name = "Core Stack",
                            Score = 11,
                            Reason = "Python strong; Kubernetes/AWS/cloud strong",
                        },
                    ],
                },
            },
            HonestAssessment = "Your Prometheus background fits their observability stack.",
        };

        var claims = ClaimGrounding.Find(
            response, ["Kubernetes", "AWS", "Prometheus", "Python"], Profile());

        Assert.Contains(claims, c => c.Field == "quickHighlights" && c.Technology == "Kubernetes");
        Assert.Contains(claims, c => c.Field == "breakdown.Core Stack" && c.Technology == "AWS");
        Assert.Contains(claims, c => c.Field == "honestAssessment" && c.Technology == "Prometheus");
        // Python is his: never flagged.
        Assert.DoesNotContain("Python", claims.Select(c => c.Technology));
    }

    [Fact]
    public void A_posting_that_states_no_requirements_produces_nothing_to_flag()
    {
        var response = new MatchResponse { QuickHighlights = ["Python/Kubernetes - strong match"] };
        Assert.Empty(ClaimGrounding.Find(response, [], Profile()));
    }
}
