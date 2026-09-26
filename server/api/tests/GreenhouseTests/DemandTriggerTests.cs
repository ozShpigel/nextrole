using System.Text.Json;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// When the consumer starts a run for a new function or location. The Mongo
/// and queue sides are thin; the decisions are here, tested as they run.
/// </summary>
public class DemandTriggerTests
{
    private static readonly DateTime Now = new(2026, 9, 26, 12, 0, 0, DateTimeKind.Utc);
    private static readonly TimeSpan Cooldown = DemandTriggers.Cooldown;

    [Fact]
    public void Nothing_pending_does_nothing() =>
        Assert.Equal(TriggerAction.Nothing, DemandTriggers.Plan(0, null, Now, PrefilterMode.On, Cooldown));

    [Theory]
    [InlineData(PrefilterMode.Log)]
    [InlineData(PrefilterMode.Off)]
    public void Without_the_filter_on_requests_are_closed_not_run(PrefilterMode mode) =>
        // Nothing was skipped, so a run would only re-read what the next
        // scheduled run reads anyway -- at live prices.
        Assert.Equal(TriggerAction.Close, DemandTriggers.Plan(3, null, Now, mode, Cooldown));

    [Fact]
    public void The_first_request_runs_at_once() =>
        Assert.Equal(TriggerAction.Run, DemandTriggers.Plan(1, null, Now, PrefilterMode.On, Cooldown));

    [Fact]
    public void Requests_inside_the_cooldown_wait_and_share_the_next_run()
    {
        Assert.Equal(TriggerAction.Wait,
            DemandTriggers.Plan(2, Now.AddMinutes(-3), Now, PrefilterMode.On, Cooldown));
        Assert.Equal(TriggerAction.Run,
            DemandTriggers.Plan(2, Now - Cooldown, Now, PrefilterMode.On, Cooldown));
    }

    [Fact]
    public void A_message_from_before_live_reads_existed_is_not_live()
    {
        var old = JsonSerializer.Deserialize<CompanyMessage>(
            """{ "boardToken": "b", "day": "2026-09-26", "runId": "r" }""")!;
        Assert.False(old.Live);

        var live = JsonSerializer.Deserialize<CompanyMessage>(
            JsonSerializer.Serialize(new CompanyMessage { BoardToken = "b", Day = "d", RunId = "r", Live = true }))!;
        Assert.True(live.Live);
    }

    [Theory]
    [InlineData("On", 1, true)]
    [InlineData("Log", 1, false)]     // log mode never collects: nothing was skipped
    [InlineData("On", 5, false)]      // a stale heartbeat is a consumer that is not running
    public void Collecting_is_shown_only_for_a_live_consumer_that_acts(string mode, int minutesAgo, bool acting) =>
        Assert.Equal(acting, new ConsumerHeartbeat { Prefilter = mode, SeenAt = Now.AddMinutes(-minutesAgo) }
            .IsActingOnRequests(Now));
}
