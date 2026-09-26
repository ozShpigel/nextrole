using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// A board removed from companies.json is never fetched again, so nothing but
/// this closes its postings. Closing is recoverable -- re-adding reopens -- so
/// the only guard is against the whole file being wrong.
/// </summary>
public class RemovedBoardsTests
{
    private static readonly Dictionary<string, long> ThreeBoards = new()
    {
        ["similarweb"] = 67, ["monzo"] = 71, ["deliveroo"] = 148,
    };

    [Fact]
    public void A_removed_board_is_closed()
    {
        var plan = RemovedBoards.Plan(ThreeBoards, ["similarweb", "deliveroo"]);

        Assert.True(plan.Close);
        Assert.Equal(["monzo"], plan.Removed);
        Assert.Equal(71, plan.RemovedOpen);
    }

    [Fact]
    public void Nothing_removed_closes_nothing()
    {
        var plan = RemovedBoards.Plan(ThreeBoards, ["similarweb", "monzo", "deliveroo", "stripe"]);

        Assert.Empty(plan.Removed);
        Assert.False(plan.Close);
    }

    [Fact]
    public void Tokens_compare_case_insensitively_like_the_config_does()
    {
        // CompaniesConfig de-dupes case-insensitively; "Monzo" in the file is
        // the monzo board, not a removal of it.
        Assert.Empty(RemovedBoards.Plan(ThreeBoards, ["Similarweb", "MONZO", "deliveroo"]).Removed);
    }

    [Fact]
    public void The_wrong_companies_file_is_refused()
    {
        // The box started with companies.dev.json (one board): 215 of 286
        // open postings would close in one pass.
        var plan = RemovedBoards.Plan(ThreeBoards, ["similarweb"]);

        Assert.False(plan.Close);
        Assert.Equal(["deliveroo", "monzo"], plan.Removed);
        Assert.Equal(219, plan.RemovedOpen);
    }

    [Fact]
    public async Task Closes_through_the_store_and_reports_what_it_closed()
    {
        var store = new FakeJobStore();
        foreach (var (b, n) in ThreeBoards) store.OpenByBoard[b] = n;

        var closed = await new RemovedBoards(store, NullLogger<RemovedBoards>.Instance)
            .CloseAsync(["similarweb", "deliveroo"], DateTime.UtcNow, CancellationToken.None);

        Assert.Equal(71, closed);
        Assert.Equal(["monzo"], store.ClosedBoards);
    }

    [Fact]
    public async Task A_refused_close_touches_nothing()
    {
        var store = new FakeJobStore();
        foreach (var (b, n) in ThreeBoards) store.OpenByBoard[b] = n;

        var closed = await new RemovedBoards(store, NullLogger<RemovedBoards>.Instance)
            .CloseAsync(["similarweb"], DateTime.UtcNow, CancellationToken.None);

        Assert.Equal(0, closed);
        Assert.Empty(store.ClosedBoards);
    }
}
