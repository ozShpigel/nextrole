using ApplicationTracker.Core.Profile;

namespace ApplicationTracker.Core.Models;

// Post-generation fabrication check for Generate Pack — runs once, between
// deserializing ResumePackSynthesis and persisting ResumePack, while the raw
// synthesis (Provenance included) is still in memory. Never blocks: callers
// persist the resulting Violations list alongside the pack and log it, but
// generation always succeeds. Not yet decided whether any of these should
// hard-fail — see ResumePack.Violations.
public static class ResumePackValidator
{
    public static List<ValidationViolation> Validate(
        ResumePackSynthesis synthesis, StructuredProfile profile, string profileText)
    {
        var violations = new List<ValidationViolation>();

        // 1. Every provenance Source must appear verbatim in the exact profile
        // text the model was given — the model's own claimed grounding for a
        // rephrased clause, checked against what it actually had.
        foreach (var row in synthesis.Provenance)
        {
            var source = row.Source?.Trim() ?? "";
            if (source.Length == 0 || !profileText.Contains(source, StringComparison.Ordinal))
            {
                violations.Add(new ValidationViolation
                {
                    Kind = "ProvenanceSourceNotFound",
                    Detail = $"output=\"{row.Output}\" source=\"{row.Source}\"",
                });
            }
        }

        // 2. Every highlightedSkills category name and item must exist in the
        // profile's own skills — exact match, since these are short technology/
        // category names with no legitimate reason to be rephrased.
        var profileCategories = profile.Skills
            .Select(g => g.Category?.Trim() ?? "")
            .ToHashSet(StringComparer.Ordinal);
        var profileItems = profile.Skills
            .SelectMany(g => g.Items ?? [])
            .Select(i => i?.Trim() ?? "")
            .ToHashSet(StringComparer.Ordinal);

        foreach (var group in synthesis.HighlightedSkills)
        {
            var category = group.Category?.Trim() ?? "";
            if (!profileCategories.Contains(category))
            {
                violations.Add(new ValidationViolation
                {
                    Kind = "SkillCategoryNotInProfile",
                    Detail = $"category=\"{group.Category}\"",
                });
            }
            foreach (var item in group.Items ?? [])
            {
                if (!profileItems.Contains(item?.Trim() ?? ""))
                {
                    violations.Add(new ValidationViolation
                    {
                        Kind = "SkillItemNotInProfile",
                        Detail = $"item=\"{item}\" category=\"{group.Category}\"",
                    });
                }
            }
        }

        // 3. Every (company, title, dates) triple must exist in the profile's
        // experience — catches an invented or altered employer/title/date range.
        var profileTriples = profile.Experience
            .Select(e => (
                Company: e.Company?.Trim() ?? "",
                Title: e.Title?.Trim() ?? "",
                Dates: e.Dates?.Trim() ?? ""))
            .ToHashSet();

        foreach (var exp in synthesis.Experience)
        {
            var triple = (
                Company: exp.Company?.Trim() ?? "",
                Title: exp.Title?.Trim() ?? "",
                Dates: exp.Dates?.Trim() ?? "");
            if (!profileTriples.Contains(triple))
            {
                violations.Add(new ValidationViolation
                {
                    Kind = "ExperienceTripleNotInProfile",
                    Detail = $"company=\"{exp.Company}\" title=\"{exp.Title}\" dates=\"{exp.Dates}\"",
                });
            }
        }

        return violations;
    }
}
