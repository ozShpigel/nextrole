using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Profile;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Core.Matching;

public sealed class JobMatchService : IJobMatchService
{
    private readonly IProfileProvider _profileProvider;
    private readonly IClaudeClient _claudeClient;
    private readonly ScoringConfig _scoring;
    private readonly ILogger<JobMatchService> _logger;

    public JobMatchService(
        IProfileProvider profileProvider,
        IClaudeClient claudeClient,
        ScoringConfig scoring,
        ILogger<JobMatchService> logger)
    {
        _profileProvider = profileProvider;
        _claudeClient = claudeClient;
        _scoring = scoring;
        _logger = logger;
    }

    // Which technologies this posting REQUIRES, preferring the pool's own
    // extraction over the Analyst's reading of the same text.
    //
    // `mustHaveTech` is read once per posting at ingest, user-independently
    // (docs/job-pool.md), and it separates "required" from "nice to have" —
    // which the gap count depends on, because the prompt's rule is that a
    // nice-to-have is never a gap. The Analyst's NamedTechnologies is the
    // fallback for the manual page and for pool rows that entered before
    // extraction existed; it does not make that distinction, so the
    // nice-to-have half is subtracted by name.
    private static string[] RequiredTechFrom(MatchBatchItem? item, ParsedJob parsedJob)
    {
        if (item?.MustHaveTech is { Length: > 0 } must) return must;
        var optional = new HashSet<string>(parsedJob.NiceToHaveSkills, StringComparer.OrdinalIgnoreCase);
        return parsedJob.NamedTechnologies.Where(t => !optional.Contains(t)).ToArray();
    }

