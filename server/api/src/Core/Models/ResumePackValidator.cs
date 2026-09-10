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
public static class ResumePackValidator
{
    // All comparisons run on normalized text. The output is expected to differ
    // from the profile in *representation* without differing in content: the
    // prompt's OUTPUT section orders ASCII punctuation ("plain hyphens, straight
    // quotes") while the profile stores real typography, so a date range held as
    // "2023–2026" comes back as "2023-2026" and an exact comparison reports the
    // employer as fabricated. Every ExperienceTripleNotInProfile across 53 stored
    // packs was that en-dash.
    //
    // Normalization is deliberately narrow — dash forms, quote forms, whitespace
    // runs, letter case. It never strips or trims words: dropping a qualifier
    // changes the claim, which is content.
    private static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";

        var sb = new System.Text.StringBuilder(value.Length);
        var pendingSpace = false;
        foreach (var ch in value)
        {
            var c = ch switch
            {
                // Hyphen/dash family: U+2010..U+2015, non-breaking hyphen, minus sign.
                '‐' or '‑' or '‒' or '–' or '—' or '―' or '−' => '-',
                // Curly apostrophes and quotes.
                '‘' or '’' or '‛' or 'ʼ' => '\'',
                '“' or '”' or '‟' => '"',
                _ => ch,
            };

            // Collapse any whitespace run to a single space: the rendered profile
            // hard-wraps, so a quoted source can carry newlines the original does
            // not. char.IsWhiteSpace covers NBSP (U+00A0) and friends.
            if (char.IsWhiteSpace(c))
            {
                pendingSpace = sb.Length > 0;
                continue;
            }
            if (pendingSpace) { sb.Append(' '); pendingSpace = false; }
            sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }

    // Splits on whitespace and grouping punctuation only — NOT on every symbol,
    // because "c#", ".net", "ci/cd" and "pl/sql" are single skills whose
    // punctuation is part of the name.
    private static readonly char[] TokenSeparators = [' ', '(', ')', '[', ']', ',', ';'];

    private static string[] Tokenize(string normalized) =>
        normalized.Split(TokenSeparators, StringSplitOptions.RemoveEmptyEntries);

    // A skill item traces to the profile when its tokens appear as a contiguous
    // run inside some profile item's tokens. Token-level rather than raw
    // substring, so splitting "LLM integration (Anthropic API)" into "LLM
    // integration" and "Anthropic API" lets both trace, while "Go" does not
    // falsely trace to "Django".
    private static bool TracesToProfile(string? item, List<string[]> profileItemTokens)
    {
        var tokens = Tokenize(Normalize(item));
        if (tokens.Length == 0) return false;

        foreach (var candidate in profileItemTokens)
        {
            for (var start = 0; start + tokens.Length <= candidate.Length; start++)
            {
                var all = true;
                for (var i = 0; i < tokens.Length && all; i++)
                {
                    if (!string.Equals(candidate[start + i], tokens[i], StringComparison.Ordinal)) all = false;
                }
                if (all) return true;
            }
        }
        return false;
    }

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
        // Joined with ", " rather than " " because that is how the résumé reads:
        // skill items are yielded one per entry, so a model quoting the skills
        // line it wrote cites "Kafka, RabbitMQ, MongoDB, SQL Server". A space
        // join produced "kafka rabbitmq mongodb sql server" and refused four
        // correct rows on the first live run.
        var resumeBody = Normalize(string.Join(", ", OutputText(synthesis).Select(t => t.Text)));
        foreach (var row in synthesis.RequirementCoverage)
        {
            var isConfirmed = string.Equals(Normalize(row.Coverage), "confirmed", StringComparison.Ordinal);
            var evidence = Normalize(row.Evidence);

            if (evidence.Length == 0)
            {
                // Only a "confirmed" row owes evidence. A gap has nothing to point at.
                if (isConfirmed)
                {
                    violations.Add(new ValidationViolation
                    {
                        Kind = "ConfirmedRequirementMissingFromResume",
                        Detail = $"requirement=\"{row.Requirement}\" marked confirmed but cites no evidence",
                        Blocking = true,
                    });
                }
                continue;
            }

            if (resumeBody.Contains(evidence, StringComparison.Ordinal)) continue;

            violations.Add(new ValidationViolation
            {
                Kind = isConfirmed ? "ConfirmedRequirementMissingFromResume" : "CoverageEvidenceNotFound",
                Detail = $"requirement=\"{row.Requirement}\" cites evidence not present in the résumé: "
                       + $"\"{Truncate(row.Evidence)}\"",
                Blocking = isConfirmed,
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
            Synthesis = synthesis with { HighlightedSkills = repairedSkills },
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
