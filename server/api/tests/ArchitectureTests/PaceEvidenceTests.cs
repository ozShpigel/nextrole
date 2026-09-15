using ApplicationTracker.Core.Matching;

namespace ArchitectureTests;

// EnforceEvidenceCaps caps Pace & Workload / Long-term Risk when the posting
// says nothing about pace, and lifts that cap when review evidence might cover
// the gap. The test used to be `glassdoorData is null` — which means a payload
// carrying only a career-opportunities rating would excuse a PACE ceiling.
//
// The predicate releases a ceiling rather than applying one, so a false
// positive raises a score on evidence that does not support it. These tests
// pin the narrow reading: the payload has to say something about hours or load.
public class PaceEvidenceTests
{
    [Fact]
    public void Nothing_is_not_evidence()
    {
        Assert.False(PaceEvidence.In(null));
        Assert.False(PaceEvidence.In(new GlassdoorData()));
    }

    [Fact]
    public void A_work_life_balance_subrating_is_pace_evidence()
    {
        // The direct signal, and what every live payload actually carries.
        var g = new GlassdoorData { SubRatings = new GlassdoorSubRatings { WorkLifeBalance = 3.8 } };

        Assert.True(PaceEvidence.In(g));
    }

    [Fact]
    public void Culture_and_career_ratings_are_not_pace_evidence()
    {
        // The whole point of the change. This payload is real review data and
        // the Evaluator should still see it — it just must not lift a ceiling
        // on a dimension it says nothing about.
        var g = new GlassdoorData
        {
            ReviewCount = 236,
            RecommendPercent = 80,
            SubRatings = new GlassdoorSubRatings
            {
                CultureAndValues = 4.1,
                CareerOpportunities = 3.9,
                SeniorManagement = 3.4,
                CompensationAndBenefits = 4.0,
            },
        };

        Assert.False(PaceEvidence.In(g));
    }

    [Fact]
    public void An_overall_rating_alone_is_not_pace_evidence()
    {
        // A single number averaging everything says nothing specific about
        // hours or load.
        Assert.False(PaceEvidence.In(new GlassdoorData { Rating = 4.2, ReviewCount = 500 }));
    }

    [Fact]
    public void A_recommend_percentage_alone_is_not_pace_evidence()
    {
        Assert.False(PaceEvidence.In(new GlassdoorData { RecommendPercent = 84 }));
    }

    [Theory]
    [InlineData("Employees also rated Axonius 4.3 out of 5 for work life balance , 4.1 for culture and values.")]
    [InlineData("Great team but the working hours are brutal during release weeks.")]
    [InlineData("On-call rotation is one week in four.")]
    [InlineData("Constant overtime, and burnout is common on the platform team.")]
    [InlineData("The workload is heavy but manageable.")]
    public void Snippets_that_speak_to_pace_count(string snippet)
    {
        var g = new GlassdoorData { Snippets = [snippet] };

        Assert.True(PaceEvidence.In(g));
    }

    [Theory]
    [InlineData("80% of Axonius employees would recommend working there to a friend based on Glassdoor reviews .")]
    [InlineData("Axonius Reviews (236): Pros & Cons of Working At Axonius | Glassdoor")]
    [InlineData("Management is responsive and the culture is collaborative.")]
    [InlineData("Good career progression and strong compensation.")]
    public void Snippets_about_anything_else_do_not(string snippet)
    {
        // The second case is the live "recommend working there" boilerplate —
        // it contains the word "working" and must still not count, which is why
        // the vocabulary is phrases rather than single words.
        var g = new GlassdoorData { Snippets = [snippet] };

        Assert.False(PaceEvidence.In(g));
    }

    [Fact]
    public void The_live_payload_shape_still_qualifies()
    {
        // Exactly what all 22 documents with review evidence carry today. The
        // narrowing must not silently re-cap the jobs it was measured against.
        var g = new GlassdoorData
        {
            ReviewCount = 26,
            RecommendPercent = 61,
            SubRatings = new GlassdoorSubRatings
            {
                WorkLifeBalance = 3.8,
                CultureAndValues = 3.8,
                CareerOpportunities = 3.5,
            },
            Snippets =
            [
                "Employees also rated OnTarget 3.8 out of 5 for work life balance , 3.8 for culture and values and 3.5 for career opportunities.",
                "67% of OnTarget employees would recommend working there to a friend based on Glassdoor reviews .",
            ],
        };

        Assert.True(PaceEvidence.In(g));
    }
}
