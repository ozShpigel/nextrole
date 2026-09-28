using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The handler's side of the source contract: what it does with a listing it
/// cannot fully trust. Greenhouse never produces these cases -- its listing
/// carries every detail and proves its own count -- so they are driven through
/// a fake source, ahead of the adapters that will.
/// </summary>
public class BoardHandlerSourceTests
{
    private static readonly string Body = "&lt;p&gt;" + new string('a', 400) + "&lt;/p&gt;";

    private sealed class FakeSource(Listing listing, Func<ListedPosting, SourcePosting?> detail) : IJobSource
    {
        public int DetailCalls { get; private set; }
        public string Name => "fake";

        public Task<Listing> ListAsync(string boardToken, CancellationToken ct) => Task.FromResult(listing);

        public Task<SourcePosting?> DetailAsync(string boardToken, ListedPosting posting, CancellationToken ct)
        {
            DetailCalls++;
            return Task.FromResult(detail(posting));
        }
    }

    private static ListedPosting Listed(string id) =>
        new(id, $"Engineer {id}", "Tel Aviv", Offices: [], Departments: [], PostedAt: null, UpdatedAt: null);

    private static SourcePosting Full(ListedPosting p) => new(p, Body, $"https://x/{p.SourceJobId}", "Test Co", null);

    private static BoardHandler Handler(IJobSource source, FakeJobStore store) =>
        new(source, new FakeEmbeddingClient(), store, CompaniesConfig.ForTesting(Build.Token),
            NullLogger<BoardHandler>.Instance);

    [Fact]
    public async Task A_posting_whose_detail_failed_is_neither_stored_nor_closed()
    {
        var store = new FakeJobStore();
        store.Hashes["2"] = "stored-before";
        var source = new FakeSource(
            new Listing([Listed("1"), Listed("2")], Complete: true, Total: 2),
            p => p.SourceJobId == "2" ? null : Full(p));

        var result = await Handler(source, store).HandleCompanyAsync(Build.Token);

        Assert.Equal(2, result.Fetched);
        Assert.Equal(1, result.Embedded);
        Assert.Equal("stored-before", store.Hashes["2"]);       // not rewritten
        Assert.DoesNotContain("2", store.Touched);             // not marked seen as if read
        Assert.Contains("2", store.LastCloseSeenIds!);         // but present: the diff leaves it open
    }

    [Fact]
    public async Task A_listing_that_cannot_prove_it_is_whole_stores_but_closes_nothing()
    {
        var store = new FakeJobStore();
        var source = new FakeSource(new Listing([Listed("1")], Complete: false, Total: null), Full);

        var result = await Handler(source, store).HandleCompanyAsync(Build.Token);

        Assert.Equal(1, result.Embedded);
        Assert.Equal(0, store.CloseCalls);
        Assert.Equal(0, result.Closed);
    }

    [Fact]
    public async Task A_complete_listing_runs_the_close_diff_over_every_listed_id()
    {
        var store = new FakeJobStore();
        var source = new FakeSource(new Listing([Listed("1"), Listed("2")], Complete: true, Total: 2), Full);

        await Handler(source, store).HandleCompanyAsync(Build.Token);

        Assert.Equal(1, store.CloseCalls);
        Assert.Equal(["1", "2"], store.LastCloseSeenIds!.Order());
    }

    [Fact]
    public async Task A_listing_that_carries_its_details_is_never_asked_for_them()
    {
        var listed = Listed("1");
        var withDetail = listed with { Detail = Full(listed) };
        var source = new FakeSource(new Listing([withDetail], Complete: true, Total: 1), Full);

        await Handler(source, new FakeJobStore()).HandleCompanyAsync(Build.Token);

        Assert.Equal(0, source.DetailCalls);
    }

    [Fact]
    public async Task An_id_that_is_not_a_number_is_stored_as_it_is()
    {
        // Workday's jobReqId, Lever's UUIDs: the stored key is a string since
        // 2b, so the handler no longer has to drop them (phase 1 did).
        var store = new FakeJobStore();
        var source = new FakeSource(new Listing([Listed("R-12"), Listed("5")], Complete: true, Total: 2), Full);

        var result = await Handler(source, store).HandleCompanyAsync(Build.Token);

        Assert.Equal(2, result.Fetched);
        Assert.Equal(["5", "R-12"], store.Hashes.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(["5", "R-12"], store.LastCloseSeenIds!.Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task A_blank_id_is_dropped_before_anything_is_written()
    {
        var store = new FakeJobStore();
        var source = new FakeSource(new Listing([Listed(" "), Listed("5")], Complete: true, Total: 2), Full);

        var result = await Handler(source, store).HandleCompanyAsync(Build.Token);

        Assert.Equal(1, result.Fetched);
        Assert.Equal(["5"], store.Hashes.Keys);
        Assert.Equal(["5"], store.LastCloseSeenIds!);
    }

    [Fact]
    public async Task Every_per_board_store_call_is_given_the_source_qualified_board_key()
    {
        // The whole of 2b in one assertion: a call still given the bare token
        // would match no row, and a key mismatch reads as "every posting is new".
        var store = new FakeJobStore();
        var source = new FakeSource(new Listing([Listed("1")], Complete: true, Total: 1), Full);

        await Handler(source, store).HandleCompanyAsync(Build.Token);

        Assert.Equal([$"fake:{Build.Token}"], store.BoardsSeen);
    }
}
