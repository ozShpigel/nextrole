using ApplicationTracker.PoolIngest;
using MongoDB.Bson;

namespace ArchitectureTests;

/// <summary>
/// The document a new pool listing is stored as.
/// </summary>
/// <remarks>
/// ~3,700 documents were written by the scraper's pydantic model, and the API
/// reads all of them. These pin the fields whose absence or wrong value is
/// silent rather than loud.
/// </remarks>
public class PoolDocumentTests
{
    private static ScrapedJob Job() => new()
    {
        Id = "job-1",
        Title = "Backend Engineer",
        Company = "Acme",
        JobUrl = "https://example.test/j/1",
        DatePosted = "2026-09-17",
    };

    private static BsonDocument Build(BsonDocument? facts = null, BsonDocument? parsed = null) =>
        PoolDocument.Build(Job(), "https://example.test/j/1", "run-1", DateTime.UtcNow, facts, parsed, "v3");

    [Fact]
    public void A_pool_row_opts_out_of_retention()
    {
        // The TTL index deletes anything with ttl_managed true. Pool listings
        // are marked inactive and NEVER deleted, so this false is the whole
        // guarantee -- and a missing field would not fail, it would expire the
        // pool 60 days later.
        Assert.False(Build()["ttl_managed"].AsBoolean);
    }

    [Fact]
    public void A_pool_row_has_a_null_criteria_id()
    {
        // The browse path tells pool rows from criteria-era ones by exactly
        // this. Absent would read the same as null today, but the field is
        // cheap and the distinction is load-bearing.
        Assert.Equal(BsonNull.Value, Build()["criteria_id"]);
    }

    [Fact]
    public void It_enters_the_pool_active_and_seen_now()
    {
        var doc = Build();
        Assert.True(doc["is_active"].AsBoolean);
        Assert.Equal(0, doc["missed_runs"].AsInt32);
        Assert.Equal(doc["first_seen_at"], doc["last_seen_at"]);
        Assert.Equal("run-1", doc["last_seen_run_id"].AsString);
    }

    [Fact]
    public void One_extraction_attempt_is_recorded_whether_or_not_it_worked()
    {
        // The counter is what stops a permanently unreadable posting costing a
        // Claude call a day forever. Starting it at 0 when the first attempt
        // already happened would give every job a free extra attempt.
        Assert.Equal(1, Build()["extract_attempts"].AsInt32);
        Assert.Equal(1, Build(facts: new BsonDocument("seniority", "mid-senior level"))["extract_attempts"].AsInt32);
    }

    [Fact]
    public void Facts_fill_the_seniority_band_and_the_timestamp()
    {
        var facts = new BsonDocument { { "seniority", "mid-senior level" }, { "must_have_tech", new BsonArray { "go" } } };
        var doc = Build(facts);

        Assert.Equal("mid-senior level", doc["actual_job_level"].AsString);
        Assert.Equal(facts, doc["extracted"].AsBsonDocument);
        Assert.NotEqual(BsonNull.Value, doc["extracted_at"]);
    }

    [Fact]
    public void No_facts_leaves_the_job_stored_and_retryable()
    {
        // A posting is worth keeping even when the facts about it are not
        // available yet: the next run retries.
        var doc = Build(facts: null);

        Assert.Equal(BsonNull.Value, doc["extracted"]);
        Assert.Equal(BsonNull.Value, doc["extracted_at"]);
        Assert.Equal(BsonNull.Value, doc["actual_job_level"]);
        Assert.Equal("Backend Engineer", doc["title"].AsString);
    }

    [Fact]
    public void The_parse_version_is_only_stamped_when_there_is_a_parse()
    {
        var unparsed = Build(parsed: null);
        Assert.Equal(BsonNull.Value, unparsed["parsed"]);
        Assert.Equal(BsonNull.Value, unparsed["parsed_with"]);

        var parsed = Build(parsed: new BsonDocument("title", "Backend Engineer"));
        Assert.Equal("v3", parsed["parsed_with"].AsString);
        Assert.NotEqual(BsonNull.Value, parsed["parsed_at"]);
    }

    [Fact]
    public void The_run_record_is_tagged_pool_so_the_digest_can_find_it()
    {
        // daily-digest.sh and the run-history endpoint both key on this.
        var run = RunRecord.Start();
        run.Status = "completed";

        var doc = run.ToDocument();
        Assert.Equal("pool", doc["criteria_id"].AsString);
        Assert.Equal("completed", doc["status"].AsString);
        Assert.Equal(BsonNull.Value, doc["error"]);
    }
}
