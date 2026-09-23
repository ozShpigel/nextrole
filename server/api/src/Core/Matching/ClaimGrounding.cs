using ApplicationTracker.Core.Profile;

namespace ApplicationTracker.Core.Matching;

// Does the Evaluator's rationale claim a technology the candidate does not have?
//
// Two asymmetries motivated this, both found in stored output:
//
//   1. `stackedGaps` - the model's own inventory of required technologies the
//      profile lacks - was the ONLY input to the Core Stack cap, and the model
//      writes it in the same response as the claim the cap exists to test. A
//      response asserting "AWS/EKS/Kubernetes/Terraform - perfect stack match"
//      reported one gap, so the cap never fired and Core Stack came back 20/20
//      against a profile containing none of AWS, EKS or Kubernetes. The check
//      sat downstream of its own subject. Gaps are now computed here from the
//      posting's stated requirements and the profile; the model's list is kept
//      only as a signal worth logging when the two disagree.
//
//   2. The prompt had a grounding rule for "he lacks X" (stackedGaps counts
//      only REQUIRED technologies the profile does not demonstrate) and none at
//      all for "he has X" - while its own QUICK HIGHLIGHTS example taught the
//      exact shape of the false claim, "Core stack match - Kubernetes".
//
// Flag, never block. A withheld score leaves the user a blank card; a score
// with the unsupported claim named is more useful than no score. Blocking is
// right for a resume pack, which goes to an employer - see ResumePackValidator.
public static class ClaimGrounding
{
    // Names that are one technology wearing two labels. The Evaluator prompt
    // already forbids counting such a pair twice ("Kubernetes" and "K8s" are
    // one gap); a server-side count has to honour the same rule or it inflates
    // the total and caps a score the prompt would not have. Deliberately short
    // and literal: it covers the aliases that show up in real postings, not
    // every synonym in the industry.
    private static readonly string[][] Aliases =
    [
        ["kubernetes", "k8s", "eks", "aks", "gke"],
        ["gcp", "google cloud", "google cloud platform"],
        ["aws", "amazon web services"],
        ["azure", "microsoft azure"],
        ["postgresql", "postgres"],
        ["ci/cd", "cicd", "ci-cd"],
        ["node.js", "nodejs"],
        ["javascript", "js"],
        ["typescript", "ts"],
        ["golang", "go"],
        [".net", "dotnet"],
    ];

    private static string AliasKey(string tech)
    {
        var n = ProfileTrace.Normalize(tech);
        foreach (var group in Aliases)
            if (group.Contains(n)) return group[0];
        return n;
    }

    // Everything the profile says, not only its Skills section: the Evaluator is
    // handed the whole rendered profile, so a technology named in an experience
    // highlight ("Spark jobs in Scala over 5 years of historical consumption
    // data") is genuinely supported and must not be flagged. Skills-only
    // grounding is right for a pack's skills list, which is a list of skills;
    // this reads sentences about the candidate's work.
    public static List<string[]> ProfileEvidence(StructuredProfile profile)
    {
        var phrases = new List<string?>();
        phrases.AddRange(profile.Skills.SelectMany(g => g.Items ?? []));
        phrases.Add(profile.Summary);
        phrases.Add(profile.RawExperienceText);
        foreach (var e in profile.Experience)
        {
            phrases.Add(e.Title);
            phrases.Add(e.Company);
            phrases.AddRange(e.Highlights ?? []);
        }
        foreach (var sp in profile.SideProjects)
        {
            phrases.Add(sp.Name);
            phrases.Add(sp.Description);
            phrases.AddRange(sp.Highlights ?? []);
        }
        return ProfileTrace.ItemTokens(phrases.Where(p => !string.IsNullOrWhiteSpace(p)));
    }

    private static bool Evidenced(string tech, List<string[]> evidence)
    {
        if (ProfileTrace.Traces(tech, evidence)) return true;
        // An alias of something the profile does have is not an absence: a
        // posting asking for "EKS" against a profile listing "Kubernetes" is a
        // partial match, not a missing technology.
        var key = AliasKey(tech);
        return Aliases.FirstOrDefault(g => g[0] == key) is { } group
            && group.Any(a => ProfileTrace.Traces(a, evidence));
    }

    // Alias-deduplicated count of what the posting requires: the denominator of
    // coverage. Counted by the same rules as the gap list, so "EKS" beside
    // "Kubernetes" is one requirement on both sides of the ratio.
    public static int RequirementCount(IEnumerable<string> requiredTech) =>
        requiredTech
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Select(AliasKey)
            .Distinct(StringComparer.Ordinal)
            .Count();

