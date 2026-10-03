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
/// Only <c>work_arrangement</c> may disqualify a posting: a constraint the
/// candidate stated, which postings usually state outright too. Not
/// structurally checked: the constraint is free text, and an honest gap beats
/// a check that only appears to verify something.
/// </para>
/// <para>
/// <b><c>candidate_dealbreaker</c> was removed (2026-10-03).</b> It had a
/// structural check — the reason had to quote the user's own words — but the
/// check verified the attribution, not the judgement. The Evaluator sees no
/// company data on the board path, so "is this an early-stage startup?" was
/// answered from a job description's wording, and that guess carried the
/// strongest consequence in the system: an 81 shown as STRONG_NO (Unframe,
/// Series B, ~170 people). A fuzzy input may not carry an absolute output.
/// </para>
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
/// Its own class, like <see cref="ScoreTotal"/>,
/// so the decision is testable. Inside <c>EnforceHardBlockerScope</c> it was
/// private, and the old default — <c>_ =&gt; true</c> — had no test at all.
/// </para>
/// </remarks>
public static class HardBlockerScope
{
    /// <summary>A work-arrangement constraint the candidate stated.</summary>
    public const string WorkArrangement = "work_arrangement";

    private static readonly HashSet<string> CandidateStatedFilters =
        new(StringComparer.OrdinalIgnoreCase) { WorkArrangement };

    /// <summary>
    /// Whether this blocker may stand. False means drop it — the posting is
    /// scored on its merits instead of being disqualified.
    /// </summary>
    public static bool IsSupported(HardBlocker blocker) =>
        blocker is not null && CandidateStatedFilters.Contains(blocker.Filter ?? "");
}
