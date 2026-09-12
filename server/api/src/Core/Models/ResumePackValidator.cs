using System.Text.RegularExpressions;
using ApplicationTracker.Core.Profile;

namespace ApplicationTracker.Core.Models;

// Post-generation check for Generate Pack — runs once, between deserializing
// ResumePackSynthesis and persisting ResumePack, while the raw synthesis
// (Provenance included) is still in memory.
//
// It does three different things, and the difference matters:
//
//   REPAIR  a skill item with no counterpart anywhere in the profile is dropped
//           from the output and recorded. Mechanical and unambiguous, so fixing
//           it beats both failing the request and shipping it flagged.
//   BLOCK   a numeric figure the profile never stated is a fabricated fact. No
//           server-side edit can make it true, so the pack is refused.
//   FLAG    everything else is recorded on the pack and logged; generation
//           proceeds.
//
// Deliberately NOT checked (rules relaxed 2026-09-10, after measuring 53 stored
// packs against the profile each was generated from): renaming a skill category
// and splitting one profile skill item into several are both ALLOWED. They were
// the top two violation classes, 43 and 28 hits, and both are the résumé being
// reframed toward the posting — wanted behaviour, not fabrication. The prompt's
// TASK 3 forbade them while TASK 6 asked for reframing; TASK 3 was relaxed to
// match. A future re-measure showing these at zero records a RULE CHANGE, not a
// quality improvement.
//
// KNOWINGLY UNCHECKED — the prompt's EVIDENCE LADDER and REFRAMING sections.
// Neither has a code check here, and both are therefore prose the model may
// quietly ignore, exactly as the praise ban was for 53 generations. The only
// difference is that this is written down instead of discovered later.
//
//   EVIDENCE LADDER  whether a highlight climbed to scope rather than settling
//                    for filler is a semantic judgement. Every mechanical proxy
//                    is fake: "contains a number or an ownership verb" passes
//                    "Owned various things" and fails a good scope bullet that
//                    has neither. Its prohibition half IS checked — reaching for
//                    an adjective is what UnfalsifiablePraise catches.
//   REFRAMING        the obvious proxy, keyword overlap between the posting and
//                    the résumé, was rejected on purpose: it rewards keyword
//                    stuffing, which is the ATS-gaming the truth policy exists to
//                    prevent. A check that makes the output worse when it passes
//                    is worse than no check. Reframing that ADDS a claim still
//                    runs into the figure rule, skill traceability and the
//                    experience triples; reframing that DROPS a requirement is
//                    only FLAGGED, not blocked — see check 5.
//
// Only two rules block: a fabricated figure and a header/summary title that
// disagree. Both are exact comparisons over unambiguous data, and both have
// caught real defects ("13+ years", and "PLATFORM DEVELOPER" above a summary
// opening "Senior Backend Developer").
//
// FLAG-TIER BY MEASUREMENT — the requirement-coverage rule (check 5).
//
// It looks like it should block. A requirement the model itself marked
// `confirmed`, missing from the résumé it just wrote, is a self-contradiction,
// and blocking it was the regression test for the dropped-Node.js bug. It was
// specified as blocking, shipped as blocking, and refused correct packs in
// production the same day.
//
// Do not re-promote it from that reasoning. It was measured, and the numbers
// say the premise is wrong. Across 53 real generations (real client, real
// validator, nothing persisted — the stored packs cannot verify this rule,
// none of them carry requirementCoverage rows):
//
//   339  rows marked `confirmed`
//    18  cited evidence that did not verify against the pack's own text
//    13  cited no evidence at all
//     4  packs refused — every one of them wrongly
//     0  genuine omissions caught
//
// The rule rests on the model quoting its own output character for character,
// and it does not do that reliably. It cites the profile's skills line instead
// of the pack's, paraphrases its own summary, or leaves the field empty. Three
// rounds of fixes each removed one failure shape and uncovered another: the
// résumé body being more than the model's output, list ordering, a
// two-character technology name ("AI") filtered as too short, a punctuation
// variant ("NodeJS" vs "Node.js"), and Hebrew requirements against an English
// résumé. That last one is structural — a posting's language and a résumé's
// language need not match, and no matcher fix reaches it.
//
// The errors ran one way only: four false refusals, zero true positives. A
// check that produces only false positives on real data does not need tuning.
//
// What the Node.js bug actually needed was VISIBILITY, not refusal — a dropped
// requirement was invisible, and a flag fixes that. Anyone re-promoting this
// should first re-run the corpus harness and show true positives.
public static class ResumePackValidator
{
    // Normalization, tokenization and the traces-to-profile comparison moved to
    // Core.Profile.ProfileTrace so the Evaluator's rationale grounding asks the
    // question exactly the same way (see ClaimGrounding). Behaviour unchanged.
    private static string Normalize(string? value) => ProfileTrace.Normalize(value);
    private static string[] Tokenize(string normalized) => ProfileTrace.Tokenize(normalized);
    private static bool TracesToProfile(string? item, List<string[]> profileItemTokens) =>
        ProfileTrace.Traces(item, profileItemTokens);

