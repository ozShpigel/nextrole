using ApplicationTracker.Greenhouse;
using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Profile;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The board ingest stores the extracted-fact contract scoring reads.
/// </summary>
/// <remarks>
/// <para>
/// <c>CandidateFilter</c> and the Evaluator read <c>extracted.*</c> by dotted
/// path, and every pool clause is "matches OR unstated" -- so a renamed field
/// or band fails open and silently, as jobs quietly failing to match anyone.
/// These pin the parent name and the seniority bands.
/// </para>
/// <para>
/// This file also used to check the board fields against the paths the LinkedIn
/// pool's repository queried, while the two were alternative sources. That
/// repository was removed on 2026-10-04, and with it that half of the contract.
/// </para>
/// </remarks>
public class PoolContractTests
{
    [Fact]
    public void The_extracted_paths_are_nested_under_the_same_parent()
    {
        // The parent name matters as much as the leaves: CandidateFilter's
        // clauses are dotted paths, so `facts.seniority` would miss entirely.
        Assert.Equal("extracted", GreenhouseJobFields.Extracted);

        foreach (var path in new[]
                 {
                     GreenhouseJobFields.ExtractedLocation,
                     GreenhouseJobFields.ExtractedSeniority,
                     GreenhouseJobFields.ExtractedMustHaveTech,
                 })
            Assert.StartsWith($"{GreenhouseJobFields.Extracted}.", path, StringComparison.Ordinal);
    }

    /// <summary>
    /// The five seniority bands, as <see cref="CandidateFilter"/> emits them.
    /// </summary>
    /// <remarks>
    /// Driven through the public API rather than read from the private array,
    /// so this asserts what the filter DOES rather than what it declares. A
    /// band spelled differently on the Greenhouse side falls outside every
    /// range and the job stops matching anyone whose profile maps to a band --
    /// with no error anywhere.
    /// </remarks>
    [Theory]
    [InlineData("Junior Engineer", new[] { "entry level", "associate" })]
    [InlineData("Senior Backend Engineer", new[] { "associate", "mid-senior level", "director" })]
    // PINS ACTUAL BEHAVIOUR, WHICH IS WRONG. "Director of Engineering" bands
    // as EXECUTIVE, not director: CandidateFilter.IndexOfBand tests
    // s.Contains("cto") before s.Contains("director"), and "dire[cto]r"
    // contains "cto". Every director-titled profile is banded one step high.
    //
    // Left as-is deliberately. Fixing it changes which pool jobs pass the
    // filter for those users today, and that is a scoring change that belongs
    // in its own commit with its own eval run -- not a side effect of adding a
    // second source. Reported separately.
    [InlineData("Director of Engineering", new[] { "director", "executive" })]
    [InlineData("VP Engineering", new[] { "director", "executive" })]
    public void The_seniority_bands_are_the_five_the_filter_widens_over(string seniority, string[] expected)
    {
        var filter = CandidateFilter.FromProfile(new StructuredProfile { Seniority = seniority });

        Assert.Equal(expected, filter.SeniorityBands);
    }

    [Fact]
    public void An_unmapped_seniority_constrains_nothing_rather_than_excluding_everything()
    {
        // The permissive rule, at the profile end. A profile the bands cannot
        // place must widen to "no constraint" -- not to an empty set, which
        // would match no job at all.
        var filter = CandidateFilter.FromProfile(new StructuredProfile { Seniority = "Cheesemonger" });

        Assert.Empty(filter.SeniorityBands);
    }

    [Fact]
    public void A_greenhouse_row_starts_with_the_facts_unstated_not_absent()
    {
        // extracted is present and null, and the attempt counter starts at 0.
        // Present-and-null rather than absent so the shape is visible in the
        // stored document: a reader can tell "not extracted yet" from "this
        // collection has no such concept".
        var fields = GreenhouseJob.InitialExtractionFields();

        Assert.True(fields.Contains(GreenhouseJobFields.Extracted));

        // A SUB-DOCUMENT with null leaves, not a null `extracted`. An Atlas
        // vector-search filter does not match a missing path, so a null parent
        // makes every extracted.* filter return nothing -- measured, not
        // theorised. Regular MQL hides this, because $eq:null matches a missing
        // field there.
        var extracted = fields[GreenhouseJobFields.Extracted];
        Assert.True(extracted.IsBsonDocument,
            "extracted must be a sub-document so the extracted.* filter paths exist.");

        var doc = extracted.AsBsonDocument;
        Assert.True(doc.Contains("seniority"));
        Assert.True(doc["seniority"].IsBsonNull);
        Assert.True(doc.Contains("location"));
        Assert.True(doc["location"].IsBsonNull);
        // Empty array, not null: the pool's tech clause passes it via Size(0).
        Assert.True(doc["must_have_tech"].IsBsonArray);
        Assert.Empty(doc["must_have_tech"].AsBsonArray);

        Assert.Equal(0, fields[GreenhouseJobFields.ExtractAttempts].ToInt32());
    }
}