    // Nice-to-haves are not gaps, but a rationale may not claim them either.
    private static string[] OptionalTechFrom(MatchBatchItem? item, ParsedJob parsedJob)
    {
        if (item?.NiceToHaveTech is { Length: > 0 } nice) return nice;
        var required = new HashSet<string>(RequiredTechFrom(item, parsedJob), StringComparer.OrdinalIgnoreCase);
        return parsedJob.NiceToHaveSkills
            .Concat(parsedJob.NamedTechnologies)
            .Where(t => !required.Contains(t))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string? VerdictFromScore(int? score, VerdictBands bands) => score switch
    {
        null => null,
        var s when s >= bands.StrongYes => "STRONG_YES",
        var s when s >= bands.Yes => "YES",
        var s when s >= bands.Maybe => "MAYBE",
        var s when s >= bands.No => "NO",
        _ => "STRONG_NO"
    };

    public async Task<MatchResponse> AnalyzeMatchAsync(Guid userId, MatchRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting job match analysis");

        string profile;
        StructuredProfile structured;
        if (request.Profile is not null)
        {
            profile = ProfileRenderer.Render(request.Profile);
            structured = request.Profile;
        }
        else
        {
            var profileDoc = await _profileProvider.GetProfileDocumentAsync(userId, cancellationToken);
            profile = profileDoc.Content;
            structured = profileDoc.Structured;
        }
        var redFlags = structured.RedFlags;

        var (parsedJob, analystSnap) = await ParseAsync(request, cancellationToken);
        var (matchResponse, evalSnap) = await _claudeClient.EvaluateMatchAsync(profile, parsedJob, request.CompanyNews, request.GlassdoorData, request.CompanyProfile, cancellationToken);

        // No ingest facts on this path — the job was pasted, not scraped — so
        // the Analyst's own reading of the posting is the requirement list.
        var corrected = Correct(
            matchResponse, _scoring, ReviewCap(request.GlassdoorData?.ReviewCount), parsedJob,
            request.GlassdoorData, redFlags, structured,
            RequiredTechFrom(null, parsedJob), OptionalTechFrom(null, parsedJob)) with
        {
            JobTitle = parsedJob.JobTitle,
            Company = parsedJob.Company,
            AnalystSnapshotInput = analystSnap.Input,
            AnalystSnapshotOutput = analystSnap.Output,
            EvaluatorSnapshotInput = evalSnap.Input,
            EvaluatorSnapshotOutput = evalSnap.Output
        };
        _logger.LogInformation("Match evaluation completed. Verdict: {Verdict}, Score: {Score}",
            corrected.Verdict, corrected.OverallScore);
        return corrected;
    }

    public async Task<MatchBatchResponse> AnalyzeMatchBatchAsync(Guid userId, MatchBatchRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting batch job match analysis ({Count} jobs)", request.Jobs.Count);

        var profileDoc = await _profileProvider.GetProfileDocumentAsync(userId, cancellationToken);
        var profile = profileDoc.Content;
        var structured = profileDoc.Structured;
        var redFlags = structured.RedFlags;

        // Analyst pass: ONE shared call parses every job in the batch — same
        // shared-system-prompt-cost saving the Evaluator batch call already
        // gets. Title/Company caller overrides are applied here, after
        // parsing, same as the single-job path (ParseAsync) — never sent to
        // the model itself.
        var (parseResults, analystSnap) = await _claudeClient.ParseJobDescriptionBatchAsync(request.Jobs, cancellationToken);
        var parsedById = parseResults.ToDictionary(r => r.Id, r => r.Parsed);

        var parsed = request.Jobs.Select(item =>
        {
            var verified = EnforceCulturalSignalsVerbatim(parsedById[item.Id], item.JobDescription);
            var parsedJob = verified with
            {
                JobTitle = !string.IsNullOrWhiteSpace(item.Title) ? item.Title! : verified.JobTitle,
                Company = !string.IsNullOrWhiteSpace(item.Company) ? item.Company : verified.Company,
            };
            return (Item: item, ParsedJob: parsedJob);
        }).ToList();

        var evaluationItems = parsed.Select(p => new EvaluationBatchItem
        {
            Id = p.Item.Id,
            ParsedJob = p.ParsedJob,
            CompanyNews = p.Item.CompanyNews,
            GlassdoorData = p.Item.GlassdoorData,
            CompanyProfile = p.Item.CompanyProfile,
        }).ToList();

        var (batchResults, evalSnap, source) = await _claudeClient.EvaluateMatchBatchAsync(profile, evaluationItems, cancellationToken);
        var responseById = batchResults.ToDictionary(r => r.Id, r => r.Response);

        var results = parsed.Select(p =>
        {
            var raw = responseById[p.Item.Id];
            var corrected = Correct(
                raw, _scoring, ReviewCap(p.Item.GlassdoorData?.ReviewCount), p.ParsedJob,
                p.Item.GlassdoorData, redFlags, structured,
                RequiredTechFrom(p.Item, p.ParsedJob), OptionalTechFrom(p.Item, p.ParsedJob)) with
            {
                JobTitle = p.ParsedJob.JobTitle,
                Company = p.ParsedJob.Company,
                // The whole batch shares one Analyst call and one Evaluator
                // call — every job's snapshots are the same shared
                // request/response, honestly reflecting that this job wasn't
                // parsed or scored in isolation.
                AnalystSnapshotInput = analystSnap.Input,
                AnalystSnapshotOutput = analystSnap.Output,
                EvaluatorSnapshotInput = evalSnap.Input,
                EvaluatorSnapshotOutput = evalSnap.Output,
            };
            // Structured, one line per job — post-correction (Correct() may
            // have overridden the model's own verdict, e.g. via HardBlockers)
            // so this reflects what actually gets stored, not the raw model
            // output. Grep/alert on this in Loki for high-score matches.
            _logger.LogInformation(
                "Job scored: source={Source} score={Score} verdict={Verdict} company={Company} title={Title} jobId={JobId} runId={RunId}",
                source, corrected.OverallScore, corrected.Verdict, corrected.Company, corrected.JobTitle, p.Item.Id, request.RunId);
            return new MatchBatchResult { Id = p.Item.Id, Response = corrected };
        }).ToList();

        _logger.LogInformation("Batch job match analysis completed: {Count} jobs", results.Count);
        return new MatchBatchResponse { Results = results };
    }

    // Analyst pass only. Always run even when the caller pre-supplies
    // title/company — without it the Evaluator scores on vibes alone. The
    // caller's canonical title/company override the Analyst's inference.
    private async Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseAsync(MatchRequest request, CancellationToken cancellationToken = default)
    {
        var (parsed, snap) = await _claudeClient.ParseJobDescriptionAsync(request.JobDescription, cancellationToken);
        var verified = EnforceCulturalSignalsVerbatim(parsed, request.JobDescription);
        var parsedJob = verified with
        {
            JobTitle = !string.IsNullOrWhiteSpace(request.Title) ? request.Title! : verified.JobTitle,
            Company = !string.IsNullOrWhiteSpace(request.Company) ? request.Company : verified.Company,
        };
        return (parsedJob, snap);
    }

    // The Analyst's field note for culturalSignals instructs "verbatim...
    // capture exact text" (PromptSeeds.cs), but it doesn't reliably hold — the
    // model sometimes copies its own field-note examples ("wear many hats",
    // "fast-paced") into the output as if they'd been extracted from the
    // posting, and the Evaluator then cites them as evidence for a hard
    // filter the posting never actually triggered. Runs on the Analyst's raw
    // output before it reaches the Evaluator — unlike Correct()'s other
    // Enforce* methods, which all run on the Evaluator's output instead.
    private ParsedJob EnforceCulturalSignalsVerbatim(ParsedJob parsedJob, string jobDescription)
    {
        var normalizedJd = NormalizeWhitespace(jobDescription);

        string[] Filter(string[] signals, string category)
        {
            return signals.Where(signal =>
            {
                var found = normalizedJd.Contains(NormalizeWhitespace(signal), StringComparison.OrdinalIgnoreCase);
                if (!found)
                {
                    _logger.LogWarning(
                        "Fabricated cultural signal dropped: signal={Signal} category={Category}",
                        signal, category);
                }
                return found;
            }).ToArray();
        }

        var negative = Filter(parsedJob.CulturalSignals.Negative, "negative");
        var positive = Filter(parsedJob.CulturalSignals.Positive, "positive");
        var neutral = Filter(parsedJob.CulturalSignals.Neutral, "neutral");

        if (negative.Length == parsedJob.CulturalSignals.Negative.Length
            && positive.Length == parsedJob.CulturalSignals.Positive.Length
            && neutral.Length == parsedJob.CulturalSignals.Neutral.Length)
            return parsedJob;

        return parsedJob with
        {
            CulturalSignals = parsedJob.CulturalSignals with { Negative = negative, Positive = positive, Neutral = neutral }
        };
    }

    private static string NormalizeWhitespace(string s) =>
        string.Join(' ', s.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    // Re-derive verdict from the numeric score (authoritative bands) and recompute
    // shouldApply from the save threshold — the AI's own verdict/flag are advisory.
    // `profile` and `requiredTech` are what make the gap count and the claim
    // check possible: the posting's stated requirements are compared against
    // the candidate's own profile here, on the server, instead of being taken
    // from the model's account of itself.
    private MatchResponse Correct(
        MatchResponse r, ScoringConfig cfg, int reviewCap, ParsedJob parsedJob,
        GlassdoorData? glassdoorData, string[] redFlags,
        StructuredProfile profile, string[] requiredTech, string[] optionalTech)
    {
        r = EnforceReviewCaps(r, reviewCap);
        r = GroundClaims(r, profile, requiredTech, optionalTech);
        r = EnforceStackedGapsCap(r, requiredTech);
        r = EnforceScoreBounds(r);
        r = EnforceEvidenceCaps(r, parsedJob, glassdoorData);
        r = EnforceQuickHighlightsLength(r);
        r = EnforceHardBlockerScope(r, parsedJob, redFlags);
        var verdict = VerdictFromScore(r.OverallScore, cfg.VerdictBands) ?? r.Verdict;
        // The model reliably identifies a disqualifying condition in its
        // reasoning but doesn't reliably apply the consequence to its own
        // verdict field — same pattern as the review-cap enforcement below,
        // enforced here instead of trusted from the prompt alone.
        if (r.HardBlockers.Length > 0)
            verdict = "STRONG_NO";
        var shouldApply = r.OverallScore >= cfg.MinScoreToSave && verdict != "STRONG_NO";
        // Prompt asks for at most 1 questionsToAsk item on MAYBE/NO/STRONG_NO
        // (terse) and at most 3 on STRONG_YES/YES (full detail) — but per the
        // same lesson as the caps above, this doesn't reliably hold; clamp here.
        var maxQuestions = verdict is "STRONG_YES" or "YES" ? 3 : 1;
        var rec = r.Recommendation is null ? null : r.Recommendation with
        {
            ShouldApply = shouldApply,
            QuestionsToAsk = r.Recommendation.QuestionsToAsk.Length > maxQuestions
                ? r.Recommendation.QuestionsToAsk[..maxQuestions]
                : r.Recommendation.QuestionsToAsk
        };
        return r with { Verdict = verdict, Recommendation = rec! };
    }

    // Replaces the model's stackedGaps with the server's own, and marks any
    // technology the rationale asserts the candidate has without support in
    // their profile.
    //
    // Order matters: this runs BEFORE EnforceStackedGapsCap, which is the whole
    // point. The cap has always existed to catch a Core Stack score that
    // ignored a pile of missing requirements, but its only input was the
    // model's self-reported gap list — written in the same response as the
    // claim, and shrunk by exactly the responses that needed capping. Zscaler:
    // 12 required technologies absent from the profile, 1 self-reported gap,
    // Core Stack 20/20, overall 88.
    //
    // A posting that names no requirements yields no gaps and no claims, and
    // leaves the model's list alone: there is nothing to check against, and
    // EnforceEvidenceCaps already handles "the JD said nothing".
    private MatchResponse GroundClaims(
        MatchResponse r, StructuredProfile profile, string[] requiredTech, string[] optionalTech)
    {
        if (requiredTech.Length == 0 && optionalTech.Length == 0) return r;

        var evidence = ClaimGrounding.ProfileEvidence(profile);
        var gaps = ClaimGrounding.RequiredButAbsent(requiredTech, evidence);

        // The model's own list is not used, but a divergence is worth seeing:
        // it is the cheapest signal that the Evaluator is talking itself out of
        // gaps, and it was invisible while the model owned the field.
        if (Math.Abs(gaps.Length - r.StackedGaps.Length) >= 2)
            _logger.LogInformation(
                "Stacked-gaps divergence: server computed {Computed} from the posting's requirements, "
                + "model self-reported {Claimed} (computed: {Gaps})",
                gaps.Length, r.StackedGaps.Length, string.Join(", ", gaps));

        // Nice-to-have technologies are not gaps (the prompt's own rule) but a
        // rationale still must not claim them, so both lists feed the claim check.
        var claims = ClaimGrounding.Find(
            r with { StackedGaps = gaps }, requiredTech.Concat(optionalTech), profile);
        foreach (var c in claims)
            _logger.LogWarning(
                "Unsupported claim: technology={Technology} field={Field} text=\"{Text}\"",
                c.Technology, c.Field, c.Text);

        return r with { StackedGaps = gaps, UnsupportedClaims = claims };
    }

    // A posting with many individually-minor stack gaps was scored too
    // generously as an overall Core Stack match — tuning the verdict
    // threshold alone couldn't separate this pattern from genuinely strong
    // matches (their real scores overlap the same band). StackedGaps is a
    // separate, literal inventory the model fills independently of its own
    // Core Stack narrative score; when enough gaps stack up, cap the score
    // server-side rather than trust the model to self-discount it.
    // The ceiling itself is CoreStackCap.For - flat at 11 until it was measured
    // and found to charge the same for 4 missing requirements as for 14.
    private MatchResponse EnforceStackedGapsCap(MatchResponse r, string[] requiredTech)
    {
        var gaps = r.StackedGaps.Length;
        var required = ClaimGrounding.RequirementCount(requiredTech);
        var ceiling = CoreStackCap.For(gaps, required);
        if (ceiling >= CoreStackCap.MaxScore) return r;

        var components = r.Breakdown.TechnicalFit.Components;
        var idx = Array.FindIndex(components, c => c.Name.Equals("Core Stack", StringComparison.OrdinalIgnoreCase));
        if (idx < 0 || components[idx].Score is not int score || score <= ceiling)
            return r;

        var newComponents = (ScoreComponent[])components.Clone();
        newComponents[idx] = components[idx] with { Score = ceiling };
        _logger.LogInformation(
            "Stacked-gaps cap enforcement: 'Core Stack' {Old} -> {New} "
            + "({GapCount} of {Required} stated requirements absent)",
            score, ceiling, gaps, required);

        var techFit = r.Breakdown.TechnicalFit with
        {
            Components = newComponents,
            Score = newComponents.Sum(c => c.Score ?? 0),
        };
        var breakdown = r.Breakdown with { TechnicalFit = techFit };
        var overall = breakdown.TechnicalFit.Score is int t
                   && breakdown.EngineeringExecutionFit.Score is int e
                   && breakdown.SustainabilityPaceFit.Score is int s
            ? t + e + s
            : r.OverallScore;
        return r with { Breakdown = breakdown, OverallScore = overall };
    }

    // Evidence-volume cap from the EMPLOYEE REVIEW EVIDENCE prompt section.
    private static int ReviewCap(int? reviewCount) => reviewCount switch
    {
        null or < 50 => 1,
        < 200 => 2,
        _ => 3
    };

    // Only these sub-components may be moved by employee-review evidence
    // (mirrors the prompt's mapping; Role Clarity & Technical Fit are excluded).
    private static readonly HashSet<string> ReviewEligibleComponents = new(StringComparer.OrdinalIgnoreCase)
    {
        "Engineering Maturity & Stability",
        "Pace & Workload",
        "Long-term Risk",
    };

    // The model won't reliably respect the ±cap in the prompt when review
    // evidence is extreme (verified empirically) — recompute each adjusted
    // component as base + clamped delta and rebuild the dependent sums.
    private MatchResponse EnforceReviewCaps(MatchResponse r, int cap)
    {
        var changed = false;

        ScoreComponent[] Enforce(ScoreComponent[] components)
        {
            return components.Select(c =>
            {
                if (c.ReviewAdjustment is not { Base: int baseScore } adj || c.Score is null)
                    return c;
                var max = c.MaxScore ?? int.MaxValue;
                baseScore = Math.Clamp(baseScore, 0, max);
                var delta = ReviewEligibleComponents.Contains(c.Name)
                    ? Math.Clamp(adj.Delta ?? 0, -cap, cap)
                    : 0; // review evidence may not touch this component at all
                var score = Math.Clamp(baseScore + delta, 0, max);
                if (score == c.Score) return c;
                changed = true;
                _logger.LogInformation(
                    "Review-cap enforcement: '{Component}' {Old} -> {New} (base {Base}, delta {Delta}, cap ±{Cap})",
                    c.Name, c.Score, score, baseScore, delta, cap);
                return c with { Score = score, ReviewAdjustment = adj with { Delta = delta } };
            }).ToArray();
        }

        static int? Sum(ScoreComponent[] components)
            => components.Length > 0 && components.All(c => c.Score is not null)
                ? components.Sum(c => c.Score!.Value)
                : null;

        var tech = Enforce(r.Breakdown.TechnicalFit.Components);
        var exec = Enforce(r.Breakdown.EngineeringExecutionFit.Components);
        var sust = Enforce(r.Breakdown.SustainabilityPaceFit.Components);
        if (!changed) return r;

        var breakdown = r.Breakdown with
        {
            TechnicalFit = r.Breakdown.TechnicalFit with { Components = tech, Score = Sum(tech) ?? r.Breakdown.TechnicalFit.Score },
            EngineeringExecutionFit = r.Breakdown.EngineeringExecutionFit with { Components = exec, Score = Sum(exec) ?? r.Breakdown.EngineeringExecutionFit.Score },
            SustainabilityPaceFit = r.Breakdown.SustainabilityPaceFit with { Components = sust, Score = Sum(sust) ?? r.Breakdown.SustainabilityPaceFit.Score },
        };
        var overall = breakdown.TechnicalFit.Score is int t
                   && breakdown.EngineeringExecutionFit.Score is int e
                   && breakdown.SustainabilityPaceFit.Score is int s
            ? t + e + s
            : r.OverallScore;
        return r with { Breakdown = breakdown, OverallScore = overall };
    }

    // The prompt states two invariants — every score >= 0 (the Sustainability
    // Fit section's implicit floor, now explicit — see PromptSeeds.cs) and
    // overallScore = sum of the three dimension scores (the INVARIANTS block)
    // — but nothing verified either one in code before this. EnforceReviewCaps
    // above only clamps components carrying a model-reported ReviewAdjustment;
    // a component/dimension score outside [0, maxScore] with no review evidence
    // passed straight through untouched. Runs after EnforceReviewCaps and
    // EnforceStackedGapsCap so it clamps their output too, unconditionally —
    // logged at Information so schema violations are visible in Loki instead
    // of being silently fixed.
    private MatchResponse EnforceScoreBounds(MatchResponse r)
    {
        var changed = false;

        int? Clamp(int? score, int? maxScore, string field)
        {
            if (score is not int original) return score;
            var corrected = Math.Clamp(original, 0, maxScore ?? int.MaxValue);
            if (corrected == original) return original;
            changed = true;
            _logger.LogInformation(
                "Score corrected: field={Field} from={Original} to={Corrected} reason={Reason}",
                field, original, corrected, original < 0 ? "below floor" : "above maxScore");
            return corrected;
        }

        ScoreComponent[] ClampComponents(ScoreComponent[] components, string dimension) =>
            components.Select(c => c with { Score = Clamp(c.Score, c.MaxScore, $"{dimension}.{c.Name}") }).ToArray();

        var techComponents = ClampComponents(r.Breakdown.TechnicalFit.Components, "TechnicalFit");
        var techScore = Clamp(r.Breakdown.TechnicalFit.Score, r.Breakdown.TechnicalFit.MaxScore, "TechnicalFit");

        var execComponents = ClampComponents(r.Breakdown.EngineeringExecutionFit.Components, "EngineeringExecutionFit");
        var execScore = Clamp(r.Breakdown.EngineeringExecutionFit.Score, r.Breakdown.EngineeringExecutionFit.MaxScore, "EngineeringExecutionFit");

        var sustComponents = ClampComponents(r.Breakdown.SustainabilityPaceFit.Components, "SustainabilityPaceFit");
        var sustScore = Clamp(r.Breakdown.SustainabilityPaceFit.Score, r.Breakdown.SustainabilityPaceFit.MaxScore, "SustainabilityPaceFit");

        // Recomputed from the (now-clamped) dimension scores rather than trusted
        // from the model's own arithmetic, per the overallScore invariant.
        var overall = techScore is int t && execScore is int e && sustScore is int s
            ? t + e + s
            : r.OverallScore;
        if (overall != r.OverallScore)
        {
            changed = true;
            _logger.LogInformation(
                "Score corrected: field={Field} from={Original} to={Corrected} reason={Reason}",
                "overallScore", r.OverallScore, overall, "sum of dimensions");
        }

        if (!changed) return r;

        var breakdown = r.Breakdown with
        {
            TechnicalFit = r.Breakdown.TechnicalFit with { Components = techComponents, Score = techScore },
            EngineeringExecutionFit = r.Breakdown.EngineeringExecutionFit with { Components = execComponents, Score = execScore },
            SustainabilityPaceFit = r.Breakdown.SustainabilityPaceFit with { Components = sustComponents, Score = sustScore },
        };
        return r with { Breakdown = breakdown, OverallScore = overall };
    }

    // Structured facts the Analyst extracts (e.g. ParsedJob.NamedTechnologies)
    // that mechanically cap a dimension's components when the JD gives no
    // evidence for that signal. The model reliably notices the absence in its
    // own reasoning text but doesn't reliably route the score to the
    // "unclear" band the prompt tells it to use for exactly this case —
    // verified empirically via eval-subscore's silence cases: band wording,
    // an explicit silence rule, narrowing an over-broad rule, a stronger
    // model, and extended thinking all failed to move it. Runs after
    // EnforceScoreBounds.
    //
    // Proven on the technical signal; process and pace follow the exact same
    // shape — one more `if` block each calling CapNamedComponents against the
    // dimension it affects, no restructuring needed.
    private MatchResponse EnforceEvidenceCaps(MatchResponse r, ParsedJob parsedJob, GlassdoorData? glassdoorData)
    {
        var breakdown = r.Breakdown;
        var changed = false;

        (ScoreComponent[] Components, bool Capped) CapNamedComponents(
            ScoreComponent[] components, string dimension, IReadOnlyDictionary<string, int> capsByName, string reason)
        {
            var capped = false;
            var result = components.Select(c =>
            {
                if (!capsByName.TryGetValue(c.Name, out var max) || c.Score is not int score || score <= max)
                    return c;
                capped = true;
                _logger.LogInformation(
                    "Score capped: field={Field} from={Original} to={Capped} reason={Reason}",
                    $"{dimension}.{c.Name}", score, max, reason);
                return c with { Score = max };
            }).ToArray();
            return (result, capped);
        }

        // Signal: no named technologies -> Core Stack / System Design are
        // capped in the "mid" range rather than trusted to land there on
        // their own. Not the top of "unclear" (PromptSeeds.cs's technicalFit
        // sub-component bands) — on real postings, silence is the norm, not
        // the outlier, so capping at the unclear ceiling turned a correction
        // on an edge case into a ~15-point penalty on the common case (54% of
        // the golden set tripped at least one cap). 12+7=19/35=54.3% keeps a
        // fully-silent dimension inside eval-subscore's mid band (<=57% of
        // max) with margin — 35's own mid ceiling is 19.95, so 20 already
        // rounds into high.
        if (parsedJob.NamedTechnologies.Length == 0)
        {
            var (components, capped) = CapNamedComponents(
                r.Breakdown.TechnicalFit.Components, "TechnicalFit",
                new Dictionary<string, int> { ["Core Stack"] = 12, ["System Design"] = 7 },
                "no_named_technologies");
            if (capped)
            {
                changed = true;
                breakdown = breakdown with
                {
                    TechnicalFit = breakdown.TechnicalFit with { Components = components, Score = components.Sum(c => c.Score ?? 0) },
                };
            }
        }

        // Signal: no process signals -> Role Clarity & Ownership / Engineering
        // Maturity & Stability are capped in the "mid" range (see the
        // technical cap above for why not the "unclear" ceiling). 9+8=17/30
        // = 56.7% of max, inside eval-subscore's mid band. Unconditional —
        // there's no external source for process evidence (unlike pace,
        // below), only the JD itself.
        if (parsedJob.ProcessSignals.Length == 0)
        {
            var (components, capped) = CapNamedComponents(
                r.Breakdown.EngineeringExecutionFit.Components, "EngineeringExecutionFit",
                new Dictionary<string, int> { ["Role Clarity & Ownership"] = 9, ["Engineering Maturity & Stability"] = 8 },
                "no_process_signals");
            if (capped)
            {
                changed = true;
                breakdown = breakdown with
                {
                    EngineeringExecutionFit = breakdown.EngineeringExecutionFit with { Components = components, Score = components.Sum(c => c.Score ?? 0) },
                };
            }
        }

        // Signal: no pace signals -> Pace & Workload / Long-term Risk are
        // capped in the "mid" range (see the technical cap above for why not
        // the "unclear" ceiling, and for the same 35-point-max rounding
        // reason: 12+7=19/35=54.3%, not 12+8=20/35=57.14%, which rounds into
        // high). Conditional on glassdoorData also being absent — the
        // Analyst only reads the job description, so a JD silent on pace can
        // still be paired with real Glassdoor evidence reaching the
        // Evaluator separately; capping here would discard that evidence
        // rather than a genuine absence of it.
        if (parsedJob.PaceSignals.Length == 0 && glassdoorData is null)
        {
            var (components, capped) = CapNamedComponents(
                r.Breakdown.SustainabilityPaceFit.Components, "SustainabilityPaceFit",
                new Dictionary<string, int> { ["Pace & Workload"] = 12, ["Long-term Risk"] = 7 },
                "no_pace_signals");
            if (capped)
            {
                changed = true;
                breakdown = breakdown with
                {
                    SustainabilityPaceFit = breakdown.SustainabilityPaceFit with { Components = components, Score = components.Sum(c => c.Score ?? 0) },
                };
            }
        }

        if (!changed) return r;

        var overall = breakdown.TechnicalFit.Score is int t
                   && breakdown.EngineeringExecutionFit.Score is int e
                   && breakdown.SustainabilityPaceFit.Score is int s
            ? t + e + s
            : r.OverallScore;
        return r with { Breakdown = breakdown, OverallScore = overall };
    }

    // The prompt states a 6-word ceiling per quickHighlights line, but models
    // count words poorly — enforced here instead: log the violation, then
    // drop the "— explanation" half so only the term remains (the prompt
    // already sanctions a bare term as the fallback for an over-length line).
    private MatchResponse EnforceQuickHighlightsLength(MatchResponse r)
    {
        if (r.QuickHighlights.Length == 0) return r;

        var changed = false;
        var corrected = r.QuickHighlights.Select(line =>
        {
            var wordCount = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
            if (wordCount <= 6) return line;

            changed = true;
            var termOnly = line.Split('—', 2)[0].Trim();
            _logger.LogInformation(
                "Quick highlight over length: words={WordCount} line=\"{Line}\" corrected=\"{Corrected}\"",
                wordCount, line, termOnly);
            return termOnly;
        }).ToArray();

        return changed ? r with { QuickHighlights = corrected } : r;
    }

    // hardBlockers now carries a filter tag (PromptSeeds.cs), but tagging
    // correctly doesn't stop the model inventing evidence for the filter it
    // named — citing coreValues/strengths as if they were the profile's own
    // <red_flags>, or firing Scope Discipline/Sustainability Signals with no
    // grounded negative signal behind it (same class of failure as the
    // culturalSignals fabrication above). Validates the two filters where a
    // cheap structural check exists; work_arrangement/people_management are
    // left unvalidated — no evidence either needs it yet.
    private static readonly HashSet<string> RedFlagFilters = new(StringComparer.OrdinalIgnoreCase) { "candidate_dealbreaker" };
    private static readonly HashSet<string> CulturalSignalFilters = new(StringComparer.OrdinalIgnoreCase) { "scope_discipline", "sustainability_signals" };

    private MatchResponse EnforceHardBlockerScope(MatchResponse r, ParsedJob parsedJob, string[] redFlags)
    {
        if (r.HardBlockers.Length == 0) return r;

        var kept = r.HardBlockers.Where(b =>
        {
            var supported = b.Filter switch
            {
                var f when RedFlagFilters.Contains(f) => redFlags.Any(flag =>
                    NormalizeWhitespace(b.Reason).Contains(NormalizeWhitespace(flag), StringComparison.OrdinalIgnoreCase)),
                var f when CulturalSignalFilters.Contains(f) => parsedJob.CulturalSignals.Negative.Length > 0,
                _ => true,
            };
            if (!supported)
            {
                _logger.LogWarning(
                    "Unsupported hard blocker dropped: filter={Filter} reason={Reason}",
                    b.Filter, b.Reason);
            }
            return supported;
        }).ToArray();

        return kept.Length == r.HardBlockers.Length ? r : r with { HardBlockers = kept };
    }
}
