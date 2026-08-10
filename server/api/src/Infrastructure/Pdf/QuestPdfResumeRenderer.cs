using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace ApplicationTracker.Infrastructure.Pdf;

public sealed class QuestPdfResumeRenderer : IResumePdfRenderer
{
    // Deeper, more muted navy than QuestPDF's Colors.Blue.Darken4 (#0D47A1) — matched
    // from the reference template's section headers.
    private static readonly Color HeaderColor = Color.FromHex("#1F3D7A");

    public byte[] Render(ResumePack pack, StructuredProfile profile)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(2, Unit.Centimetre);
                page.DefaultTextStyle(x => x.FontSize(10).FontFamily(Fonts.Arial));

                page.Content().Column(column =>
                {
                    column.Spacing(10);

                    column.Item().Column(header =>
                    {
                        var name = string.IsNullOrWhiteSpace(profile.FullName) ? "Candidate" : profile.FullName.ToUpperInvariant();
                        header.Item().AlignCenter().Text(name).FontSize(20).Bold();

                        var contactParts = new[] { profile.Location, profile.Email, profile.Phone }
                            .Where(p => !string.IsNullOrWhiteSpace(p))
                            .ToList();
                        var hasLinkedIn = !string.IsNullOrWhiteSpace(profile.LinkedIn);
                        if (contactParts.Count > 0 || hasLinkedIn)
                        {
                            header.Item().AlignCenter().Text(text =>
                            {
                                var isFirst = true;
                                foreach (var part in contactParts)
                                {
                                    if (!isFirst)
                                        text.Span(" | ").FontSize(9).FontColor(Colors.Grey.Darken1);
                                    text.Span(part!).FontSize(9).FontColor(Colors.Grey.Darken1);
                                    isFirst = false;
                                }
                                if (hasLinkedIn)
                                {
                                    if (!isFirst)
                                        text.Span(" | ").FontSize(9).FontColor(Colors.Grey.Darken1);
                                    text.Hyperlink("LinkedIn", profile.LinkedIn!).FontSize(9).FontColor(HeaderColor).Underline();
                                }
                            });
                        }
                    });

                    if (!string.IsNullOrWhiteSpace(pack.TailoredSummary))
                    {
                        column.Item().Column(section =>
                        {
                            section.Item().Text("SUMMARY").FontSize(11).Bold().FontColor(HeaderColor);
                            section.Item().PaddingBottom(2).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                            section.Item().Text(pack.TailoredSummary);
                        });
                    }

                    if (pack.Experience.Count > 0)
                    {
                        column.Item().Column(section =>
                        {
                            section.Item().Text("EXPERIENCE").FontSize(11).Bold().FontColor(HeaderColor);
                            section.Item().PaddingBottom(2).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);

                            foreach (var role in pack.Experience)
                            {
                                // PreventPageBreak: an entry split across a page boundary (company/dates
                                // on one page, its highlights orphaned onto the next) reads as broken —
                                // keep each entry atomic even at the cost of an earlier page break.
                                section.Item().PaddingTop(6).PreventPageBreak().Column(entry =>
                                {
                                    entry.Item().Row(row =>
                                    {
                                        row.RelativeItem().Text(role.Company).Bold();
                                        if (!string.IsNullOrWhiteSpace(role.Dates))
                                            row.ConstantItem(100).AlignRight().Text(role.Dates).FontColor(Colors.Grey.Darken1);
                                    });
                                    if (!string.IsNullOrWhiteSpace(role.Title))
                                        entry.Item().Text(role.Title).Italic();

                                    foreach (var highlight in role.Highlights)
                                    {
                                        entry.Item().PaddingLeft(10).Row(row =>
                                        {
                                            row.ConstantItem(10).Text("•");
                                            row.RelativeItem().Text(highlight);
                                        });
                                    }
                                });
                            }
                        });
                    }

                    var skillGroups = CleanSkillGroups(pack.HighlightedSkills);
                    if (skillGroups.Count > 0)
                    {
                        column.Item().Column(section =>
                        {
                            section.Item().Text("SKILLS").FontSize(11).Bold().FontColor(HeaderColor);
                            section.Item().PaddingBottom(2).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                            foreach (var group in skillGroups)
                            {
                                // One line per category ("Category: item, item, item") — the 2-line
                                // stacked layout (label above, items below) was still twice as tall as
                                // it needed to be, and with 5-6 categories that's enough extra height to
                                // push a bottom-of-page split mid-section, reading as a big blank gap in
                                // a continuous-scroll PDF viewer. A single line per category is both
                                // more compact and matches the density of the candidate's own résumé.
                                // PreventPageBreak: keeps a wrapped category's continuation line with it.
                                section.Item().PaddingTop(2).PreventPageBreak().Text(text =>
                                {
                                    text.Span($"{group.Category}: ").Bold().FontColor(Colors.Grey.Darken2);
                                    text.Span(string.Join(", ", group.Items));
                                });
                            }
                        });
                    }

                    var education = Clean(profile.Education);
                    if (education.Count > 0)
                        RenderBulletSection(column, "EDUCATION", education);

                    var militaryService = Clean(profile.MilitaryService);
                    if (militaryService.Count > 0)
                        RenderBulletSection(column, "MILITARY SERVICE", militaryService);

                    var sideProjects = CleanProjects(pack.SideProjects);
                    if (sideProjects.Count > 0)
                    {
                        column.Item().Column(section =>
                        {
                            section.Item().Text("SIDE PROJECTS").FontSize(11).Bold().FontColor(HeaderColor);
                            section.Item().PaddingBottom(2).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                            foreach (var project in sideProjects)
                            {
                                section.Item().PaddingTop(4).Row(row =>
                                {
                                    row.ConstantItem(10).Text("•");
                                    row.RelativeItem().Column(col =>
                                    {
                                        var line = string.IsNullOrWhiteSpace(project.Description)
                                            ? project.Name
                                            : $"{project.Name} — {project.Description}";
                                        col.Item().Text(line);
                                        if (project.Links.Count > 0)
                                        {
                                            col.Item().Text(text =>
                                            {
                                                var usedDemoLabel = false;
                                                for (var i = 0; i < project.Links.Count; i++)
                                                {
                                                    if (i > 0)
                                                        text.Span("  ·  ").FontSize(8.5f).FontColor(Colors.Grey.Darken1);
                                                    text.Hyperlink(LinkLabel(project.Links[i], ref usedDemoLabel), project.Links[i])
                                                        .FontSize(8.5f).FontColor(HeaderColor).Underline();
                                                }
                                            });
                                        }
                                    });
                                });
                            }
                        });
                    }

                    var spokenLanguages = Clean(profile.SpokenLanguages);
                    if (spokenLanguages.Count > 0)
                    {
                        column.Item().Column(section =>
                        {
                            section.Item().Text("LANGUAGES").FontSize(11).Bold().FontColor(HeaderColor);
                            section.Item().PaddingBottom(2).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                            section.Item().Text(string.Join("  ·  ", spokenLanguages));
                        });
                    }
                });

                page.Footer().AlignCenter().Text(text =>
                {
                    text.CurrentPageNumber();
                    text.Span(" / ");
                    text.TotalPages();
                });
            });
        });

        return document.GeneratePdf();
    }

    private static void RenderBulletSection(ColumnDescriptor column, string title, List<string> items)
    {
        column.Item().Column(section =>
        {
            section.Item().Text(title).FontSize(11).Bold().FontColor(HeaderColor);
            section.Item().PaddingBottom(2).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
            foreach (var item in items)
            {
                section.Item().Row(row =>
                {
                    row.ConstantItem(10).Text("•");
                    row.RelativeItem().Text(item);
                });
            }
        });
    }

    // Short readable link text instead of the raw URL — mirrors the "Live demo · Code"
    // convention already used on the candidate's own uploaded résumé. Code-hosting
    // domains always read "Code"; the first non-code link reads "Live demo"; anything
    // beyond that falls back to a generic "Link" rather than guessing further.
    private static string LinkLabel(string url, ref bool usedDemoLabel)
    {
        var lower = url.ToLowerInvariant();
        if (lower.Contains("github.com") || lower.Contains("gitlab.com") || lower.Contains("bitbucket.org"))
            return "Code";
        if (!usedDemoLabel)
        {
            usedDemoLabel = true;
            return "Live demo";
        }
        return "Link";
    }

    private static List<string> Clean(string[]? items) =>
        (items ?? [])
            .Where(i => !string.IsNullOrWhiteSpace(i))
            .Select(i => i.Trim())
            .ToList();

    private static List<string> Clean(List<string>? items) =>
        (items ?? [])
            .Where(i => !string.IsNullOrWhiteSpace(i))
            .Select(i => i.Trim())
            .ToList();

    private static List<SkillCategory> CleanSkillGroups(List<SkillCategory>? groups) =>
        (groups ?? [])
            .Select(g => g with { Items = Clean(g.Items) })
            .Where(g => g.Items.Count > 0)
            .ToList();

    private static List<SideProjectItem> CleanProjects(List<SideProjectItem>? projects) =>
        (projects ?? [])
            .Select(p => p with
            {
                Name = p.Name?.Trim() ?? "",
                Description = p.Description?.Trim() ?? "",
                Links = Clean(p.Links),
            })
            .Where(p => p.Name.Length > 0 || p.Description.Length > 0)
            .ToList();
}
