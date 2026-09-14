using System.Reflection;
using ApplicationTracker.Core.Identity;
using ApplicationTracker.Infrastructure.Repositories;
using MongoDB.Bson;

namespace ArchitectureTests;

/// <summary>
/// The merge's collision rules and its collection classification
/// (docs/auth.md, Phase 1.6).
/// </summary>
/// <remarks>
/// The classification is the dangerous part. It is hand-maintained — only the
/// UserId-field shape is derivable by reflection, and two of the collections
/// are written by the Python service where no C# test can see them — and
/// getting it wrong does not look like a failure. jobScores was classified as a
/// plain field update during design review purely because its _id, which embeds
/// the userId, was not checked.
///
/// So the enumeration test below covers "somebody added a collection", and
/// FindLeaksAsync (exercised against a real Mongo, not here) covers "somebody
/// classified one wrong". A test that only asserted each collection appears
/// somewhere in the merge would have passed on the broken version, which is
/// worse than no test: it manufactures confidence.
/// </remarks>
public class UserMergeServiceTests
{
    private static readonly Guid Anon = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid Account = Guid.Parse("11111111-1111-1111-1111-111111111111");

    // ---- The classification covers everything -----------------------------

    [Fact]
    public void Every_user_owned_type_is_classified()
    {
        // A new IUserOwned collection that nobody classified is data orphaned
        // on every merge, silently. This fails until it is placed.
        var owned = typeof(ApplicationTracker.Core.Models.Application).Assembly
            .GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(IUserOwned).IsAssignableFrom(t))
            .Select(t => t.Name)
            .ToList();

        Assert.NotEmpty(owned);   // vacuity guard

        // Model name -> collection, as MongoExtensions registers them.
        var known = new Dictionary<string, string>
        {
            ["Application"] = "applications",
            ["Interview"] = "interviews",
            ["Note"] = "notes",
            ["StatusUpdate"] = "statusUpdates",
            ["TrackedEmail"] = "messages",
            ["MatchSnapshot"] = "matchSnapshots",
            ["ResumePack"] = "resumePacks",
            ["MockInterviewSession"] = "mockInterviewSessions",
            ["JobScore"] = "jobScores",
        };

        var classified = UserMergeService.FieldOwned
            .Concat(UserMergeService.CompositeKeyed)
            .ToHashSet();

