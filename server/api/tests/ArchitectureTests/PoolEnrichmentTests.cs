using ApplicationTracker.Core.Matching;

namespace ArchitectureTests;

// The pool stores company enrichment the ingest scraped once. Passing it to the
// Evaluator is straightforward; passing an EMPTY version of it is not, because
// "present but empty" and "absent" mean different things to the scorer.
//
// JobMatchService.EnforceEvidenceCaps lifts the Pace & Workload / Long-term Risk
// ceiling when `glassdoorData is null` is false — on the reasoning that a
// posting silent on pace may still have real review evidence reaching the
// Evaluator another way. Hand it an object with nothing in it and that reasoning
// inverts: the cap lifts and nothing replaces it, so the score rises because a
// field exists rather than because anything was learned.
//
// No such document exists today (22 of 22 in the live pool carry sub-ratings,
// recommend-percent and snippets). These tests are for the version of the
// scraper's Glassdoor client that starts writing an empty shell on a miss — a
// change nobody would connect to a scoring drift weeks later.
public class PoolEnrichmentTests
{
    // --- the guard --------------------------------------------------------

    [Fact]
    public void An_object_with_no_evidence_is_not_evidence()
    {
        var empty = new GlassdoorData { ReviewCount = 0, Url = "https://glassdoor.com/x" };

        Assert.Null(PoolEnrichment.EvidenceOrNull(empty));
    }

    [Fact]
    public void A_url_and_review_count_alone_do_not_count()
    {
        // ReviewCount and Url are metadata about reviews, not the reviews. The
        // prompt's <employee_reviews> block needs sub-ratings, a recommend
        // percentage or snippets before it can say anything.
        var metadataOnly = new GlassdoorData { ReviewCount = 412, Url = "https://glassdoor.com/x" };

        Assert.Null(PoolEnrichment.EvidenceOrNull(metadataOnly));
    }

    [Fact]
    public void An_all_null_subratings_object_is_not_evidence()
    {
        var hollow = new GlassdoorData { SubRatings = new GlassdoorSubRatings() };

        Assert.Null(PoolEnrichment.EvidenceOrNull(hollow));
        Assert.False(PoolEnrichment.HasAnySubRating(new GlassdoorSubRatings()));
    }

    [Fact]
    public void Null_stays_null()
    {
        Assert.Null(PoolEnrichment.EvidenceOrNull(null));
    }

    // --- what must still get through -------------------------------------

    [Theory]
    [MemberData(nameof(RealEvidence))]
    public void Real_evidence_passes_through_unchanged(string because, GlassdoorData data)
    {
        var result = PoolEnrichment.EvidenceOrNull(data);

        Assert.NotNull(result);
        Assert.Same(data, result);
        Assert.False(string.IsNullOrEmpty(because));
    }

    public static TheoryData<string, GlassdoorData> RealEvidence() => new()
    {
        { "an overall rating", new GlassdoorData { Rating = 3.9 } },
        { "a recommend percentage", new GlassdoorData { RecommendPercent = 61 } },
        { "verbatim snippets", new GlassdoorData { Snippets = ["Employees rated it 3.8 for work life balance"] } },
        {
            // The shape actually stored on the live pool: no overall rating at
            // all, which is why the guard cannot test Rating alone.
            "sub-ratings without an overall rating",
            new GlassdoorData
            {
                ReviewCount = 26,
                RecommendPercent = 61,
                SubRatings = new GlassdoorSubRatings { WorkLifeBalance = 3.8, CultureAndValues = 3.8 },
            }
        },
    };

    [Fact]
    public void One_populated_subrating_is_enough()
    {
        var oneField = new GlassdoorData
        {
            SubRatings = new GlassdoorSubRatings { CompensationAndBenefits = 4.1 },
        };

        Assert.NotNull(PoolEnrichment.EvidenceOrNull(oneField));
    }

    // --- company profile --------------------------------------------------

    [Fact]
    public void An_empty_company_profile_is_null_not_a_blank_record()
    {
        // An all-null record would make PromptBuilder emit a <company_profile>
        // block containing nothing, spending input tokens on every job to say
        // so.
        Assert.Null(PoolEnrichment.CompanyProfileFrom(null));
        Assert.Null(PoolEnrichment.CompanyProfileFrom(new Dictionary<string, object?>()));
        Assert.Null(PoolEnrichment.CompanyProfileFrom(
            new Dictionary<string, object?> { ["industry"] = null, ["url"] = "" }));
    }

    [Fact]
    public void Company_profile_keeps_only_the_documented_fields()
    {
        // The scraper owns that collection's schema and can add fields at any
        // time; the prompt documents five. Anything else is dropped rather than
        // forwarded to the model as unlabelled data.
        var raw = new Dictionary<string, object?>
        {
            ["industry"] = "Software Development",
            ["url"] = "https://www.linkedin.com/company/example",
            ["somethingTheScraperAddedLater"] = "should not reach the prompt",
        };

        var profile = PoolEnrichment.CompanyProfileFrom(raw);

        Assert.NotNull(profile);
        Assert.Equal("Software Development", profile!.Industry);
        Assert.Equal("https://www.linkedin.com/company/example", profile.Url);
        Assert.Null(profile.Description);
        Assert.Null(profile.NumEmployees);
        Assert.Null(profile.Revenue);
    }

    [Fact]
    public void The_live_shape_survives_the_round_trip()
    {
        // Exactly what every one of the 90 scannable pool documents carries.
        var raw = new Dictionary<string, object?>
        {
            ["industry"] = "Software Development",
            ["url"] = "https://il.linkedin.com/company/example",
        };

        var profile = PoolEnrichment.CompanyProfileFrom(raw);

        Assert.NotNull(profile);
        Assert.Equal("Software Development", profile!.Industry);
    }
}