    // A numeric figure: a digit run with the magnitude/percent/plus suffixes these
    // résumés actually use — "700+", "50%", "14k+", "13+", "2023".
    private static readonly Regex FigurePattern =
        new(@"\d[\d.,]*\s?[kmb]?\+?%?", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    // Does the profile text actually state this figure?
    //
    // NOT a plain substring test. A CV is dense with years, so "13" is a
    // substring of "2013", "15" of "2015" and "20" of "2026" — which let a
    // fabricated "13 years of experience" pass against a profile that merely
    // employed the candidate in 2013. Verified: bare "13 years", "15 years" and
    // "20 years" all passed the substring version.
    //
    // So the match must stand alone as a number: no digit (or decimal separator)
    // immediately before it, and nothing immediately after that would make it a
    // different quantity — another digit, a magnitude letter, a percent or a
    // plus. "2011" inside "2011-2013" still matches (a hyphen follows), while a
    // bare "14" against a profile's "14K+" does not.
    private static bool ProfileStatesFigure(string normalizedProfileText, string figure)
    {
        var pattern = $@"(?<![\d.,]){Regex.Escape(figure)}(?![\d%+]|[kmb])";
        return Regex.IsMatch(normalizedProfileText, pattern, RegexOptions.CultureInvariant);
    }

    // Raised 60 -> 80 on 2026-09-10: 60 was breached by 4 of 53 stored packs (up
    // to 80 words) and the ceiling, not the output, was judged wrong.
    private const int SummaryWordCeiling = 80;


    // Unfalsifiable praise — a claim about what KIND of engineer the candidate
    // is, rather than a statement of what they did. The prompt has banned these
    // from the start and the model kept writing them anyway: "Strong track record
    // of owning systems end to end" and "Focuses on reducing complexity and owning
    // data reliability end to end" both shipped with zero violations, because the
    // ban was prose-only with nothing checking it.
    //
    // The trait-CLAIM openers matter more than the adjectives: an adjective is
    // easy to spot in review, whereas "focuses on X" reads like a fact and is not
    // one. Nothing in a profile can confirm or contradict either.
    //
    // FLAG, never blocking: this is a judgement about phrasing, and a false
    // positive must not cost the candidate a résumé.
    //
    // Matched with a leading word boundary and no trailing one, so "robust" also
    // catches "robustness" and "seamless" catches "seamlessly" without needing an
    // entry per inflection. Kept deliberately short — a bloated list would
    // recreate the very noise that made the earlier violations unreadable.
    private static readonly string[] PraisePhrases =
    [
        // Trait claims.
        "track record", "focuses on", "focused on", "known for", "proven ability",
        "passionate", "specializes in", "specialising in", "specializing in",
        // Unfalsifiable adjectives.
        "resilient", "robust", "seamless", "cutting-edge", "cutting edge",
        "results-driven", "results driven", "methodical", "fast-moving", "fast moving",
        "world-class", "best-in-class", "keeps them reliable",
    ];

    // TASK 2's lowest tier: "Worked in", "Worked with", "Was part of" describe an
    // environment rather than anything the candidate did, and the prompt says such
    // a highlight "goes last, always".
    private static readonly string[] TierFourOpeners = ["worked in", "worked with", "was part of"];

    private static bool IsTierFour(string? highlight)
    {
        var normalized = Normalize(highlight);
        return Array.Exists(TierFourOpeners, o => normalized.StartsWith(o, StringComparison.Ordinal));
    }

    // Responsibility verbs by rank. The rephrasing rule says a verb of
    // responsibility is a fact, not style: "contributed" must not become "led",
    // and downgrading is equally wrong. Rank change in either direction is the
    // violation; synonyms within a rank ("built" for "developed") are fine, which
    // is what makes this checkable without judging prose.
    private static readonly Dictionary<string, int> VerbRank = new(StringComparer.Ordinal)
    {
        ["helped"] = 1, ["assisted"] = 1, ["supported"] = 1, ["participated"] = 1,
        ["contributed"] = 1, ["worked"] = 1, ["involved"] = 1, ["collaborated"] = 1,
        ["developed"] = 2, ["built"] = 2, ["created"] = 2, ["implemented"] = 2,
        ["designed"] = 2, ["architected"] = 2, ["delivered"] = 2, ["maintained"] = 2,
        ["wrote"] = 2, ["automated"] = 2, ["integrated"] = 2, ["migrated"] = 2,
        ["owned"] = 3, ["led"] = 3, ["drove"] = 3, ["headed"] = 3, ["managed"] = 3,
        ["spearheaded"] = 3, ["established"] = 3, ["founded"] = 3,
    };

    private static int? LeadingVerbRank(string text)
    {
        var first = Tokenize(Normalize(text)).FirstOrDefault();
        return first is not null && VerbRank.TryGetValue(first, out var rank) ? rank : null;
    }

    // The PDF prints more than the model authors. Education, military service,
    // spoken languages and location render straight from the profile — TASK 4
    // tells the model explicitly that they are NOT part of its output. They are
    // still ON the résumé, so a requirement met by them ("Degree in Computer
    // Science", "Fluent English", "Based in Israel") is genuinely covered while
    // the model has no field it could possibly quote.
    //
    // Defining the résumé body as model output alone made every degree
    // requirement unsatisfiable, and refused those packs in production.
    //
    // Name, email, phone and LinkedIn are excluded: they identify the candidate
    // rather than evidencing anything a posting asks for.
    // Each credential is emitted both split and joined. A citation of a degree
    // arrives as "HIT, Holon - Bachelor of Science (B.Sc.) in Computer Science,
    // 2012" — the two fields read as one line on the page, so that is how the
    // model quotes them, and yielding only the parts refused those packs.
    private static IEnumerable<string> ProfileRenderedSections(StructuredProfile profile)
    {
        foreach (var item in profile.Education.Concat(profile.MilitaryService))
        {
            yield return item.Institution;
            yield return item.Detail;
            yield return $"{item.Institution} - {item.Detail}";
            yield return $"{item.Institution}, {item.Detail}";
        }
        foreach (var language in profile.SpokenLanguages) yield return language;
        if (!string.IsNullOrWhiteSpace(profile.Location)) yield return profile.Location!;
    }

    // The skills block as it reads on the page. OutputText yields each item on
    // its own (so the figure and praise checks see items, not headings), but the
    // PDF prints "Platform & DevOps: Kubernetes, Helm, Terraform, ..." and the
    // model cites that whole line, heading included. The category name is the
    // model's own wording — TASK 3 lets it rename — so this is still its output.
    private static IEnumerable<string> RenderedSkillLines(ResumePackSynthesis synthesis)
    {
        foreach (var group in synthesis.HighlightedSkills)
        {
            var items = string.Join(", ", group.Items ?? []);
            yield return group.Category;
            yield return $"{group.Category}: {items}";
        }
    }

    // Is this citation actually on the résumé?
    //
    // Exact containment first. The fallback exists because TASK 3 has the model
    // reorder and subset skills toward the posting, so a citation of a skills
    // line — "Kubernetes, Helm, Terraform, Ansible, ..." — is a list whose order
    // is not stable, and quoting one character for character is brittle by
    // construction. That refused correct packs in production.
    //
    // So a LIST-shaped citation is satisfied when every item in it appears, in
    // any order. Still exact per item, never fuzzy. Restricted to citations whose
    // segments are all short: a prose clause that happens to contain a comma
    // stays an exact match, otherwise "Owned X, built Y" would pass against two
    // unrelated highlights in different entries.
    private static bool EvidenceIsOnResume(string resumeBody, string normalizedEvidence)
    {
        if (resumeBody.Contains(normalizedEvidence, StringComparison.Ordinal)) return true;

        var items = normalizedEvidence.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (items.Length < 2) return false;
        if (Array.Exists(items, i => i.Split(' ').Length > 4)) return false;

        return Array.TrueForAll(items, item =>
            Regex.IsMatch(resumeBody, $@"(?<![a-z0-9]){Regex.Escape(item)}(?![a-z0-9])",
                RegexOptions.CultureInvariant));
    }

    // Words a posting uses in nearly every requirement. Excluded when asking
    // whether a requirement left any trace on the résumé, so that "experience"
    // matching "experience" cannot satisfy a row trivially.
    private static readonly HashSet<string> GenericRequirementWords = new(StringComparer.Ordinal)
    {
        "the", "and", "or", "of", "in", "with", "for", "to", "on", "at", "as", "by",
        "from", "our", "you", "your", "their", "who", "that", "this", "are", "is",
        "be", "have", "has", "will", "can", "must", "should", "able", "ability",
        "experience", "experienced", "years", "year", "strong", "solid", "proven",
        "deep", "hands-on", "hands", "knowledge", "understanding", "familiarity",
        "familiar", "skills", "skill", "working", "work", "build", "building",
        "develop", "development", "design", "designing", "team", "teams", "role",
        "plus", "advantage", "required", "requirements", "preferred", "excellent",
        "good", "great", "high", "quality", "using", "use", "well", "such", "equivalent",
        "practical", "least", "including", "related", "similar", "etc", "a", "an",
    };

    // Did this requirement leave ANY trace on the résumé?
    //
    // Used ONLY to VETO a refusal, never to cause one — which is what makes a
    // weak signal safe here. Matching the posting's vocabulary against a résumé
    // deliberately reframed into the target role's (TASK 6) is approximate, so a
    // false positive means "don't block", never "block".
    //
    // Returns true when it cannot tell (a requirement of nothing but generic
    // words), because unverifiable must not mean refused.
    private static bool RequirementLeavesTrace(string requirement, string resumeBody)
    {
        var distinctive = Tokenize(Normalize(requirement))
            .Where(t => t.Length > 2 && !GenericRequirementWords.Contains(t))
            .ToList();
        if (distinctive.Count == 0) return true;

        return distinctive.Exists(t =>
            Regex.IsMatch(resumeBody, $@"(?<![a-z0-9]){Regex.Escape(t)}", RegexOptions.CultureInvariant));
    }

    public static ResumePackValidation Validate(
        ResumePackSynthesis synthesis, StructuredProfile profile, string profileText, ProfileFacts? facts = null)
    {
        var violations = new List<ValidationViolation>();
        var derivedFigures = (facts?.Figures ?? []).ToHashSet(StringComparer.Ordinal);

        // 0. Summary length. Models count words poorly — flag only, never
        // truncate (a summary cut mid-sentence is worse than a long one).
        var summaryWordCount = synthesis.TailoredSummary
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Length;
        if (summaryWordCount > SummaryWordCeiling)
        {
            violations.Add(new ValidationViolation
            {
                Kind = "TailoredSummaryTooLong",
                Detail = $"words={summaryWordCount} (ceiling={SummaryWordCeiling})",
            });
        }

        // 1. Every provenance Source must appear in the exact profile text the
        // model was given — its own claimed grounding, checked against what it had.
        var normalizedProfileText = Normalize(profileText);
        foreach (var row in synthesis.Provenance)
        {
            var source = Normalize(row.Source);
            if (source.Length == 0 || !normalizedProfileText.Contains(source, StringComparison.Ordinal))
            {
                violations.Add(new ValidationViolation
                {
                    Kind = "ProvenanceSourceNotFound",
                    Detail = $"output=\"{row.Output}\" source=\"{row.Source}\"",
                });
            }
        }

        // 2. REPAIR: every skill item must trace back to the profile. Category
        // names are free (reframing), and one profile item may be split across
        // several output items — but an item with no profile counterpart at all
        // is dropped here rather than shipped. A category left empty by the drop
        // goes with it.
        var profileItemTokens = profile.Skills
            .SelectMany(g => g.Items ?? [])
            .Select(i => Tokenize(Normalize(i)))
            .Where(t => t.Length > 0)
            .ToList();

        var repairedSkills = new List<SkillCategory>();
        foreach (var group in synthesis.HighlightedSkills)
        {
            var kept = new List<string>();
            foreach (var item in group.Items ?? [])
            {
                if (TracesToProfile(item, profileItemTokens))
                {
                    kept.Add(item);
                }
                else
                {
                    violations.Add(new ValidationViolation
                    {
                        Kind = "SkillItemDropped",
                        Detail = $"item=\"{item}\" category=\"{group.Category}\" (no counterpart in profile)",
                    });
                }
            }
            if (kept.Count > 0) repairedSkills.Add(group with { Items = kept });
        }

        // 2b. REPAIR: a tier-4 highlight must not open an entry. TASK 2 states it
        // "goes last, always", which makes this a pure reordering — no text
        // changes, nothing is dropped — so repairing beats flagging. The model's
        // ordering of everything else is preserved (stable partition).
        var repairedExperience = new List<TailoredExperienceItem>();
        foreach (var entry in synthesis.Experience)
        {
            var highlights = entry.Highlights ?? [];
            if (highlights.Count < 2 || !IsTierFour(highlights[0]))
            {
                repairedExperience.Add(entry);
                continue;
            }

            var reordered = highlights.Where(h => !IsTierFour(h))
                .Concat(highlights.Where(IsTierFour))
                .ToList();
            // All tier-4 means there is nothing better to lead with.
            if (reordered.SequenceEqual(highlights, StringComparer.Ordinal))
            {
                repairedExperience.Add(entry);
                continue;
            }

            violations.Add(new ValidationViolation
            {
                Kind = "TierFourHighlightMovedLast",
                Detail = $"company=\"{entry.Company}\" opened with \"{Truncate(highlights[0])}\"",
            });
            repairedExperience.Add(entry with { Highlights = reordered });
        }

        // 3. Every (company, title, dates) triple must exist in the profile —
        // catches an invented or altered employer, title or date range.
        var profileTriples = profile.Experience
            .Select(e => (Company: Normalize(e.Company), Title: Normalize(e.Title), Dates: Normalize(e.Dates)))
            .ToHashSet();

        foreach (var exp in synthesis.Experience)
        {
            var triple = (Company: Normalize(exp.Company), Title: Normalize(exp.Title), Dates: Normalize(exp.Dates));
            if (!profileTriples.Contains(triple))
            {
                violations.Add(new ValidationViolation
                {
                    Kind = "ExperienceTripleNotInProfile",
                    Detail = $"company=\"{exp.Company}\" title=\"{exp.Title}\" dates=\"{exp.Dates}\"",
                });
            }
        }

        // 4. BLOCKING: every numeric figure in the output must come from one of
        // exactly two sources. No rounding, no recomputation, no exceptions.
        //
        //   QUOTED   stated verbatim in the profile text — "700+ developers",
        //            "50%", "14K+ runs". These ship as written.
        //   DERIVED  computed server-side from structured profile data and handed
        //            to the model as a given fact (see ProfileFacts). Currently
        //            just yearsOfExperience, so "14 years" is legal without the
        //            candidate having typed that string anywhere.
        //
        // Anything else — a computed "13+ years", a rounded "800 developers" — is
        // a fabricated fact and rejects the whole pack.
        foreach (var (field, text) in OutputText(synthesis))
        {
            foreach (Match m in FigurePattern.Matches(Normalize(text)))
            {
                // Trailing sentence punctuation gets swept up by [\d.,]* above.
                var figure = m.Value.Trim().TrimEnd('.', ',');
                if (figure.Length == 0) continue;
                if (derivedFigures.Contains(figure)) continue;
                if (ProfileStatesFigure(normalizedProfileText, figure)) continue;

                violations.Add(new ValidationViolation
                {
                    Kind = "FigureNotInProfile",
                    Detail = $"figure=\"{figure}\" in {field}: \"{Truncate(text)}\"",
                    Blocking = true,
                });
            }
        }

        // 5. BLOCKING: a requirement the model itself called "confirmed" must
        // actually appear in the résumé, and the model must say where. This is the
        // regression test for the dropped-Node.js case — the posting named
        // Node.js, the profile lists it, and the pack shipped without it. Claiming
        // coverage the document does not deliver is the one coverage error that
        // cannot be repaired server-side: only the model knows which line was
        // supposed to carry it.
        //
        // Checked as an exact (normalized) quote of the pack's own text, not as a
        // fuzzy match of the requirement against the résumé. The requirement is in
        // the posting's vocabulary and the résumé is deliberately reframed into
        // the target role's (TASK 6), so any match between them is approximate —
        // and an approximate rule that refuses packs will refuse a correct one
        // sooner or later.
        //
        // It refused correct packs anyway, and kept doing so after each fix. The
        // shapes found, in order: the résumé body is more than the model's own
        // output (education renders from the profile — see ProfileRenderedSections);
        // a skills line is a list whose order is not stable (EvidenceIsOnResume);
        // the model cites the profile's skills line rather than its own; it
        // paraphrases its own summary; it leaves evidence empty.
        //
        // Measured over 53 live generations with the veto below in place: 4 packs
        // refused, ALL FOUR wrong, ZERO genuine omissions caught. The causes were
        // a 2-character technology name filtered out as too short ("AI"), a
        // punctuation variant ("NodeJS" against a résumé's "Node.js"), and two
        // Hebrew-language requirements against an English résumé.
        //
        // So this no longer blocks. The premise — that the model reliably quotes
        // its own output character for character — does not hold, and a rule
        // resting on it costs correct packs while catching nothing. It stays as a
        // flag: a dropped requirement is still surfaced for review, which is what
        // the Node.js case needed in the first place.
        // Joined with ", " rather than " " because that is how the résumé reads:
        // skill items are yielded one per entry, so a model quoting the skills
        // line it wrote cites "Kafka, RabbitMQ, MongoDB, SQL Server". A space
        // join produced "kafka rabbitmq mongodb sql server" and refused four
        // correct rows on the first live run.
        var resumeBody = Normalize(string.Join(", ", OutputText(synthesis).Select(t => t.Text)
            .Concat(RenderedSkillLines(synthesis))
            .Concat(ProfileRenderedSections(profile))));
        foreach (var row in synthesis.RequirementCoverage)
        {
            var isConfirmed = string.Equals(Normalize(row.Coverage), "confirmed", StringComparison.Ordinal);
            var evidence = Normalize(row.Evidence);

            if (evidence.Length > 0 && EvidenceIsOnResume(resumeBody, evidence)) continue;
            if (!isConfirmed)
            {
                if (evidence.Length > 0)
                {
                    violations.Add(new ValidationViolation
                    {
                        Kind = "CoverageEvidenceNotFound",
                        Detail = $"requirement=\"{row.Requirement}\" cites evidence not present in the "
                               + $"résumé: \"{Truncate(row.Evidence)}\"",
                    });
                }
                continue;
            }

            // The citation did not check out. Refuse ONLY if the requirement also
            // left no trace of its own on the résumé — that is the thing actually
            // worth blocking (the posting named Node.js, the profile has it, the
            // résumé dropped it). A citation that is merely sloppy — quoting the
            // profile's skills line instead of the pack's, paraphrasing its own
            // summary, or omitted entirely — is a flag, because the requirement
            // demonstrably IS on the page. Measured over live generations, every
            // refusal from the strict version was of this second kind: SQL Server,
            // the B.Sc. and the .NET experience were all present and cited badly.
            if (RequirementLeavesTrace(row.Requirement, resumeBody))
            {
                violations.Add(new ValidationViolation
                {
                    Kind = "ConfirmedRequirementEvidenceUnverified",
                    Detail = $"requirement=\"{row.Requirement}\" is on the résumé but its citation does "
                           + $"not match: \"{Truncate(row.Evidence)}\"",
                });
                continue;
            }

            violations.Add(new ValidationViolation
            {
                Kind = "ConfirmedRequirementMissingFromResume",
                Detail = $"requirement=\"{row.Requirement}\" marked confirmed but neither its citation "
                       + $"(\"{Truncate(row.Evidence)}\") nor the requirement itself appears in the résumé",
                // NOT blocking. Measured over 53 live generations: it refused 4
                // correct packs and caught 0 genuine omissions. See the note above
                // this check for the three causes.
                Blocking = false,
            });
        }

        // 5b. A posting that bundles several TECHNOLOGIES into one requirement
        // ("Experience with Kafka, Redis, AWS, Docker, Kubernetes") gets one label
        // for the whole bundle, and that label lands pessimistic: it reads as a
        // capability gap even when the candidate solidly has most of the list.
        // TASK 0 asks for one row per technology; this flags what slips through.
        //
        // Restricted to technology bundles on purpose. A domain list — "fintech /
        // payments / SaaS" — looks identical structurally, but splitting it just
        // produces three rows carrying the same evidence, so flagging it was a bug
        // in this check rather than a failure by the model.
        //
        // The candidate's own skills are the only technology vocabulary available
        // here, so a bundle qualifies when at least one item is a skill the profile
        // names. That misses bundles made entirely of technologies the candidate
        // lacks — but those are uniformly gaps, and splitting them yields identical
        // rows, which is the same reason domain lists are excluded.
        var profileSkillNames = profile.Skills
            .SelectMany(g => g.Items ?? [])
            .Select(Normalize)
            .Where(i => i.Length > 0)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var row in synthesis.RequirementCoverage)
        {
            var normalizedRequirement = Normalize(row.Requirement);
            var segments = normalizedRequirement
                .Split([",", " / "], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (segments.Length < 2) continue;
            // Two or more single-word segments is what a list looks like; one stray
            // short clause ("Git, CI/CD, and production environments") is not.
            if (segments.Count(seg => !seg.Contains(' ')) < 2) continue;

            var namesTechnology = Tokenize(normalizedRequirement).Any(profileSkillNames.Contains)
                                  || segments.Any(profileSkillNames.Contains);
            if (!namesTechnology) continue;

            violations.Add(new ValidationViolation
            {
                Kind = "BundledRequirement",
                Detail = $"requirement=\"{row.Requirement}\" bundles {segments.Length} items under one "
                       + $"{row.Coverage}/{row.GapType} label; split it per technology",
            });
        }

        // 5c. BLOCKING: the header title and the summary's opening title must be
        // the same title. TargetTitle renders directly under the candidate's name
        // while the summary opens with the role identity, and TASK 6 requires them
        // to agree — a document that says "PLATFORM DEVELOPER" above a summary
        // opening "Senior Backend Developer" reads as two résumés spliced together.
        // That exact mismatch shipped to a PDF.
        //
        // A plain prefix comparison, because TASK 1 requires the summary to open
        // with the role title and nothing before it.
        if (!string.IsNullOrWhiteSpace(synthesis.TargetTitle))
        {
            var headerTitle = Normalize(synthesis.TargetTitle);
            var summaryOpening = Normalize(synthesis.TailoredSummary);
            if (headerTitle.Length > 0 && summaryOpening.Length > 0
                && !summaryOpening.StartsWith(headerTitle, StringComparison.Ordinal))
            {
                var opening = synthesis.TailoredSummary.Length <= 60
                    ? synthesis.TailoredSummary
                    : synthesis.TailoredSummary[..60] + "...";
                violations.Add(new ValidationViolation
                {
                    Kind = "TitleDisagreesWithSummary",
                    Detail = $"targetTitle=\"{synthesis.TargetTitle}\" but the summary opens \"{opening}\"",
                    Blocking = true,
                });
            }
        }

        // 6. Confirmation items exist to close EVIDENCE gaps and nothing else.
        // Flag: a mismatch means the model misread its own taxonomy — a wording
        // gap should have been fixed in the résumé, a capability gap stated plainly.
        var evidenceGaps = synthesis.RequirementCoverage
            .Count(r => string.Equals(Normalize(r.GapType), "evidence", StringComparison.Ordinal));
        if (evidenceGaps != synthesis.ConfirmationItems.Count)
        {
            violations.Add(new ValidationViolation
            {
                Kind = "ConfirmationItemsMismatch",
                Detail = $"evidenceGaps={evidenceGaps} confirmationItems={synthesis.ConfirmationItems.Count}",
            });
        }

        // 6b. Verb fidelity. "Contributed" becoming "led" is a claim upgrade, the
        // same defect class as a computed figure — it changes what the candidate
        // did. Provenance already pairs each rephrased clause with the profile
        // text it came from, so the two leading verbs can be compared directly.
        //
        // Flag, not blocking, for two reasons: provenance is not always present
        // (unchanged highlights need no row, and the model sometimes merges
        // sources), so a blocking version would be silent exactly where it matters
        // and loud where it doesn't; and ranking verbs is a judgement encoded as a
        // table, which is not the kind of thing that should refuse a résumé.
        foreach (var row in synthesis.Provenance)
        {
            var outputRank = LeadingVerbRank(row.Output ?? "");
            var sourceRank = LeadingVerbRank(row.Source ?? "");
            if (outputRank is null || sourceRank is null || outputRank == sourceRank) continue;

            violations.Add(new ValidationViolation
            {
                Kind = outputRank > sourceRank ? "ResponsibilityVerbUpgraded" : "ResponsibilityVerbDowngraded",
                Detail = $"output=\"{Truncate(row.Output ?? "")}\" (rank {outputRank}) from "
                       + $"source=\"{Truncate(row.Source ?? "")}\" (rank {sourceRank})",
            });
        }

        // 7. Unfalsifiable praise. Flag only — see PraisePhrases.
        foreach (var (field, text) in OutputText(synthesis))
        {
            var normalized = Normalize(text);
            foreach (var phrase in PraisePhrases)
            {
                if (!Regex.IsMatch(normalized, $@"\b{Regex.Escape(phrase)}", RegexOptions.CultureInvariant)) continue;

                violations.Add(new ValidationViolation
                {
                    Kind = "UnfalsifiablePraise",
                    Detail = $"phrase=\"{phrase}\" in {field}: \"{Truncate(text)}\"",
                });
            }
        }

        return new ResumePackValidation
        {
            Synthesis = synthesis with { HighlightedSkills = repairedSkills, Experience = repairedExperience },
            Violations = violations,
        };
    }

    private static string Truncate(string s) => s.Length <= 120 ? s : s[..120] + "...";

    // Every model-authored string that can carry a figure. Links are excluded:
    // the prompt passes them through from the profile verbatim, so digits inside
    // a URL are not a claim the model made.
    private static IEnumerable<(string Field, string Text)> OutputText(ResumePackSynthesis s)
    {
        if (!string.IsNullOrWhiteSpace(s.TailoredSummary)) yield return ("tailoredSummary", s.TailoredSummary);
        if (!string.IsNullOrWhiteSpace(s.TargetTitle)) yield return ("targetTitle", s.TargetTitle!);

        foreach (var e in s.Experience)
        {
            yield return ("experience.header", $"{e.Company} {e.Title} {e.Dates}");
            foreach (var h in e.Highlights ?? []) yield return ($"experience[{e.Company}].highlight", h);
        }

        foreach (var g in s.HighlightedSkills)
        {
            foreach (var i in g.Items ?? []) yield return ($"skills[{g.Category}]", i);
        }

        foreach (var p in s.SideProjects)
        {
            if (!string.IsNullOrWhiteSpace(p.Name)) yield return ("sideProject.name", p.Name);
            if (!string.IsNullOrWhiteSpace(p.Description)) yield return ("sideProject.description", p.Description);
            foreach (var h in p.Highlights ?? []) yield return ($"sideProject[{p.Name}].highlight", h);
        }
    }
}

// Result of a validation pass: the synthesis to persist (repairs applied) plus
// everything recorded about it. HasBlocking means the pack must not be saved.
public sealed record ResumePackValidation
{
    public required ResumePackSynthesis Synthesis { get; init; }
    public required List<ValidationViolation> Violations { get; init; }
    public bool HasBlocking => Violations.Exists(v => v.Blocking);
}
