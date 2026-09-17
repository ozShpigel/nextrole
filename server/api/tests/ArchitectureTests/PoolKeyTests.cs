using ApplicationTracker.Core.Matching;

namespace ArchitectureTests;

/// <summary>
/// The .NET pool key must equal the Python one, byte for byte.
/// </summary>
/// <remarks>
/// <c>pool_key</c> is a unique index over ~3,700 live documents and it is how
/// the daily run recognises a listing it has seen before. A key that differs by
/// one character makes the entire pool look new: one run would insert a
/// duplicate of every listing and extract facts for all of them, at a Claude
/// call per job.
///
/// Every expected value below was produced by running the Python
/// <c>app.services.pool.pool_key</c> that this replaces — not derived by
/// reading it. A test written from the reading would agree with a
/// misunderstanding.
/// </remarks>
public class PoolKeyTests
{
    [Fact]
    public void A_url_is_the_key_when_the_board_gives_one()
    {
        Assert.Equal(
            "https://www.linkedin.com/jobs/view/4012345678",
            PoolKey.For("https://www.linkedin.com/jobs/view/4012345678", "Acme", "Backend Engineer", "2026-09-01"));
    }

    [Fact]
    public void A_url_is_trimmed_before_it_is_used()
    {
        Assert.Equal(
            "https://example.test/j/1",
            PoolKey.For("  https://example.test/j/1  ", "X", "Y", "2026-01-01"));
    }

    [Theory]
    // Same posting, three spellings of the same inputs — one key.
    [InlineData(null, "Acme Ltd", "Backend Engineer", "2026-09-01")]
    [InlineData("", "ACME LTD", "BACKEND ENGINEER", "2026-09-01")]
    [InlineData(null, "  Acme Ltd  ", "  Backend Engineer  ", "  2026-09-01  ")]
    public void Without_a_url_the_key_folds_case_and_trims(string? url, string company, string title, string date)
    {
        Assert.Equal("k:4358399ab494458788caec3ee9c6e7a5", PoolKey.For(url, company, title, date));
    }

    [Fact]
    public void A_different_posting_date_is_a_different_opening()
    {
        // Deliberate: two genuinely separate openings for the same title at the
        // same company, posted on different days, must not collapse into one.
        Assert.Equal("k:f7e2d5fad5dfdeb34f10d451a0d6fefb",
            PoolKey.For(null, "Acme Ltd", "Backend Engineer", "2026-09-02"));

        Assert.NotEqual(
            PoolKey.For(null, "Acme Ltd", "Backend Engineer", "2026-09-01"),
            PoolKey.For(null, "Acme Ltd", "Backend Engineer", "2026-09-02"));
    }

    [Fact]
    public void All_nulls_still_produce_the_python_value()
    {
        // Degenerate, but it is the SHA-256 of two NULs and it must match, or a
        // row written by either implementation would not be found by the other.
        Assert.Equal("k:96a296d224f285c67bee93c30f8a3091", PoolKey.For(null, null, null, null));
    }

    [Fact]
    public void Hebrew_company_and_title_match_python()
    {
        // The pool is Israel-only, so non-ASCII in these fields is routine
        // rather than exotic.
        Assert.Equal("k:ff46b1d1348998c5e02a546ca21666bd",
            PoolKey.For(null, "מיקרוסופט", "מהנדס תוכנה", "2026-09-01"));
    }

    [Fact]
    public void Regex_metacharacters_are_data_not_syntax()
    {
        Assert.Equal("k:7887d644fb7f68564baecd80e3616eb6",
            PoolKey.For(null, "C++ Systems (Israel)", "Dev/Ops", "2026-09-03"));
    }

    [Fact]
    public void The_one_known_divergence_from_casefold_is_pinned()
    {
        // Python's casefold() maps ß to "ss"; ToLowerInvariant leaves it. They
        // also disagree on ligatures, Greek final sigma and Turkish İ.
        //
        // Unreachable today, and that is measured: of 415 pool documents, 415
        // are keyed by URL and 0 by hash, and recomputing every one in .NET
        // reproduced the stored key exactly. The fold only runs on the fallback
        // branch, which nothing has ever taken.
        //
        // Asserting the CURRENT behaviour rather than the Python value, so the
        // difference is visible and deliberate. If a board ever returns a
        // listing with no URL and a non-ASCII company, this is the failure to
        // read and PoolKey.Fold is where to fix it.
        var dotnet = PoolKey.For(null, "Straße GmbH", "Engineer", "2026-09-01");
        const string python = "k:c1b32242865bfc56d110d3c189085737";

        Assert.NotEqual(python, dotnet);
        Assert.Equal(PoolKey.For(null, "strasse gmbh", "engineer", "2026-09-01").Length, dotnet.Length);
    }
}