    // The server's own stackedGaps: required technologies the profile does not
    // evidence, de-duplicated across aliases. Order follows the posting, so the
    // list reads like the requirement list it came from.
    public static string[] RequiredButAbsent(
        IEnumerable<string> requiredTech, List<string[]> profileEvidence) =>
        RequiredGroupsButAbsent(
            requiredTech.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => new[] { t }),
            profileEvidence);

    // The same over requirements rather than names: a group is met when the
    // profile evidences ANY of its members, and an unmet group is ONE gap,
    // labelled with its alternatives ("Go / Ruby / Python"). This is what makes
    // "Go, Ruby, or Python" cost a Python candidate nothing instead of two gaps.
    public static string[] RequiredGroupsButAbsent(
        IEnumerable<string[]> requiredGroups, List<string[]> profileEvidence)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var gaps = new List<string>();
        foreach (var raw in requiredGroups)
        {
            var group = raw.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim()).ToArray();
            if (group.Length == 0) continue;
            if (group.Any(t => Evidenced(t, profileEvidence))) continue;
            if (seen.Add(GroupKey(group))) gaps.Add(RequirementGroups.Label(group));
        }
        return gaps.ToArray();
    }

    // Alias-deduplicated count of requirements when alternatives are grouped:
    // the denominator for the coverage ratio, on the same basis as the gap list.
    public static int GroupRequirementCount(IEnumerable<string[]> requiredGroups) =>
        requiredGroups
            .Select(g => g.Where(t => !string.IsNullOrWhiteSpace(t)).ToArray())
            .Where(g => g.Length > 0)
            .Select(GroupKey)
            .Distinct(StringComparer.Ordinal)
            .Count();

    // A group's identity under the alias rules, so ["EKS"] and ["Kubernetes"]
    // are one requirement, exactly as the flat count treated them.
    private static string GroupKey(string[] group) =>
        string.Join("\u0001", group.Select(AliasKey).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal));

    // Words that make a mention an absence rather than a claim. Checked per
    // clause, not per line: "Python strong; Kubernetes new but adjacent"
    // asserts one technology and denies another in one sentence, and reading
    // the sentence as a unit would either miss the claim or flag the honest
    // half. Tuned against stored output, where the model's own vocabulary for
    // a gap is remarkably consistent.
    private static readonly string[] AbsenceMarkers =
    [
        "no ", "not ", "never", "none", "without", "lacks", "lack ", "lacking",
        "missing", "absent", "gap", "new", "unfamiliar", "learnable", "learn",
        "required", "requires", "needs", "unclear", "unknown", "mismatch",
        "weak", "limited", "minimal", "little", "partial", "adjacent",
        "transferable", "rusty", "steep", "less primary", "familiar from",
        "demands", "beyond", "expects", "asks for", "stack gap", "does not",
        "do not", "unrelated", "entirely", "insufficient",
    ];

    // Clause boundaries: ";", "·", and a full stop that actually ends a
    // sentence. The full stop must be followed by whitespace or the end of the
    // text, because technology names contain them — splitting on every "." cut
    // "Node.js" in half and left the fragment "js, and AWS" with no absence
    // marker in it, which turned the honest sentence "...align with your data
    // systems experience. Missing TypeScript, Node.js, React, Next.js, and AWS"
    // into a claim that the candidate has AWS. Measured: that one bug produced
    // most of the checker's false positives.
    //
    // "/" is deliberately not a boundary: the shape the prompt teaches is
    // "Python/Kubernetes/AWS - strong match", one claim per technology sharing
    // a single verdict, so the run has to be read together for the verdict to
    // apply to each name in it.
    private static readonly System.Text.RegularExpressions.Regex ClauseBoundary =
        new(@"[;·]|\.(?=\s|$)", System.Text.RegularExpressions.RegexOptions.Compiled);

    private static bool DeniesPossession(string clause)
    {
        var n = ProfileTrace.Normalize(clause);
        return AbsenceMarkers.Any(m => n.Contains(m, StringComparison.Ordinal));
    }

    // Every technology from `absentTech` that this text asserts the candidate
    // has. A mention inside a clause that denies possession is correct
    // reporting and is skipped.
    public static List<string> ClaimsIn(string? text, IReadOnlyList<string> absentTech)
    {
        var found = new List<string>();
        if (string.IsNullOrWhiteSpace(text) || absentTech.Count == 0) return found;

        foreach (var clause in ClauseBoundary.Split(text))
        {
            if (DeniesPossession(clause)) continue;
            // Two token views of the same clause. ProfileTrace deliberately
            // does NOT split on "/" — "ci/cd" and "pl/sql" are single skills
            // whose punctuation is part of the name — but the shape the prompt
            // teaches joins technologies with it ("Python/Kubernetes/AWS"), so
            // matching only the unsplit view finds nothing in exactly the line
            // that matters. Both views are searched: the slash-split one finds
            // Kubernetes inside that run, the unsplit one still matches CI/CD.
            var clauseTokens = ProfileTrace.ItemTokens([clause]);
            clauseTokens.AddRange(ProfileTrace.ItemTokens([clause.Replace('/', ' ')]));
            foreach (var tech in absentTech)
            {
                if (!ProfileTrace.Traces(tech, clauseTokens)) continue;
                if (!found.Contains(tech, StringComparer.OrdinalIgnoreCase)) found.Add(tech);
            }
        }
        return found;
    }

    // The whole rationale surface the user reads: the fast-scan highlights,
    // every component's one-line reason, and the narrative assessment.
    public static UnsupportedClaim[] Find(
        MatchResponse r, IEnumerable<string> postingTech, StructuredProfile profile)
    {
        var evidence = ProfileEvidence(profile);
        var absent = postingTech
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Where(t => !Evidenced(t, evidence))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (absent.Count == 0) return [];

        var claims = new List<UnsupportedClaim>();
        void Scan(string field, string? text)
        {
            foreach (var tech in ClaimsIn(text, absent))
                claims.Add(new UnsupportedClaim
                {
                    Field = field,
                    Technology = tech,
                    Text = (text ?? "").Trim(),
                });
        }

        foreach (var h in r.QuickHighlights) Scan("quickHighlights", h);
        foreach (var c in AllComponents(r)) Scan($"breakdown.{c.Name}", c.Reason);
        Scan("honestAssessment", r.HonestAssessment);
        return claims.ToArray();
    }

    private static IEnumerable<ScoreComponent> AllComponents(MatchResponse r)
    {
        if (r.Breakdown is null) return [];
        return r.Breakdown.TechnicalFit.Components
            .Concat(r.Breakdown.EngineeringExecutionFit.Components)
            .Concat(r.Breakdown.SustainabilityPaceFit.Components);
    }
}

