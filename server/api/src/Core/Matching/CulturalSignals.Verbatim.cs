namespace ApplicationTracker.Core.Matching;

/// <summary>
/// Drops cultural signals the Analyst reported but the posting does not
/// actually contain.
/// </summary>
/// <remarks>
/// <para>
/// The Analyst's field note for <c>culturalSignals</c> instructs "verbatim…
/// capture exact text", and that does not reliably hold: the model sometimes
/// copies its own field-note examples ("wear many hats", "fast-paced") into the
/// output as if they had been extracted from the posting, and the Evaluator
/// then cites them as evidence for a hard filter the posting never triggered.
/// </para>
/// <para>
/// <b>This is the shape of the risk in moving the Analyst to ingest, and the
/// reason to look for others like it.</b> A per-user artifact's mistakes are
/// per-user: this guard used to stand between one fabricated signal and one
/// bad score, on a parse discarded seconds later. A SHARED, DURABLE artifact's
/// mistakes belong to everybody: the same fabrication, stored, is handed to
/// every user who scores that job for as long as the row lives, and nothing
/// downstream can tell it apart from something the posting actually said.
/// </para>
/// <para>
/// So the guard was lifted out of <see cref="JobMatchService"/> and now runs in
/// both places, and it runs BEFORE a parse is persisted rather than after one
/// is read back. Running it in only one place would be worse than not having
/// it at all, because the cached path is the one where a mistake compounds.
/// </para>
/// <para>
/// When adding anything else to the stored parse, ask the same question: what
/// did this check cost when it was wrong once per user, and what does it cost
/// now that being wrong once is being wrong for everyone?
/// </para>
/// </remarks>
public static class VerbatimCulturalSignals
{
    /// <param name="onDropped">
    /// Called per dropped signal with (signal, category) so the caller can log
    /// it — this is a model-fabrication event and should stay visible.
    /// </param>
    public static ParsedJob Enforce(
        ParsedJob parsedJob, string jobDescription, Action<string, string>? onDropped = null)
    {
        var normalizedJd = NormalizeWhitespace(jobDescription);

        string[] Filter(string[] signals, string category) =>
            signals.Where(signal =>
            {
                var found = normalizedJd.Contains(NormalizeWhitespace(signal), StringComparison.OrdinalIgnoreCase);
                if (!found) onDropped?.Invoke(signal, category);
                return found;
            }).ToArray();

        var negative = Filter(parsedJob.CulturalSignals.Negative, "negative");
        var positive = Filter(parsedJob.CulturalSignals.Positive, "positive");
        var neutral = Filter(parsedJob.CulturalSignals.Neutral, "neutral");

        if (negative.Length == parsedJob.CulturalSignals.Negative.Length
            && positive.Length == parsedJob.CulturalSignals.Positive.Length
            && neutral.Length == parsedJob.CulturalSignals.Neutral.Length)
            return parsedJob;

        return parsedJob with
        {
            CulturalSignals = parsedJob.CulturalSignals with
            {
                Negative = negative, Positive = positive, Neutral = neutral,
            },
        };
    }

    public static string NormalizeWhitespace(string s) =>
        string.Join(' ', s.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}
