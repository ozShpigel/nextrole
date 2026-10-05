using ApplicationTracker.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>A posting an adapter's healthy fixture must produce, and how.</summary>
/// <param name="Text">A phrase from the body that must survive cleaning.</param>
public sealed record ExpectedPosting(string Id, string Title, DateTime? PostedAt, DateTime? UpdatedAt, string Text);

/// <summary>
/// What every <see cref="IJobSource"/> must do, run against each adapter's own
/// canned responses. Adding a source is writing its fixtures and passing this.
/// </summary>
/// <remarks>
/// <para>
/// The failures that matter most here have no symptom. A short list read as
/// the whole board closes every posting it missed; a date mapped to the wrong
/// field hides a live posting behind the age rule; content that is not cleaned
/// is hashed stably as markup and never re-read. Each is a clean run with
/// plausible counts, so each is asserted rather than trusted.
/// </para>
/// <para>
/// A derived class supplies sources over canned HTTP. Each factory call must
/// return a fresh source with fresh responses, so two calls are two runs.
/// </para>
/// </remarks>
public abstract class JobSourceContract
{
    /// <summary>
    /// The board every call is made for. A source whose boards carry more than
    /// a token (Workday: host, tenant, site) supplies one of its own.
    /// </summary>
    protected virtual BoardConfig Board { get; } = new() { Source = "contract", Token = "contract-board" };

    /// <summary>A source over a healthy board holding exactly <see cref="Expected"/>.</summary>
    protected abstract IJobSource Healthy();

    protected abstract IReadOnlyList<ExpectedPosting> Expected { get; }

    /// <summary>A source whose listing request fails with a 5xx.</summary>
    protected abstract IJobSource ServerError();

    /// <summary>A source whose listing body does not parse (a truncated download, a login page).</summary>
    protected abstract IJobSource Unparseable();

    /// <summary>
    /// A source whose listing is shorter than the board's own count, or null
    /// when the source's API gives no count at all.
    /// </summary>
    /// <remarks>
    /// Null is not a free pass: <see cref="A_short_listing_is_never_reported_as_complete"/>
    /// then asserts the healthy listing really carries no total, so a source
    /// that has one cannot opt out of checking it.
    /// </remarks>
    protected abstract IJobSource? Truncated();

    /// <summary>
    /// Whether a healthy listing proves itself whole. True for every company
    /// board. False for a search (LinkedIn), which returns a slice by nature:
    /// for it the contract is the opposite -- it must NEVER report complete,
    /// or the close diff would close every posting missing from one search.
    /// </summary>
    protected virtual bool ProvesCompleteness => true;

    [Fact]
    public async Task A_failed_request_throws() =>
        await Assert.ThrowsAsync<BoardFetchException>(() => ServerError().ListAsync(Board, default));

    [Fact]
    public async Task An_unparseable_body_throws() =>
        await Assert.ThrowsAsync<BoardFetchException>(() => Unparseable().ListAsync(Board, default));

    [Fact]
    public async Task A_short_listing_is_never_reported_as_complete()
    {
        var source = Truncated();
        if (source is null)
        {
            Assert.Null((await Healthy().ListAsync(Board, default)).Total);
            return;
        }

        Listing? listing = null;
        try { listing = await source.ListAsync(Board, default); }
        catch (BoardFetchException) { return; }

        Assert.False(listing.Complete, "A listing shorter than the board's count was reported complete.");
    }

    [Fact]
    public async Task A_healthy_board_is_complete_with_every_posting()
    {
        var listing = await Healthy().ListAsync(Board, default);

        Assert.Equal(ProvesCompleteness, listing.Complete);
        Assert.Equal(Expected.Select(e => e.Id).Order(), listing.Postings.Select(p => p.SourceJobId).Order());
    }

    [Fact]
    public async Task Ids_are_present_unique_and_stable_across_runs()
    {
        var first = (await Healthy().ListAsync(Board, default)).Postings.Select(p => p.SourceJobId).ToList();
        var second = (await Healthy().ListAsync(Board, default)).Postings.Select(p => p.SourceJobId).ToList();

        Assert.All(first, id => Assert.False(string.IsNullOrWhiteSpace(id)));
        Assert.Equal(first.Count, first.Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(first.Order(), second.Order());
    }

    [Fact]
    public async Task Titles_and_dates_map_to_the_right_fields_in_utc()
    {
        // On the posting as read in full: that is what is stored and what the
        // filter's second stage judges. A listing may carry no date at all
        // (Workday's says "Posted 30+ Days Ago"); for Greenhouse the listing
        // and the detail are one.
        var source = Healthy();
        var listed = new Dictionary<string, ListedPosting>();
        foreach (var posting in (await source.ListAsync(Board, default)).Postings)
            listed[posting.SourceJobId] = (posting.Detail ?? await source.DetailAsync(Board, posting, default))!.Listed;

        foreach (var e in Expected)
        {
            var p = listed[e.Id];
            Assert.Equal(e.Title, p.Title);
            Assert.Equal(e.PostedAt, p.PostedAt);
            Assert.Equal(e.UpdatedAt, p.UpdatedAt);
            if (p.PostedAt is { } posted) Assert.Equal(DateTimeKind.Utc, posted.Kind);
            if (p.UpdatedAt is { } updated) Assert.Equal(DateTimeKind.Utc, updated.Kind);
        }
    }

    [Fact]
    public async Task Every_posting_reads_in_full_and_cleans_to_plain_text()
    {
        var source = Healthy();
        var listing = await source.ListAsync(Board, default);

        foreach (var posting in listing.Postings)
        {
            var detail = posting.Detail ?? await source.DetailAsync(Board, posting, default);

            Assert.NotNull(detail);
            Assert.Equal(posting.SourceJobId, detail.Listed.SourceJobId);

            // Through the shared cleaner, exactly as the handler stores it.
            var cleaned = GreenhouseJob.From("contract", Board.Token, detail).CleanedContent;
            var expected = Expected.Single(e => e.Id == posting.SourceJobId);

            Assert.Contains(expected.Text, cleaned);
            Assert.DoesNotContain("<", cleaned);
            Assert.DoesNotContain("&lt;", cleaned);
            Assert.DoesNotContain("&amp;", cleaned);
        }
    }
}
