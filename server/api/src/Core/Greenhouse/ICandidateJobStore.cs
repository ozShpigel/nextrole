namespace ApplicationTracker.Core.Greenhouse;

/// <summary>
/// Narrows the Greenhouse collection to the jobs worth scoring for one profile.
/// </summary>
/// <remarks>
/// <para>
/// <b>A recall prefilter, not a score.</b> It decides which jobs the Evaluator
/// looks at; it does not decide whether any of them are good. Nothing here
/// ranks, rates or persists an opinion about a candidate -- an opinion about
/// one candidate is per-user work and belongs where the rest of it lives.
/// </para>
/// <para>
/// An interface so the store is swappable. Atlas <c>$vectorSearch</c> is the
/// implementation today; the shape of the contract -- profile text in, job ids
/// out -- commits to nothing about how the search is done.
/// </para>
/// <para>
/// It returns <b>ids</b> rather than documents on purpose. A prefilter that
/// returned job bodies would invite the caller to use them, and the caller
/// would then be reading a second source's documents through a retrieval API.
/// </para>
/// </remarks>
public interface ICandidateJobStore
{
    /// <summary>
    /// Job ids most similar to the profile, closed listings excluded.
    /// </summary>
    /// <param name="renderedProfile">
    /// The rendered <c>StructuredProfile</c> -- what <c>ProfileRenderer</c>
    /// produces, and what the scoring prompts consume. Not a job title and not
    /// a keyword: the query vector has to describe the candidate, because the
    /// document vectors describe postings, and a two-word query lands nowhere
    /// near a 4,000-character posting in the same space.
    /// </param>
    /// <param name="filters">Hard filters applied inside the vector index.</param>
    /// <param name="n">How many ids to return.</param>
    Task<IReadOnlyList<string>> FindCandidateJobIds(
        string renderedProfile, CandidateJobFilters filters, int n, CancellationToken ct = default);
}

/// <summary>
/// Filters applied by the vector index itself, not after the fact.
/// </summary>
/// <remarks>
/// They have to be in the index. Filtering after <c>$vectorSearch</c> has
/// returned its <c>limit</c> silently shrinks the result -- ask for 200 and get
/// however many of those 200 survive, which on a narrow filter can be nearly
/// none. The index applies them while searching, so the limit means what it says.
/// </remarks>
/// <param name="Locations">Match any of these locations. Empty means no constraint.</param>
/// <param name="Seniority">Match any of these seniority values. Empty means no constraint.</param>
/// <param name="IncludeClosed">
/// Almost always false. A closed listing is kept forever and is still a perfect
/// vector match for the profile it was written for, so it would otherwise
/// dominate results that nobody can apply to.
/// </param>
public sealed record CandidateJobFilters(
    IReadOnlyList<string>? Locations = null,
    IReadOnlyList<string>? Seniority = null,
    bool IncludeClosed = false);
