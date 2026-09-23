namespace ApplicationTracker.Core.Matching;

/// <summary>
/// Which hard blockers the server will act on.
/// </summary>
/// <remarks>
/// <para>
/// A hard blocker is the most consequential field in a scoring response:
/// <c>Correct()</c> forces <c>STRONG_NO</c> on a non-empty <c>hardBlockers</c>,
/// overriding every dimension, component and cap. So this is an
/// <b>allow-list</b> — an unrecognised filter is dropped, not trusted.
/// </para>
/// <para>
/// Only a filter stating something the <b>candidate declared about
/// themselves</b> may disqualify a posting:
/// </para>
/// <list type="bullet">
/// <item><c>candidate_dealbreaker</c> — must quote a dealbreaker the user
/// wrote, in their own words. The one filter with a real structural check.</item>
/// <item><c>work_arrangement</c> — a constraint they stated. Not structurally
/// checked: the constraint is free text, and an honest gap beats a check that
/// only appears to verify something.</item>
/// </list>
/// <para>
/// <b>Three filters were removed rather than checked</b>, because a check would
/// have been dressing up the wrong idea. <c>scope_discipline</c> and
/// <c>sustainability_signals</c> disqualified a posting for its own prose
/// ("wear many hats", "fast-paced") — that is taste, not a disqualification,
/// and it belongs in a dimension's <c>concerns</c> where a posting loses points
/// instead of disappearing. <c>people_management</c> was a fit judgement
/// wearing a filter's clothes: measured twice against one profile, five real
/// postings drew no blocker on the first run and a <c>people_management</c>
/// blocker on the second, forcing STRONG_NO on all five — two of those postings
/// state no management requirement at all, and the rest named only mentoring
/// and interview participation, which the prompt explicitly excludes. Nothing
/// was lost by removing it: the level gap still caps System Design on its own.
/// </para>
/// <para>
/// Its own class, like <see cref="PaceEvidence"/> and <see cref="ScoreTotal"/>,
/// so the decision is testable. Inside <c>EnforceHardBlockerScope</c> it was
/// private, and the old default — <c>_ =&gt; true</c> — had no test at all.
/// </para>
/// </remarks>
public static class HardBlockerScope
{
    /// <summary>Must quote one of the candidate's own stated dealbreakers.</summary>
    public const string CandidateDealbreaker = "candidate_dealbreaker";

    /// <summary>A work-arrangement constraint the candidate stated.</summary>
    public const string WorkArrangement = "work_arrangement";

    private static readonly HashSet<string> RedFlagFilters =
        new(StringComparer.OrdinalIgnoreCase) { CandidateDealbreaker };

    private static readonly HashSet<string> CandidateStatedFilters =
        new(StringComparer.OrdinalIgnoreCase) { WorkArrangement };

    /// <summary>
    /// Whether this blocker may stand. False means drop it — the posting is
    /// scored on its merits instead of being disqualified.
    /// </summary>
    public static bool IsSupported(HardBlocker blocker, string[] redFlags)
    {
        if (blocker is null) return false;

        var filter = blocker.Filter ?? "";

        if (RedFlagFilters.Contains(filter))
        {
            // The reason has to name the dealbreaker the user actually wrote.
            // Without this the model can disqualify a job over a concern it
            // invented and attribute it to the candidate.
            var reason = VerbatimCulturalSignals.NormalizeWhitespace(blocker.Reason ?? "");
            return redFlags.Any(flag =>
                !string.IsNullOrWhiteSpace(flag)
                && reason.Contains(
                    VerbatimCulturalSignals.NormalizeWhitespace(flag),
                    StringComparison.OrdinalIgnoreCase));
        }

        return CandidateStatedFilters.Contains(filter);
    }
}