// One technology asserted as the candidate's with no support in their profile.
// Carried on the response so the card can mark it; never a reason to withhold
// the score.
public sealed record UnsupportedClaim
{
    public string Field { get; init; } = "";
    public string Technology { get; init; } = "";
    public string Text { get; init; } = "";
}

// The Core Stack ceiling: how far a pile of missing requirements pulls the
// technical-fit score down. Separate from the class above because it is the
// consequence, not the check - but it lives here because it consumes the same
// alias rules, and counting gaps and requirements on different bases would make
// the coverage ratio meaningless.
public static class CoreStackCap
{
    public const int MaxScore = 20;
    // Below this many absent requirements, a low Core Stack score is the
    // model's own judgement and is left alone. Unchanged since the cap existed.
    public const int GapThreshold = 4;
    // The ceiling at the threshold, and the highest this cap ever allows.
    public const int Ceiling = 11;

    // Was flat: four gaps and fourteen gaps both capped at 11, so a candidate
    // with 5 of a posting's 17 requirements kept a score that read as a strong
    // technical match. Now scaled by coverage - the share of what the posting
    // asks for that the profile actually evidences.
    //
    // Coverage rather than the raw gap count, because the count alone cannot
    // tell 11 missing of 16 from 11 missing of 40, and because a curve on the
    // count punished honest matches harder than fabricated ones when measured:
    // over 299 real scored jobs across three profiles, a -2-per-gap decay moved
    // 12 verdicts on an on-target backend profile while being milder on the
    // worst mismatches than this is.
    //
    // Still gated on GapThreshold, so this can only ever hold a score at or
    // below where the flat rule held it - never above. Dropping the gate and
    // capping on coverage alone was measured too: on postings that name only
    // three or four technologies, coverage is noise, and it cost honest matches
    // (2 gaps of 4, Core Stack 17/20) seven points each.
    //
    // Floors at 0 by design. A posting whose every stated requirement is absent
    // from the profile has no technical fit to score, and saying so is the point.
    public static int For(int gapCount, int requirementCount)
    {
        if (gapCount < GapThreshold) return MaxScore;      // no cap
        if (requirementCount <= 0) return Ceiling;          // nothing to divide by
        var matched = Math.Max(0, requirementCount - gapCount);
        var scaled = (int)Math.Round(MaxScore * (double)matched / requirementCount,
                                     MidpointRounding.AwayFromZero);
        return Math.Min(Ceiling, scaled);
    }
}
