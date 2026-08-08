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
                            .Where(p => !string.IsNullOrWhiteSpace(p));
                        var contactLine = string.Join(" | ", contactParts);
                        if (!string.IsNullOrWhiteSpace(contactLine))
                            header.Item().AlignCenter().Text(contactLine).FontSize(9).FontColor(Colors.Grey.Darken1);
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
                                section.Item().PaddingTop(6).Row(row =>
                                {
                                    row.RelativeItem().Text(role.Company).Bold();
                                    if (!string.IsNullOrWhiteSpace(role.Dates))
                                        row.ConstantItem(100).AlignRight().Text(role.Dates).FontColor(Colors.Grey.Darken1);
                                });
                                if (!string.IsNullOrWhiteSpace(role.Title))
                                    section.Item().Text(role.Title).Italic();

                                foreach (var highlight in role.Highlights)
                                {
                                    section.Item().PaddingLeft(10).Row(row =>
                                    {
                                        row.ConstantItem(10).Text("•");
                                        row.RelativeItem().Text(highlight);
                                    });
                                }
                            }
                        });
                    }

                    if (pack.HighlightedSkills.Count > 0)
                    {
                        column.Item().Column(section =>
                        {
                            section.Item().Text("SKILLS").FontSize(11).Bold().FontColor(HeaderColor);
                            section.Item().PaddingBottom(2).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                            section.Item().Text(string.Join("  ·  ", pack.HighlightedSkills));
                        });
                    }

                    var education = Clean(profile.Education);
                    if (education.Count > 0)
                        RenderBulletSection(column, "EDUCATION", education);

                    var militaryService = Clean(profile.MilitaryService);
                    if (militaryService.Count > 0)
                        RenderBulletSection(column, "MILITARY SERVICE", militaryService);

                    var sideProjects = Clean(pack.SideProjects);
                    if (sideProjects.Count > 0)
                        RenderBulletSection(column, "SIDE PROJECTS", sideProjects);

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
}
