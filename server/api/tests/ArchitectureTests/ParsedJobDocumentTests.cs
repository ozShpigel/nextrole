using ApplicationTracker.Core.Matching;
using ApplicationTracker.Infrastructure.Greenhouse;
using MongoDB.Bson;

namespace ArchitectureTests;

/// <summary>
/// The stored parse's one format. A reader that cannot read what the writer
/// wrote returns null -- which the scan treats as "parse inline" -- so the
/// failure has no symptom except the bill: measured, 0 of 20 stored ingest
/// parses were ever read back before this.
/// </summary>
public class ParsedJobDocumentTests
{
    [Fact]
    public void Reads_a_parse_exactly_as_the_ingest_stores_it()
    {
        // The job-parse endpoint's camelCase JSON, stored as is.
        var stored = BsonDocument.Parse("""
            { "jobTitle": "Backend Engineer", "company": "Monzo",
              "requiredSkills": ["Go", "Kubernetes"], "experienceLevel": "Senior",
              "namedTechnologies": ["Go"], "responsibilities": ["Own the payments API"] }
            """);

        var parsed = ParsedJobDocument.From(stored);

        Assert.NotNull(parsed);
        Assert.Equal("Backend Engineer", parsed.JobTitle);
        Assert.Equal(["Go", "Kubernetes"], parsed.RequiredSkills);
    }

    [Fact]
    public void Reads_a_real_stored_ingest_parse_with_every_field_it_carries()
    {
        // Copied verbatim from a greenhouse_jobs row (a public posting),
        // nested culturalSignals / technicalRequirements / warnings included:
        // the exact document the old reader returned null for.
        var stored = BsonDocument.Parse(RealStoredParse);

        var parsed = ParsedJobDocument.From(stored);

        Assert.NotNull(parsed);
        Assert.Equal("Account Executive, Mid Market", parsed.JobTitle);
        Assert.Contains("Salesforce", parsed.RequiredSkills);
        Assert.NotEmpty(parsed.CulturalSignals.Positive);
    }

    private const string RealStoredParse = """
        {
         "jobTitle": "Account Executive, Mid Market",
         "company": "Similarweb",
         "requiredSkills": [
          "consultative sales processes",
          "sales presentations",
          "relationship building",
          "Salesforce",
          "market research",
          "sales strategy",
          "opportunity generation",
          "proposal development"
         ],
         "niceToHaveSkills": [
          "digital marketing trends",
          "SEO",
          "content marketing",
          "PPC",
          "social advertising",
          "display advertising"
         ],
         "experienceLevel": "3+ years",
         "culturalSignals": {
          "positive": [
           "open dialogue",
           "empower employees to bring their ideas to the table",
           "competitive compensation packages",
           "strong emphasis on community"
          ],
          "negative": [],
          "neutral": [
           "Hybrid",
           "ability to work partially from home"
          ]
         },
         "technicalRequirements": {
          "languages": [],
          "frameworks": [],
          "infrastructure": [],
          "databases": []
         },
         "namedTechnologies": [
          "Salesforce"
         ],
         "processSignals": [],
         "paceSignals": [],
         "domainContext": "SaaS sales, digital intelligence platform, mid-market enterprise accounts",
         "responsibilities": [
          "Stay informed about industry trends, competitive landscape, and client needs",
          "Collaborate with Marketing and Sales Development teams to create and execute sales programs",
          "Identify and qualify new sales opportunities through inbound leads and outbound prospecting",
          "Conduct product walkthroughs and presentations tailored to customer needs",
          "Prepare and present customized proposals and contracts to potential clients",
          "Develop and maintain strong relationships with key decision-makers and stakeholders",
          "Maintain accurate records of sales activities, pipeline, and forecasts in Salesforce"
         ],
         "warnings": [
          "Unable to sponsor employment visas at this time"
         ]
        }
        """;

    [Fact]
    public void A_parse_saved_while_scoring_is_stored_in_the_same_shape()
    {
        var parse = new ParsedJob { JobTitle = "Backend Engineer", RequiredSkills = ["Go"], DomainContext = "fintech" };

        var doc = ParsedJobDocument.To(parse);

        Assert.True(doc.Contains("jobTitle"));
        Assert.False(doc.Contains("JobTitle"));
        var back = ParsedJobDocument.From(doc)!;
        Assert.Equal(parse.JobTitle, back.JobTitle);
        Assert.Equal(parse.RequiredSkills, back.RequiredSkills);
        Assert.Equal(parse.DomainContext, back.DomainContext);
    }

    [Fact]
    public void An_unreadable_parse_is_null_not_an_exception() =>
        Assert.Null(ParsedJobDocument.From(new BsonDocument("requiredSkills", "not-an-array")));
}
