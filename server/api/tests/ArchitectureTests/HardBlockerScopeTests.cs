using ApplicationTracker.Core.Matching;

namespace ArchitectureTests;

/// <summary>
/// Which hard blockers survive the server, now that the default is DROP.
/// </summary>
/// <remarks>
/// <para>
/// A hard blocker forces <c>STRONG_NO</c> over every score in the response, so
/// a false one does not shade a number — it deletes a job the candidate should
/// have seen, with nothing in the UI saying why. That asymmetry is why this is
/// an allow-list, and why it is tested.
/// </para>
/// <para>
/// The old rule was <c>_ =&gt; true</c> with no test behind it, which is how
/// <c>people_management</c> came to disqualify five real postings over
/// mentoring and interview panels, inconsistently between runs on identical
/// input.
/// </para>
/// </remarks>
public class HardBlockerScopeTests
{
    private static HardBlocker Blocker(string filter, string reason = "because") =>
        new() { Filter = filter, Reason = reason };

    // ── The one that survives ───────────────────────────────────────────────

    [Fact]
    public void Work_arrangement_stands_on_the_candidates_stated_constraint()
    {
        // Deliberately unchecked: the constraint is free text in the profile,
        // and a weak proxy would be worse than an honest gap.
        Assert.True(HardBlockerScope.IsSupported(
            Blocker("work_arrangement", "Five days on-site; you stated remote-only.")));
    }

    // ── The four that were removed ──────────────────────────────────────────

    [Theory]
    [InlineData("candidate_dealbreaker")]
    [InlineData("people_management")]
    [InlineData("scope_discipline")]
    [InlineData("sustainability_signals")]
    public void A_removed_filter_is_dropped_even_though_it_used_to_be_trusted(string filter)
    {
        // Each of these passed unconditionally under `_ => true`. They are the
        // regression this file exists for: the prompt no longer names them, but
        // a model running against a cached or edited prompt still might, and
        // the consequence of trusting one is a deleted job.
        Assert.False(HardBlockerScope.IsSupported(
            Blocker(filter, "Mentoring and hiring listed as required skills.")));
    }

    [Fact]
    public void The_measured_people_management_misfire_would_now_be_dropped()
    {
        // Verbatim from a real response: fired on a posting whose only relevant
        // text was "Mentor & Hire: … take an active role in conducting
        // engineering interviews", forcing STRONG_NO on a 62-point match.
        var b = Blocker(
            "people_management",
            "Mentoring and hiring listed as required skills; no formal management experience demonstrated.");

        Assert.False(HardBlockerScope.IsSupported(b));
    }

    [Fact]
    public void The_measured_dealbreaker_misfire_would_now_be_dropped()
    {
        // The Unframe card, 2026-10-03: an 81-point match forced to STRONG_NO
        // because the job description read as an early-stage startup. The
        // company is Series B with ~170 people; the Evaluator saw no company
        // data, only the posting's wording.
        var b = Blocker("candidate_dealbreaker", "Early-stage startup (candidate red flag)");

        Assert.False(HardBlockerScope.IsSupported(b));
    }

    // ── Anything else ───────────────────────────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("salary")]
    [InlineData("seniority_mismatch")]
    [InlineData("work_arrangements")]   // a plausible typo/rename
    public void An_unrecognised_filter_is_dropped(string filter)
    {
        Assert.False(HardBlockerScope.IsSupported(Blocker(filter)));
    }

    [Fact]
    public void Filter_matching_ignores_case()
    {
        Assert.True(HardBlockerScope.IsSupported(Blocker("WORK_ARRANGEMENT")));
    }

    [Fact]
    public void A_null_blocker_is_dropped_rather_than_thrown_on()
    {
        Assert.False(HardBlockerScope.IsSupported(null!));
    }
}
