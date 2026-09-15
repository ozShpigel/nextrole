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
/// Lifted out of <see cref="JobMatchService"/> when the Analyst moved to
/// ingest, because it now has to run in two places and running it in only one
/// would be worse than not having it. A fabricated signal used to cost one
/// user one bad score, on a parse thrown away immediately afterwards. A stored
/// parse is shared and durable: the same fabrication would be handed to every
/// user who scores that job, for as long as the row lives. The guard has to
/// run BEFORE the parse is persisted, not after it is read back.
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
