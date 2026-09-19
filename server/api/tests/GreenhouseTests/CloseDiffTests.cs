using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The close/reopen diff and the empty-response guard.
/// </summary>
/// <remarks>
/// These run against <see cref="CloseDiff.Compute"/>, which is the code the
/// production path calls -- not a restatement of it. The failed-fetch guard is
/// not testable here by design; it is structural (BoardClient throws) and is
/// asserted in <see cref="CompanyHandlerTests"/> by proving the store is never
/// asked to close anything.
/// </remarks>
public class CloseDiffTests
{
    private const int Threshold = 10;

    [Fact]
    public void Closes_exactly_what_the_board_stopped_listing()
    {
        var decision = CloseDiff.Compute(
            storedOpenIds: [1, 2, 3, 4],
            seenIds: [1, 3],
            Threshold);

        Assert.False(decision.Skipped);
        Assert.Equal([2, 4], decision.Close.Order());
    }

    [Fact]
    public void Closes_nothing_when_the_board_still_lists_everything()
    {
        var decision = CloseDiff.Compute([1, 2, 3], [1, 2, 3], Threshold);

        Assert.False(decision.Skipped);
        Assert.Empty(decision.Close);
    }

    [Fact]
    public void A_job_that_is_new_this_run_is_not_a_close_candidate()
    {
        // Seen but not stored open. It is an insert, and must not appear in a
        // set built from stored ids.
        var decision = CloseDiff.Compute([1], [1, 99], Threshold);

        Assert.Empty(decision.Close);
    }

    [Fact]
    public void A_job_that_reappears_is_absent_from_the_close_set()
    {
        // The reopen half of the cycle: a closed job is not in storedOpenIds,
        // so it cannot be closed again, and seeing it drives the upsert that
        // clears closedAt. Proven end to end against real Mongo in
        // JobStoreIntegrationTests -- here it is the set arithmetic.
        var decision = CloseDiff.Compute(storedOpenIds: [1, 2], seenIds: [1, 2, 7], Threshold);

        Assert.Empty(decision.Close);
    }

    // ---- guard: empty response --------------------------------------------

    [Fact]
    public void An_empty_board_does_not_close_a_large_stored_set()
    {
        var open = Enumerable.Range(1, 40).Select(i => (long)i).ToList();

        var decision = CloseDiff.Compute(open, [], Threshold);

        Assert.True(decision.Skipped);
        Assert.Empty(decision.Close);
        Assert.Contains("40", decision.SkipReason);
    }

    [Fact]
    public void The_guard_fires_exactly_at_the_threshold()
    {
        var atThreshold = Enumerable.Range(1, Threshold).Select(i => (long)i).ToList();
        Assert.True(CloseDiff.Compute(atThreshold, [], Threshold).Skipped);

        var justUnder = atThreshold.Take(Threshold - 1).ToList();
        Assert.False(CloseDiff.Compute(justUnder, [], Threshold).Skipped);
    }

    [Fact]
    public void A_genuinely_small_board_can_still_empty()
    {
        // The guard must not be a one-way door. A board with three jobs really
        // can go to zero, and never closing those would leave them retrievable
        // forever.
        var decision = CloseDiff.Compute([1, 2, 3], [], Threshold);

        Assert.False(decision.Skipped);
        Assert.Equal([1, 2, 3], decision.Close.Order());
    }

    [Fact]
    public void An_empty_board_with_nothing_stored_is_simply_a_no_op()
    {
        var decision = CloseDiff.Compute([], [], Threshold);

        Assert.False(decision.Skipped);
        Assert.Empty(decision.Close);
    }

    [Fact]
    public void A_board_that_shrank_sharply_but_is_not_empty_still_closes()
    {
        // The guard is on an EMPTY response, not on a large delta. A board that
        // genuinely closed 39 of 40 roles should close 39 -- suppressing that
        // would need a different, more dangerous heuristic.
        var open = Enumerable.Range(1, 40).Select(i => (long)i).ToList();

        var decision = CloseDiff.Compute(open, [1], Threshold);

        Assert.False(decision.Skipped);
        Assert.Equal(39, decision.Close.Count);
    }
}
