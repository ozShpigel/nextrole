using System.Text;

namespace ApplicationTracker.Core.Profile;

// Renders a StructuredProfile into the canonical XML-ish `<professional_profile>`
// string that the scoring/interview prompts consume via {{USER_PROFILE}}. This is
// the single source of truth for the prompt-facing profile text: persistence
// stores the StructuredProfile and the derived rendered content together, so all
// existing consumers (GetProfileAsync) keep receiving a plain string unchanged.
public static class ProfileRenderer
{
    public static string Render(StructuredProfile p)
    {
        var sb = new StringBuilder();
        sb.AppendLine("<professional_profile>");

        if (!string.IsNullOrWhiteSpace(p.Summary))
        {
            sb.AppendLine();
            sb.AppendLine("<summary>");
            sb.AppendLine(p.Summary.Trim());
            sb.AppendLine("</summary>");
        }

        var meta = new List<string>();
        if (!string.IsNullOrWhiteSpace(p.Seniority)) meta.Add($"Seniority: {p.Seniority!.Trim()}");
        if (p.Domains is { Length: > 0 }) meta.Add($"Domains: {string.Join(", ", Clean(p.Domains))}");
        if (meta.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("<profile_meta>");
            foreach (var m in meta) sb.AppendLine($"- {m}");
            sb.AppendLine("</profile_meta>");
        }

        AppendList(sb, "core_values", p.CoreValues);
        AppendList(sb, "strengths", p.Strengths);
        AppendList(sb, "red_flags", p.RedFlags);

        var skills = RenderSkills(p.Skills);
        if (skills.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("<skills>");
            foreach (var line in skills) sb.AppendLine($"- {line}");
            sb.AppendLine("</skills>");
        }

        var roles = p.Experience?.Where(e => e is not null
            && (!string.IsNullOrWhiteSpace(e.Title) || !string.IsNullOrWhiteSpace(e.Company)
                || e.Highlights is { Length: > 0 })).ToArray() ?? [];
        if (roles.Length > 0)
        {
            sb.AppendLine();
            sb.AppendLine("<experience>");
            foreach (var role in roles)
            {
                var title = string.IsNullOrWhiteSpace(role.Title) ? "" : role.Title.Trim();
                var company = string.IsNullOrWhiteSpace(role.Company) ? "" : role.Company.Trim();
                var dates = string.IsNullOrWhiteSpace(role.Dates) ? "" : role.Dates.Trim();
                sb.AppendLine();
                sb.AppendLine($"  <role title=\"{Escape(title)}\" company=\"{Escape(company)}\" dates=\"{Escape(dates)}\">");
                foreach (var h in Clean(role.Highlights)) sb.AppendLine($"  - {h}");
                sb.AppendLine("  </role>");
            }
            sb.AppendLine("</experience>");
        }

        AppendList(sb, "education", p.Education);
        AppendList(sb, "military_service", p.MilitaryService);
        AppendSideProjects(sb, p.SideProjects);
        AppendList(sb, "spoken_languages", p.SpokenLanguages);

        sb.AppendLine();
        sb.Append("</professional_profile>");
        return sb.ToString();
    }

    // Separate from AppendList because a project's links are part of what the
    // Generate Pack prompt is told to "pass through exactly as it appears in
    // the profile" — a bare name/description bullet would give it nothing to
    // pass through even when the user has added real URLs in Settings.
    private static void AppendSideProjects(StringBuilder sb, ApplicationTracker.Core.Models.SideProjectItem[]? items)
    {
        var clean = (items ?? [])
            .Where(i => !string.IsNullOrWhiteSpace(i?.Name) || !string.IsNullOrWhiteSpace(i?.Description))
            .ToList();
        if (clean.Count == 0) return;

        sb.AppendLine();
        sb.AppendLine("<side_projects>");
        foreach (var item in clean)
        {
            var line = string.IsNullOrWhiteSpace(item.Description) ? item.Name : $"{item.Name} — {item.Description}";
            var links = (item.Links ?? []).Where(l => !string.IsNullOrWhiteSpace(l)).ToList();
            if (links.Count > 0) line += $" ({string.Join(", ", links)})";
            sb.AppendLine($"- {line}");
        }
        sb.AppendLine("</side_projects>");
    }

    private static void AppendList(StringBuilder sb, string tag, string[]? items)
    {
        var clean = Clean(items);
        if (clean.Count == 0) return;
        sb.AppendLine();
        sb.AppendLine($"<{tag}>");
        foreach (var i in clean) sb.AppendLine($"- {i}");
        sb.AppendLine($"</{tag}>");
    }

    private static List<string> RenderSkills(SkillGroups? s)
    {
        var lines = new List<string>();
        if (s is null) return lines;
        void Add(string label, string[] vals)
        {
            var clean = Clean(vals);
            if (clean.Count > 0) lines.Add($"{label}: {string.Join(", ", clean)}");
        }
        Add("Languages", s.Languages);
        Add("Frameworks", s.Frameworks);
        Add("Infrastructure", s.Infrastructure);
        Add("Databases", s.Databases);
        Add("Other", s.Other);
        return lines;
    }

    private static List<string> Clean(string[]? items) =>
        (items ?? [])
            .Where(i => !string.IsNullOrWhiteSpace(i))
            .Select(i => i.Trim())
            .ToList();

    private static string Escape(string s) => s.Replace("\"", "'");
}
