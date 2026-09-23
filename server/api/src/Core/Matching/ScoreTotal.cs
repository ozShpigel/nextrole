namespace ApplicationTracker.Core.Matching;

/// <summary>
/// The overall score, computed from the dimensions that could actually be
/// assessed.
/// </summary>
/// <remarks>
/// <para>
/// Its own class, like <see cref="PaceEvidence"/>, for the same reason: it is
/// the arithmetic behind a consequence, and a consequence needs a test. The
/// logic used to live inside <c>JobMatchService.EnforceEvidenceCaps</c>, which
/// is private, so nothing pinned it — <c>PaceEvidenceTests</c> covers the
/// predicate that decides <i>whether</i> to drop a dimension and never covered
/// what dropping one does to the total.
/// </para>
/// <para>
/// <b>The maxima are server-side constants and must stay that way.</b> Each
/// dimension in the response carries its own <c>maxScore</c>, written by the
/// model. A total divided by a model-authored denominator is a consequence
/// whose input the model controls: understating a maximum inflates the score,
/// and nothing would flag it. Same rule as <c>stackedGaps</c> and
/// <c>reviewAdjustment</c> — compute the consequence from data the model does
/// not author.
/// </para>
/// </remarks>
public static class ScoreTotal
{
    public const int TechnicalFitMax = 35;
    public const int EngineeringExecutionFitMax = 30;
    public const int SustainabilityPaceFitMax = 35;

    /// <summary>Everything assessable, when every dimension is scored.</summary>
    public const int FullMax = TechnicalFitMax + EngineeringExecutionFitMax + SustainabilityPaceFitMax;

    /// <summary>
    /// The total over the scored dimensions, rescaled to 0-100 — or null when
    /// no dimension carries a score at all.
    /// </summary>
    /// <remarks>
    /// <para>
    /// When all three are scored the denominator is already 100, and this
    /// returns the plain sum unchanged. That is deliberate and is the property
    /// worth protecting: dropping a dimension is the only thing that can move a
    /// number, so a job with full evidence scores exactly what it scored
    /// before.
    /// </para>
    /// <para>
    /// A null dimension means "not assessed", not "assessed as zero". Summing
    /// it as zero is what a fixed cap effectively did — it charged the posting
    /// for evidence no source can supply — and it is the thing this replaces.
    /// </para>
    /// </remarks>
    public static int? Renormalised(Breakdown breakdown)
    {
        var awarded = 0;
        var available = 0;

        void Add(int? score, int max)
        {
            if (score is not int value) return;
            awarded += value;
            available += max;
        }

        Add(breakdown.TechnicalFit.Score, TechnicalFitMax);
        Add(breakdown.EngineeringExecutionFit.Score, EngineeringExecutionFitMax);
        Add(breakdown.SustainabilityPaceFit.Score, SustainabilityPaceFitMax);

        // Nothing assessable. The caller keeps whatever score it had rather
        // than publishing a 0, which would read as "scored, and terrible".
        if (available == 0) return null;

        if (available == FullMax) return awarded;

        return (int)Math.Round(100.0 * awarded / available, MidpointRounding.AwayFromZero);
    }
}
