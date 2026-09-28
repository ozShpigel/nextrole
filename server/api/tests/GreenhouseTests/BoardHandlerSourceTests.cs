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
        public int DetailCalls => DetailFor.Count;
        public List<string> DetailFor { get; } = [];
        public string Name => "fake";

        public Task<Listing> ListAsync(BoardConfig board, CancellationToken ct) => Task.FromResult(listing);

        public Task<SourcePosting?> DetailAsync(BoardConfig board, ListedPosting posting, CancellationToken ct)
        {
            DetailFor.Add(posting.SourceJobId);
            return Task.FromResult(detail(posting));
        }
    }

    private static ListedPosting Listed(string id) =>
        new(id, $"Engineer {id}", "Tel Aviv", Offices: [], Departments: [], PostedAt: null, UpdatedAt: null);

    private static SourcePosting Full(ListedPosting p) => new(p, Body, $"https://x/{p.SourceJobId}", "Test Co", null);

    /// <summary>A board on the fake source. Built directly: config load only accepts real sources.</summary>
    private static readonly BoardConfig Board = new() { Source = "fake", Token = Build.Token };

    private static BoardHandler Handler(IJobSource source, FakeJobStore store) =>
        new([source], new FakeEmbeddingClient(), store, BoardsConfig.ForTesting(Build.Token),
            NullLogger<BoardHandler>.Instance);

    [Fact]
    public async Task A_posting_whose_detail_failed_is_neither_stored_nor_closed()
    {
        var store = new FakeJobStore();
        store.Hashes["2"] = "stored-before";
        var source = new FakeSource(
            new Listing([Listed("1"), Listed("2")], Complete: true, Total: 2),
            p => p.SourceJobId == "2" ? null : Full(p));

        var result = await Handler(source, store).HandleBoardAsync(Board);

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

        var result = await Handler(source, store).HandleBoardAsync(Board);

        Assert.Equal(1, result.Embedded);
        Assert.Equal(0, store.CloseCalls);
        Assert.Equal(0, result.Closed);
    }

    [Fact]
    public async Task A_complete_listing_runs_the_close_diff_over_every_listed_id()
    {
        var store = new FakeJobStore();
        var source = new FakeSource(new Listing([Listed("1"), Listed("2")], Complete: true, Total: 2), Full);

        await Handler(source, store).HandleBoardAsync(Board);

        Assert.Equal(1, store.CloseCalls);
        Assert.Equal(["1", "2"], store.LastCloseSeenIds!.Order());
    }

    [Fact]
    public async Task A_listing_that_carries_its_details_is_never_asked_for_them()
    {
        var listed = Listed("1");
        var withDetail = listed with { Detail = Full(listed) };
        var source = new FakeSource(new Listing([withDetail], Complete: true, Total: 1), Full);

        await Handler(source, new FakeJobStore()).HandleBoardAsync(Board);

        Assert.Equal(0, source.DetailCalls);
    }

    [Fact]
    public async Task An_id_that_is_not_a_number_is_stored_as_it_is()
    {
        // Workday's jobReqId, Lever's UUIDs: the stored key is a string since
        // 2b, so the handler no longer has to drop them (phase 1 did).
        var store = new FakeJobStore();
        var source = new FakeSource(new Listing([Listed("R-12"), Listed("5")], Complete: true, Total: 2), Full);

        var result = await Handler(source, store).HandleBoardAsync(Board);

        Assert.Equal(2, result.Fetched);
        Assert.Equal(["5", "R-12"], store.Hashes.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(["5", "R-12"], store.LastCloseSeenIds!.Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task A_blank_id_is_dropped_before_anything_is_written()
    {
        var store = new FakeJobStore();
        var source = new FakeSource(new Listing([Listed(" "), Listed("5")], Complete: true, Total: 2), Full);

        var result = await Handler(source, store).HandleBoardAsync(Board);

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

        await Handler(source, store).HandleBoardAsync(Board);

        Assert.Equal([$"fake:{Build.Token}"], store.BoardsSeen);
    }

    // ---- the two-stage pre-read filter (docs/plans/two-stage-prefilter.md) -------

    private static readonly DateTime LongAgo = DateTime.UtcNow.AddDays(-200);

    private static ListedPosting At(string id, string location) => Listed(id) with { Location = location };

    private static BoardHandler Filtering(IJobSource source, FakeJobStore store, PrefilterMode mode = PrefilterMode.On) =>
        new([source], new FakeEmbeddingClient(), store,
            BoardsConfig.Parse($$"""{ "companies": ["{{Build.Token}}"], "served_locations": ["Tel Aviv"] }"""),
            NullLogger<BoardHandler>.Instance, prefilter: mode);

    [Fact]
    public async Task A_posting_the_listing_rules_out_gets_no_detail_request()
    {
        var store = new FakeJobStore();
        var source = new FakeSource(
            new Listing([At("1", "Tokyo, Japan"), At("2", "Tel Aviv")], Complete: true, Total: 2), Full);

        var result = await Filtering(source, store).HandleBoardAsync(Board);

        Assert.Equal(["2"], source.DetailFor);                 // never asked for "1"
        Assert.Equal(["2"], store.Hashes.Keys);
        Assert.Equal(1, result.Prefiltered);
        Assert.Contains("1", store.LastCloseSeenIds!);         // still listed: nothing to close
    }

    [Fact]
    public async Task A_posting_the_detail_dates_too_old_is_read_then_skipped_before_any_cost()
    {
        // Workday's listing says only "Posted 30+ Days Ago": no date, so stage 1
        // reads it. The detail has the exact date, and stage 2 applies the rule.
        var store = new FakeJobStore();
        var embeddings = new FakeEmbeddingClient();
        var source = new FakeSource(
            new Listing([Listed("1")], Complete: true, Total: 1),
            p => Full(p with { PostedAt = LongAgo }));

        var result = await new BoardHandler([source], embeddings, store,
                BoardsConfig.Parse($$"""{ "companies": ["{{Build.Token}}"], "served_locations": ["Tel Aviv"] }"""),
                NullLogger<BoardHandler>.Instance, prefilter: PrefilterMode.On)
            .HandleBoardAsync(Board);

        Assert.Equal(["1"], source.DetailFor);
        Assert.Empty(store.Hashes);
        Assert.Empty(embeddings.Batches);
        Assert.Equal(1, result.Prefiltered);
    }

    [Fact]
    public async Task Stage_two_applies_the_whole_rule_not_only_the_age()
    {
        // "3 Locations" resolves to nothing, so the listing cannot rule it out;
        // the detail names the places, and none of them is served.
        var store = new FakeJobStore();
        var source = new FakeSource(
            new Listing([At("1", "3 Locations")], Complete: true, Total: 1),
            p => Full(p with { Location = "Tokyo, Japan" }));

        var result = await Filtering(source, store).HandleBoardAsync(Board);

        Assert.Equal(["1"], source.DetailFor);
        Assert.Empty(store.Hashes);
        Assert.Equal(1, result.Prefiltered);
    }

    [Fact]
    public async Task Log_mode_requests_every_detail_and_skips_nothing()
    {
        var store = new FakeJobStore();
        var source = new FakeSource(
            new Listing([At("1", "Tokyo, Japan"), At("2", "Tel Aviv")], Complete: true, Total: 2), Full);

        var result = await Filtering(source, store, PrefilterMode.Log).HandleBoardAsync(Board);

        Assert.Equal(["1", "2"], source.DetailFor);
        Assert.Equal(["1", "2"], store.Hashes.Keys.Order());
        Assert.Equal(0, result.Prefiltered);
    }

    [Fact]
    public async Task A_stored_posting_is_never_filtered_at_either_stage()
    {
        // Already paid for; skipping it would stop its touch and leave it to the close diff.
        var store = new FakeJobStore();
        store.Hashes["1"] = "stored-before";
        var source = new FakeSource(
            new Listing([At("1", "Tokyo, Japan")], Complete: true, Total: 1),
            p => Full(p with { PostedAt = LongAgo }));

        var result = await Filtering(source, store).HandleBoardAsync(Board);

        Assert.Equal(["1"], source.DetailFor);
        Assert.NotEqual("stored-before", store.Hashes["1"]);   // read and re-stored, not skipped
        Assert.Equal(0, result.Prefiltered);
    }

    private sealed class Lines : Microsoft.Extensions.Logging.ILogger<BoardHandler>
    {
        public List<string> All { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel level) => true;
        public void Log<TState>(Microsoft.Extensions.Logging.LogLevel level, Microsoft.Extensions.Logging.EventId id,
            TState state, Exception? e, Func<TState, Exception?, string> format) => All.Add(format(state, e));
    }

    [Fact]
    public async Task Log_mode_counts_each_posting_at_one_stage_only()
    {
        // In Log mode nothing is skipped, so a posting the listing rules out is
        // still read in full. Stage 2 must not decide it again, or the line the
        // filter is judged by before it goes On would count it twice.
        var log = new Lines();
        var source = new FakeSource(
            new Listing([At("1", "Tokyo, Japan"), At("2", "Tel Aviv")], Complete: true, Total: 2), Full);

        await new BoardHandler([source], new FakeEmbeddingClient(), new FakeJobStore(),
                BoardsConfig.Parse($$"""{ "companies": ["{{Build.Token}}"], "served_locations": ["Tel Aviv"] }"""),
                log, prefilter: PrefilterMode.Log)
            .HandleBoardAsync(Board);

        var line = Assert.Single(log.All, l => l.Contains("pre-read filter (Log)"));
        Assert.Contains("1 of 2 new posting(s) would be skipped (1 from the listing, 0 after the detail)", line);
    }
}
