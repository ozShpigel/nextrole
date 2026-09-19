using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The double decode, and the trailing-boilerplate strip.
/// </summary>
/// <remarks>
/// Worth its own file because the failure is silent and self-perpetuating: text
/// cleaned wrongly is still hashed stably, so every later run compares an
/// unchanged hash and skips. Nothing re-reads it, ever.
///
/// The encoding these tests assert is measured, not assumed -- the real
/// endpoint returns <c>&amp;lt;h2&amp;gt;&amp;lt;strong&amp;gt;Who we are</c>
/// for Stripe's board.
/// </remarks>
public class ContentCleanerTests
{
    [Fact]
    public void Decodes_the_entity_encoded_html_before_stripping_tags()
    {
        // The shape the API actually returns. A tag-stripping regex run against
        // this matches nothing, because there are no real tags yet.
        var raw = "&lt;h2&gt;&lt;strong&gt;About the role&lt;/strong&gt;&lt;/h2&gt;"
                + "&lt;p&gt;You will build things.&lt;/p&gt;";

        var cleaned = ContentCleaner.Clean(raw);

        Assert.DoesNotContain("<", cleaned);
        Assert.DoesNotContain("&lt;", cleaned);
        Assert.DoesNotContain("h2", cleaned);
        Assert.Contains("About the role", cleaned);
        Assert.Contains("You will build things.", cleaned);
    }

    [Fact]
    public void Handles_plain_html_too_in_case_a_board_ever_stops_encoding()
    {
        var cleaned = ContentCleaner.Clean("<p>Build things</p><p>With people</p>");

        Assert.DoesNotContain("<", cleaned);
        Assert.Contains("Build things", cleaned);
        Assert.Contains("With people", cleaned);
    }

    [Fact]
    public void Resolves_entities_that_lived_inside_the_html()
    {
        // Double-encoded: &amp;amp; survives the first decode as &amp; and
        // needs the second to become '&'. One decode leaves "R&amp;D" in the
        // stored text and in the embedded text.
        var cleaned = ContentCleaner.Clean("&lt;p&gt;R&amp;amp;D and&amp;nbsp;design&lt;/p&gt;");

        Assert.Contains("R&D", cleaned);
        Assert.DoesNotContain("&amp;", cleaned);
        Assert.DoesNotContain("&nbsp;", cleaned);
    }

    [Fact]
    public void Turns_a_bullet_list_into_separate_lines()
    {
        // Without block-level breaks every requirement runs into the next as
        // one paragraph, which is worse to embed and unreadable when stored.
        var cleaned = ContentCleaner.Clean(
            "&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;li&gt;Kubernetes&lt;/li&gt;&lt;li&gt;Postgres&lt;/li&gt;&lt;/ul&gt;");

        var lines = cleaned.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(["Go", "Kubernetes", "Postgres"], lines);
    }

    [Fact]
    public void Drops_script_and_style_content_entirely()
    {
        var cleaned = ContentCleaner.Clean(
            "&lt;p&gt;Real text&lt;/p&gt;&lt;script&gt;var x = 1;&lt;/script&gt;");

        Assert.Contains("Real text", cleaned);
        Assert.DoesNotContain("var x", cleaned);
    }

    [Fact]
    public void Normalises_non_breaking_spaces()
    {
        // Whitespace to a reader, a distinct codepoint to SHA-256. Left in, a
        // board swapping one for a plain space re-embeds its whole board.
        //   as an ESCAPE, not a literal character. A literal one is one
        // file rewrite away from being replaced by a plain space, at which
        // point this becomes Assert.Equal(a, a) and passes forever. The
        // NotEqual below is the guard on the guard.
        const string nbsp = "&lt;p&gt;Senior Engineer&lt;/p&gt;";
        const string plain = "&lt;p&gt;Senior Engineer&lt;/p&gt;";

        Assert.NotEqual(nbsp, plain);
        Assert.Equal(ContentCleaner.Clean(plain), ContentCleaner.Clean(nbsp));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Empty_input_is_empty_output(string? input)
    {
        Assert.Equal("", ContentCleaner.Clean(input));
    }

    // ---- trailing boilerplate ---------------------------------------------

    private static string Body(int paragraphs, string text = "We need someone who knows Go and Kubernetes.") =>
        string.Concat(Enumerable.Repeat($"&lt;p&gt;{text}&lt;/p&gt;", paragraphs));

    [Fact]
    public void Strips_a_trailing_eeo_section()
    {
        var raw = Body(12)
            + "&lt;h3&gt;Equal Employment Opportunity&lt;/h3&gt;"
            + "&lt;p&gt;We are an equal opportunity employer and value diversity.&lt;/p&gt;";

        var cleaned = ContentCleaner.Clean(raw);

        Assert.Contains("Kubernetes", cleaned);
        Assert.DoesNotContain("Equal Employment Opportunity", cleaned);
        Assert.DoesNotContain("value diversity", cleaned);
    }

    [Fact]
    public void Does_not_cut_at_a_heading_near_the_top()
    {
        // A posting that OPENS with its EEO statement keeps it. Cutting there
        // would delete the entire job description.
        var raw = "&lt;h3&gt;Equal Employment Opportunity&lt;/h3&gt;" + Body(12);

        var cleaned = ContentCleaner.Clean(raw);

        Assert.Contains("Kubernetes", cleaned);
        Assert.Contains("Equal Employment Opportunity", cleaned);
    }

    [Fact]
    public void Does_not_cut_at_the_word_inside_a_sentence()
    {
        // The single most damaging false positive: an unanchored match would
        // truncate the posting at its first mention of the word, removing the
        // requirements this source exists to retrieve on.
        var raw = Body(12) + "&lt;p&gt;"
            + "You will partner with our legal team on pay transparency reporting and accommodations tooling, "
            + "building the data pipelines that back it in Go."
            + "&lt;/p&gt;";

        var cleaned = ContentCleaner.Clean(raw);

        Assert.Contains("pay transparency reporting", cleaned);
        Assert.Contains("building the data pipelines", cleaned);
    }

    [Fact]
    public void Keeps_the_original_when_the_cut_would_gut_the_posting()
    {
        // A boilerplate heading in the last third of a SHORT posting. Cutting
        // would leave almost nothing, so the original is the safer answer.
        var raw = "&lt;p&gt;Go engineer.&lt;/p&gt;&lt;h3&gt;Pay transparency&lt;/h3&gt;"
                + "&lt;p&gt;" + new string('x', 400) + "&lt;/p&gt;";

        var cleaned = ContentCleaner.Clean(raw);

        Assert.Contains("Go engineer.", cleaned);
        Assert.Contains("Pay transparency", cleaned);
    }

    [Fact]
    public void A_posting_with_no_boilerplate_is_returned_intact()
    {
        var raw = Body(12);
        var cleaned = ContentCleaner.Clean(raw);

        Assert.Equal(12, cleaned.Split('\n', StringSplitOptions.RemoveEmptyEntries).Length);
    }

    [Fact]
    public void Cleaning_is_stable_so_an_unchanged_posting_keeps_its_hash()
    {
        // The skip depends on this. If Clean were non-deterministic -- an
        // unordered set anywhere in it -- every run would re-embed every job
        // and nothing would look wrong except the bill.
        var raw = Body(12) + "&lt;h3&gt;Privacy Notice&lt;/h3&gt;&lt;p&gt;We store data.&lt;/p&gt;";

        Assert.Equal(ContentCleaner.Clean(raw), ContentCleaner.Clean(raw));
    }
}