        foreach (var model in owned)
        {
            Assert.True(known.ContainsKey(model),
                $"{model} implements IUserOwned but this test does not know its collection. "
                + "Add it here and to the right bucket in UserMergeService.");
            Assert.True(classified.Contains(known[model]),
                $"{known[model]} is user-owned but UserMergeService does not merge it. "
                + "Every merge would silently orphan it.");
        }
    }

    [Fact]
    public void JobScores_is_classified_as_composite_keyed_not_as_a_field_update()
    {
        // Pinned specifically because this was got wrong once. Its _id is
        // "{userId}:{jobId}", and JobScore's own comment says that key exists
        // "so an upsert cannot create two rows for the same pair" — leave it
        // stale and the next upsert, computing the key from the new userId,
        // inserts a second row.
        Assert.Contains("jobScores", UserMergeService.CompositeKeyed);
        Assert.DoesNotContain("jobScores", UserMergeService.FieldOwned);
    }

    [Fact]
    public void The_key_format_this_merge_assumes_is_the_one_JobScore_actually_builds()
    {
        // The re-key splits on the first ':' after the userId prefix. If
        // KeyFor ever changed shape, the merge would quietly move nothing —
        // the regex would match no documents and the leak check would catch it
        // only after the fact.
        var key = ApplicationTracker.Core.Models.JobScore.KeyFor(Anon, "job-123");

        Assert.Equal($"{Anon}:job-123", key);
        Assert.StartsWith(Anon + ":", key);
    }

    [Fact]
    public void Quotas_are_not_merged()
    {
        // A daily rate limit, not user data. Merging it would let someone
        // reset their allowance by signing in.
        Assert.Contains("userQuotas", UserMergeService.NotMerged);
        Assert.DoesNotContain("userQuotas", UserMergeService.FieldOwned);
        Assert.DoesNotContain("userQuotas", UserMergeService.CompositeKeyed);
    }

    [Fact]
    public void The_singletons_name_the_database_they_live_in()
    {
        // profile and resumeFile are in jobmatch, interviewInsights is not.
        // Getting this wrong means looking for a document in the wrong
        // database, finding nothing, and reporting a clean merge.
        var byName = UserMergeService.Singletons.ToDictionary(x => x.Collection, x => x.InProfileDb);

        Assert.True(byName["profile"]);
        Assert.True(byName["resumeFile"]);
        Assert.False(byName["interviewInsights"]);
    }

    // ---- poolJobState: union of what the same person did -------------------

    [Theory]
    [InlineData(false, false, false, false, false, false)]
    [InlineData(true, false, false, false, true, false)]   // saved anonymously, kept
    [InlineData(false, false, false, true, false, true)]   // dismissed anonymously, kept
    [InlineData(true, false, false, true, true, true)]     // both actions survive
    [InlineData(false, true, true, false, true, true)]     // target's own flags survive
    public void Pool_state_takes_the_union_of_both_sessions(
        bool srcSaved, bool tgtSaved, bool srcDismissed, bool tgtDismissed,
        bool expectSaved, bool expectDismissed)
    {
        // Safe because the two flags are independent and both can already be
        // true at once — clear_saved sets SavedToTracker false without touching
        // Dismissed — so this reaches no state ordinary use cannot.
        var source = Row(Anon, saved: srcSaved, dismissed: srcDismissed, at: Utc(2026, 1, 1));
        var target = Row(Account, saved: tgtSaved, dismissed: tgtDismissed, at: Utc(2026, 1, 2));

        var merged = UserMergeService.CombinePoolState(target, source);

        Assert.Equal(expectSaved, merged["SavedToTracker"].AsBoolean);
        Assert.Equal(expectDismissed, merged["Dismissed"].AsBoolean);
    }

    [Fact]
    public void Pool_state_keeps_the_later_timestamp()
    {
        var source = Row(Anon, saved: true, dismissed: false, at: Utc(2026, 5, 1));
        var target = Row(Account, saved: false, dismissed: false, at: Utc(2026, 1, 1));

        var merged = UserMergeService.CombinePoolState(target, source);

        Assert.Equal(Utc(2026, 5, 1), merged["UpdatedAt"].ToUniversalTime());
    }

    [Fact]
    public void Pool_state_never_adopts_the_retired_user()
    {
        var source = Row(Anon, saved: true, dismissed: false, at: Utc(2026, 5, 1));
        var target = Row(Account, saved: false, dismissed: false, at: Utc(2026, 1, 1));

        var merged = UserMergeService.Combine("poolJobState", target, source);

        Assert.Equal(Account.ToString(), merged["UserId"].AsString);
        Assert.StartsWith(Account.ToString() + ":", merged["_id"].AsString);
    }

    // ---- jobScores: the newer opinion wins ---------------------------------

    [Fact]
    public void A_newer_score_replaces_an_older_one()
    {
        // A score is a point-in-time opinion computed against a profile. The
        // newer row reflects the more recent profile; keeping the older would
        // serve a stale verdict, and rescoring costs a Claude call.
        var target = Score(Account, 40, Utc(2026, 1, 1));
        var source = Score(Anon, 80, Utc(2026, 6, 1));

        var merged = UserMergeService.Combine("jobScores", target, source);

        Assert.Equal(80, merged["Score"].AsInt32);
        // ...but under the surviving account, and the surviving key.
        Assert.Equal(Account.ToString(), merged["UserId"].AsString);
        Assert.Equal(target["_id"].AsString, merged["_id"].AsString);
    }

    [Fact]
    public void An_older_score_does_not_overwrite_a_newer_one()
    {
        var target = Score(Account, 40, Utc(2026, 6, 1));
        var source = Score(Anon, 80, Utc(2026, 1, 1));

        var merged = UserMergeService.Combine("jobScores", target, source);

        Assert.Equal(40, merged["Score"].AsInt32);
        Assert.Equal(Account.ToString(), merged["UserId"].AsString);
    }

    [Fact]
    public void Reowning_rewrites_both_the_key_and_the_field()
    {
        // The whole point of the composite bucket: updating one without the
        // other is the bug.
        var doc = Score(Anon, 55, Utc(2026, 2, 2));

        var reowned = UserMergeService.Reown(doc, $"{Account}:job-1", Account);

        Assert.Equal($"{Account}:job-1", reowned["_id"].AsString);
        Assert.Equal(Account.ToString(), reowned["UserId"].AsString);
        Assert.DoesNotContain(Anon.ToString(), reowned.ToJson());
    }

    // ---- helpers -----------------------------------------------------------

    // BSON dates are UTC on the wire and the app only ever writes
    // DateTime.UtcNow, so a Kind.Unspecified literal here would compare off by
    // the local offset and test nothing real.
    private static DateTime Utc(int y, int m, int d) =>
        new(y, m, d, 0, 0, 0, DateTimeKind.Utc);

    private static BsonDocument Row(Guid user, bool saved, bool dismissed, DateTime at) => new()
    {
        { "_id", $"{user}:job-1" },
        { "UserId", user.ToString() },
        { "JobId", "job-1" },
        { "SavedToTracker", saved },
        { "Dismissed", dismissed },
        { "UpdatedAt", at },
    };

    private static BsonDocument Score(Guid user, int score, DateTime at) => new()
    {
        { "_id", $"{user}:job-1" },
        { "UserId", user.ToString() },
        { "JobId", "job-1" },
        { "Score", score },
        { "ScoredAt", at },
    };
}
