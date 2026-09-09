using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace ApplicationTracker.Infrastructure.Pdf;

public sealed class QuestPdfResumeRenderer : IResumePdfRenderer
{
    // Near-black rather than #000: pure black on white is what made the page read
    // heavy. Everything that isn't a muted grey, a date, or the name inherits this
    // — including the bold company names, role titles, and category labels, which
    // carry their emphasis through weight rather than through extra darkness.
    private static readonly Color BodyColor = Color.FromHex("#2A2A2A");

    // The name is the one element allowed to sit darker than body text.
    private static readonly Color NameColor = Color.FromHex("#000000");

    // Contact stack: a step darker than the mid grey it used to be, but still
    // short of body text so it stays secondary to the name beside it.
    private static readonly Color ContactColor = Color.FromHex("#4A4A4A");

    // Sign-off at the foot of the document: the lightest text on the page. It
    // repeats what the header already says, so it only needs to be findable.
    private static readonly Color SignOffColor = Color.FromHex("#8C8C8C");

    // Project links. Lighter than body text — the underline already marks them as
    // links, so they don't need weight as well.
    private static readonly Color LinkColor = Color.FromHex("#4A4A4A");

    // Section rules: mid-grey, and exactly one device pixel wide at 96dpi. Thinner
    // than 0.75pt the line falls under a pixel and viewers anti-alias it across two
    // pixel rows or one depending on where its y lands — so identical rules render
    // visibly different, some crisp and dark, some fat and washed out.
    private static readonly Color SectionRuleColor = Color.FromHex("#999999");
    private const float SectionRuleThickness = 0.45f;
    // Space between the header text and its rule.
    private const float SectionRuleOffset = 2.25f;

    // The title under the name sits between the two: darker than body text, a
    // shade off the name itself, so the pair reads as one unit without the
    // caption competing with the name above it.
    private static readonly Color TitleColor = Color.FromHex("#111111");

    // Fraction of font size (QuestPDF's LetterSpacing is a multiplier, not points).
    // Ceiling here is set by text extraction, not by taste: past roughly 0.08 in
    // Source Sans 3 the inter-glyph gap grows wider than the extractor's
    // space-insertion threshold and headers come out of the text layer as
    // "E D U C AT I O N" — which costs an ATS the very anchors it segments a
    // résumé by. Retuned from 0.12 when the family changed from Lato; a font with
    // different advance widths needs this re-checked against the extracted text.
    private const float HeaderLetterSpacing = 0.06f;

    // The title under the name is set smaller and tracked wider than a section
    // header — it reads as a caption to the name rather than as a heading. Same
    // extraction ceiling applies, so this value is tested against pdftotext too.
    private const float TitleFontSize = 9f;
    private const float TitleLetterSpacing = 0.18f;

    // Type scale. Body is the inherited default; everything that must not follow it
    // when it moves carries its size explicitly.
    private const float BodyFontSize = 10f;
    private const float NameFontSize = 28f;
    private const float SectionHeaderFontSize = 10.5f;
    // Company and entry dates — held a half point under body so an entry's
    // metadata sits below its prose.
    private const float EntryFontSize = 9.5f;
    // The role title is the line a reader scans an entry for, so it sits above body
    // size rather than below it — the only thing in an entry that does.
    private const float RoleTitleFontSize = 10.5f;
    private const float ContactFontSize = 9.5f;
    // Looser than body leading: four short right-aligned lines stacked tight read
    // as a block of noise, and the extra air is what makes them legible.
    private const float ContactLineHeight = 1.55f;
    private const float LinkFontSize = 8.75f;
    // Split from LinkFontSize: the sign-off is the quietest line on the page and
    // wants to shrink while project links want to grow.
    private const float SignOffFontSize = 8f;
    // Project names head their entry like a role title heads a job, but sit a
    // notch above it — a project is the only thing in its section.
    private const float ProjectNameFontSize = 11f;

    // Bullet column. Sized so the dot.s CENTRE sits 3.9mm from the start of the
    // text: the column edge to the text, less half the dot .s width.
    private const float BulletColumnWidth = 11.06f;

    // Bullet dot, drawn rather than typed. As a "•" glyph it landed in the text
    // layer and every extracted highlight began with a stray bullet character.
    private const float BulletDiameter = 3.75f;

    // Left column of the skills grid. Narrow enough that a long category wraps
    // onto a second line rather than squeezing the values into a thin strip.
    private const float SkillLabelColumnWidth = 125f;

    // Air above and below every two-column grid row (skills, education, military
    // service, languages). Kept tight: these are one-line reference rows, and space
    // between them just pushes the sections apart without making them clearer.
    private const float GridRowPaddingTop = 2f;
    private const float GridRowPaddingBottom = 0f;

    // Left gutter holding each experience entry's dates, start year over end year,
    // so every entry's dates land on one vertical scan line.
    private const float DateColumnWidth = 52f;

    // Right column of the header band. Fits the longest contact line (an email)
    // at ContactFontSize without wrapping; the name column takes whatever is left.
    private const float ContactColumnWidth = 170f;

    public byte[] Render(ResumePack pack, StructuredProfile profile)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.MarginLeft(19, Unit.Millimetre);
                // 1mm tighter than the left, deliberately. The body is ragged-right, so
                // its lines stop short of the margin and the right reads wider than it
                // measures; this trims the optical difference. The rule and the
                // right-aligned contact block do sit 1mm closer to the edge as a result.
                page.MarginRight(18, Unit.Millimetre);
                page.MarginBottom(19, Unit.Millimetre);
                // Trimmed by the contact block's line leading (1.6mm at its size and
                // line height) so the first line of ink lands at 17mm from the page
                // edge, not the text box. Re-derive if the contact type changes.
                page.MarginTop(15.38f, Unit.Millimetre);
                page.DefaultTextStyle(x => x.FontSize(BodyFontSize).FontFamily(ResumeFonts.SansFamilyName).LineHeight(1.4f).FontColor(BodyColor));

                page.Content().Column(column =>
                {
                    column.Spacing(7);

                    column.Item().Column(header =>
                    {
                        // Two-column band: identity on the left, contact stack on the
                        // right, rule underneath. Left column is Relative so a long name
                        // takes the slack rather than colliding with the contact block.
                        header.Item().Row(band =>
                        {
                            band.RelativeItem().Column(identity =>
                            {
                                // Set in the serif at its natural case and regular weight — the
                                // display face carries the name on its own; uppercasing and
                                // bolding it on top made the header the heaviest thing on the
                                // page. Size compensates for the smaller apparent scale of
                                // mixed case against the letterspaced title beneath it.
                                var name = string.IsNullOrWhiteSpace(profile.FullName) ? "Candidate" : profile.FullName.Trim();
                                identity.Item().Text(name)
                                    .FontFamily(ResumeFonts.SerifFamilyName).FontSize(NameFontSize).FontColor(NameColor);

                                // Professional title: the role this pack was tailored toward, so
                                // the header agrees with the summary's opening title. Packs stored
                                // before TargetTitle existed fall back to the most recent employer
                                // title (Experience is reverse-chronological, so index 0 is most
                                // recent). Small caps, letterspaced, lighter weight than the name.
                                var titleLine = string.IsNullOrWhiteSpace(pack.TargetTitle)
                                    ? pack.Experience.FirstOrDefault()?.Title
                                    : pack.TargetTitle;
                                if (!string.IsNullOrWhiteSpace(titleLine))
                                {
                                    identity.Item().PaddingTop(3.58f).Text(titleLine.Trim().ToUpperInvariant())
                                        .FontSize(TitleFontSize).LetterSpacing(TitleLetterSpacing).FontColor(TitleColor);
                                }
                            });

                            band.ConstantItem(ContactColumnWidth).Column(contact =>
                            {
                                foreach (var part in new[] { profile.Location, profile.Phone, profile.Email }
                                             .Where(p => !string.IsNullOrWhiteSpace(p)))
                                {
                                    contact.Item().AlignRight().Text(part!).FontSize(ContactFontSize).LineHeight(ContactLineHeight).FontColor(ContactColor);
                                }

                                if (!string.IsNullOrWhiteSpace(profile.LinkedIn))
                                {
                                    contact.Item().AlignRight().Text(text =>
                                        text.Hyperlink(DisplayUrl(profile.LinkedIn!), NormalizeUrl(profile.LinkedIn!))
                                            .FontSize(ContactFontSize).LineHeight(ContactLineHeight).FontColor(ContactColor));
                                }
                            });
                        });

                        // Weighted to close the band: already pure black, so weight is the
                        // only lever left — thick enough to read as the edge of the masthead
                        // rather than as one more divider like the section rules below it.
                        header.Item().PaddingTop(5).LineHorizontal(1f).LineColor(NameColor);
                    });

                    // No "SUMMARY" heading: the opening paragraph sits immediately under
                    // the header band, where it reads as the summary without being
                    // labelled one.
                    if (!string.IsNullOrWhiteSpace(pack.TailoredSummary))
                        column.Item().Text(pack.TailoredSummary);

                    if (pack.Experience.Count > 0)
                    {
                        column.Item().Column(section =>
                        {
                            SectionHeader(section, "EXPERIENCE", ruleGap: 0.06f);

                            foreach (var role in pack.Experience)
                            {
                                // PreventPageBreak: an entry split across a page boundary (company/dates
                                // on one page, its highlights orphaned onto the next) reads as broken —
                                // keep each entry atomic even at the cost of an earlier page break.
                                //
                                // Dates sit in a left gutter, start year over end year. Known
                                // cost, accepted deliberately: pdftotext's reading-order mode
                                // walks the two columns separately, so a raw extract reads
                                // "2023 / Payoneer / 2026 / Platform Developer" — the end year
                                // lands between the company and the title. QuestPDF writes no
                                // tagged reading order, so an extractor has only glyph
                                // positions, and a 2-line gutter beside a taller block shares
                                // no line positions with it. Layout-aware extraction is fine.
                                section.Item().PaddingTop(6).PreventPageBreak().Row(entry =>
                                {
                                    entry.ConstantItem(DateColumnWidth).Column(dates =>
                                    {
                                        var (start, end) = SplitDateRange(role.Dates);
                                        if (!string.IsNullOrWhiteSpace(start))
                                            dates.Item().Text(start).FontSize(EntryFontSize).FontColor(Colors.Grey.Darken1);
                                        if (!string.IsNullOrWhiteSpace(end))
                                            dates.Item().Text(end).FontSize(EntryFontSize).FontColor(Colors.Grey.Darken1);
                                    });

                                    entry.RelativeItem().Column(content =>
                                    {
                                        // Role first, company beneath it: the title is what a
                                        // reader scans for, so it takes the bold line and the
                                        // employer sits under it in muted grey. Emphasis follows
                                        // the position, not the field.
                                        if (!string.IsNullOrWhiteSpace(role.Title))
                                            content.Item().Text(role.Title).FontSize(RoleTitleFontSize).Bold();
                                        content.Item().Text(role.Company).FontSize(EntryFontSize).FontColor(Colors.Grey.Darken1);

                                        // Bullet glyph, not bare indentation: without a marker the
                                        // highlights read as flush paragraphs hanging off the company
                                        // line and the entry loses its hierarchy.
                                        // No left inset: the dot starts at the content column's
                                        // edge, so it lines up with the first letter of the role
                                        // title and company above it.
                                        foreach (var highlight in role.Highlights)
                                        {
                                            content.Item().Row(row =>
                                            {
                                                Dot(row.ConstantItem(BulletColumnWidth));
                                                row.RelativeItem().Text(highlight);
                                            });
                                        }
                                    });
                                });
                            }
                        });
                    }

                    var skillGroups = CleanSkillGroups(pack.HighlightedSkills);
                    if (skillGroups.Count > 0)
                    {
                        // PreventPageBreak on the whole section: the categories are a
                        // single short list, and splitting it left the header plus two
                        // categories stranded at the foot of one page.
                        column.Item().PreventPageBreak().Column(section =>
                        {
                            SectionHeader(section, "SKILLS");
                            // Two-column grid: bold category on the left, values wrapping in
                            // the rest of the line, no colon. Known extraction cost, chosen
                            // deliberately — pdftotext's reading-order mode walks each column
                            // as its own run, so a raw extract emits all six category names
                            // together and then all six value lists, losing which skills sit
                            // under which category. Layout-aware extraction reads it correctly.
                            foreach (var group in skillGroups)
                            {
                                section.Item().PaddingTop(GridRowPaddingTop).PaddingBottom(GridRowPaddingBottom).Row(row =>
                                {
                                    row.ConstantItem(SkillLabelColumnWidth).PaddingRight(10)
                                        .Text(group.Category).Bold();
                                    row.RelativeItem().Text(string.Join(", ", group.Items));
                                });
                            }
                        });
                    }

                    var sideProjects = CleanProjects(pack.SideProjects);
                    if (sideProjects.Count > 0)
                    {
                        column.Item().Column(section =>
                        {
                            SectionHeader(section, "PROJECTS", ruleGap: 3.64f);
                            foreach (var project in sideProjects)
                            {
                                // Name on its own line, links directly beneath it, then the
                                // description as a bullet — the same shape as an experience
                                // entry, so a project reads as a thing with a title rather
                                // than as one long bulleted sentence.
                                section.Item().PaddingTop(4).PreventPageBreak().Column(entry =>
                                {
                                    // Same size as an experience role title: a project name heads
                                    // its entry the way a role title heads a job, so the two read
                                    // at the same level.
                                    if (!string.IsNullOrWhiteSpace(project.Name))
                                        entry.Item().Text(project.Name).FontSize(ProjectNameFontSize).Bold();

                                    if (project.Links.Count > 0)
                                    {
                                        entry.Item().PaddingBottom(8.48f).Text(text =>
                                        {
                                            var usedDemoLabel = false;
                                            for (var i = 0; i < project.Links.Count; i++)
                                            {
                                                if (i > 0)
                                                    text.Span("  ·  ").FontSize(LinkFontSize).FontColor(Colors.Grey.Darken1);
                                                text.Hyperlink(LinkLabel(project.Links[i], ref usedDemoLabel), NormalizeUrl(project.Links[i]))
                                                    .FontSize(LinkFontSize).FontColor(LinkColor).Underline();
                                            }
                                        });
                                    }

                                    // Highlights render one bullet each. Packs stored before
                                    // the field existed carry a single Description string
                                    // instead — shown as one bullet so they still render.
                                    var points = project.Highlights.Count > 0
                                        ? project.Highlights
                                        : string.IsNullOrWhiteSpace(project.Description) ? [] : [project.Description];

                                    foreach (var point in points)
                                    {
                                        entry.Item().PaddingTop(2).PaddingLeft(14).Row(row =>
                                        {
                                            Dot(row.ConstantItem(BulletColumnWidth));
                                            row.RelativeItem().Text(point);
                                        });
                                    }
                                });
                            }
                        });
                    }

                    var education = CleanCredentials(profile.Education);
                    if (education.Count > 0)
                        RenderCredentialSection(column, "EDUCATION", education);

                    var militaryService = CleanCredentials(profile.MilitaryService);
                    if (militaryService.Count > 0)
                        RenderCredentialSection(column, "MILITARY SERVICE", militaryService);

                    var spokenLanguages = Clean(profile.SpokenLanguages);
                    if (spokenLanguages.Count > 0)
                    {
                        column.Item().Column(section =>
                        {
                            SectionHeader(section, "LANGUAGES");
                            // Same two-column row as education and military service, with
                            // the label column left empty — the languages line then starts
                            // on the detail column instead of at the margin, so the bottom
                            // of the page holds one alignment.
                            section.Item().PaddingTop(GridRowPaddingTop).PaddingBottom(GridRowPaddingBottom).Row(row =>
                            {
                                row.ConstantItem(SkillLabelColumnWidth).PaddingRight(10);
                                row.RelativeItem().Text(string.Join("  ·  ", spokenLanguages));
                            });
                        });
                    }

                    // Sign-off: part of the content flow, not page.Footer(). As a page
                    // footer it repeated on every page and sat pinned to the bottom
                    // margin; here it appears once, directly under the last line of the
                    // document, on whichever page that happens to be.
                    var signOff = new[]
                    {
                        string.IsNullOrWhiteSpace(profile.FullName) ? null : profile.FullName.Trim(),
                        string.IsNullOrWhiteSpace(pack.TargetTitle)
                            ? pack.Experience.FirstOrDefault()?.Title?.Trim()
                            : pack.TargetTitle.Trim(),
                        string.IsNullOrWhiteSpace(profile.Email) ? null : profile.Email.Trim(),
                    }.Where(p => !string.IsNullOrWhiteSpace(p)).ToList();

                    if (signOff.Count > 0)
                    {
                        column.Item().PreventPageBreak().Column(footer =>
                        {
                            footer.Item().PaddingBottom(5).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                            footer.Item().AlignCenter().Text(string.Join("  ·  ", signOff))
                                .FontSize(SignOffFontSize).FontColor(SignOffColor);
                        });
                    }
                });
            });
        });

        return document.GeneratePdf();
    }

    // Drawn as vector art rather than set as a "•" character, so the marker never
    // reaches the text layer — an extractor sees the highlight's own words and
    // nothing else. PaddingTop is measured, not guessed: it puts the dot's centre on
    // the centre of the first line.s capital letter (baseline minus half the cap
    // height). Highlights open with a capital, so centring on the x-height left the
    // dot sitting 0.87pt low against the letter beside it. Retune it against the real baseline if body
    // size or leading changes — the glyph bounding box is not the baseline.
    private static void Dot(IContainer container) => container
        .PaddingTop(4.83f).Width(BulletDiameter).Height(BulletDiameter)
        .Svg("<svg viewBox='0 0 4 4' xmlns='http://www.w3.org/2000/svg'>"
           + "<circle cx='2' cy='2' r='2' fill='#2A2A2A'/></svg>");

    // ruleGap is the space under the section rule. It defaults to 6, which is what
    // keeps a header off its first row in the text layer — below that pdftotext
    // starts merging the two onto one extracted line. PROJECTS overrides it because
    // its first row is a bold project name rather than a grid row, and that name
    // carries its own leading above the glyph.
    private static void SectionHeader(ColumnDescriptor section, string title, float ruleGap = 6f)
    {
        section.Item().Text(title).FontSize(SectionHeaderFontSize).Bold().LetterSpacing(HeaderLetterSpacing).FontColor(BodyColor);
        // PaddingBottom is load-bearing for extraction, not just for looks: at 2pt
        // the first row below sat close enough to the header that pdftotext merged
        // the two into one line ("EDUCATION B.Sc. Computer Science"), costing the
        // header its own line in the text layer.
        section.Item().PaddingTop(SectionRuleOffset).PaddingBottom(ruleGap)
            .LineHorizontal(SectionRuleThickness).LineColor(SectionRuleColor);
    }

    // Splits "2023–2026" into its two ends so the gutter can stack them. Only
    // splits on the range separator — the text either side is passed through as
    // written ("Present", "Jan 2019", a single undashed value), never reformatted.
    private static (string Start, string? End) SplitDateRange(string? dates)
    {
        var trimmed = (dates ?? "").Trim();
        var separator = trimmed.IndexOfAny(['–', '—', '-']);
        if (separator < 0) return (trimmed, null);

        var start = trimmed[..separator].Trim();
        var end = trimmed[(separator + 1)..].Trim();
        return start.Length == 0 ? (end, null) : (start, end.Length == 0 ? null : end);
    }

    // Institution on the left, what was earned there on the right — the same
    // two-column shape the skills grid uses, so the bottom of the page keeps one
    // alignment. Carries the same extraction cost as that grid: pdftotext's
    // reading-order mode walks each column as its own run.
    private static void RenderCredentialSection(ColumnDescriptor column, string title, List<CredentialItem> items)
    {
        column.Item().PreventPageBreak().Column(section =>
        {
            SectionHeader(section, title);
            foreach (var item in items)
            {
                section.Item().PaddingTop(GridRowPaddingTop).PaddingBottom(GridRowPaddingBottom).Row(row =>
                {
                    row.ConstantItem(SkillLabelColumnWidth).PaddingRight(10)
                        .Text(item.Institution).Bold();
                    row.RelativeItem().Text(item.Detail);
                });
            }
        });
    }

    private static List<CredentialItem> CleanCredentials(CredentialItem[]? items) =>
        (items ?? [])
            .Select(i => i with { Institution = i.Institution?.Trim() ?? "", Detail = i.Detail?.Trim() ?? "" })
            .Where(i => i.Institution.Length > 0 || i.Detail.Length > 0)
            .ToList();

    // Education and military service are stored as one free-text line per entry
    // ("B.Sc. Computer Science, HIT Holon, 2012"), with no structured split. The
    // entry renders as a single text flow with its opening segment bolded, so the
    // degree or role still carries emphasis while the line stays one unit to a
    // text extractor. Splitting these across two columns broke that: the labels
    // extracted as one run and the details as another. The string itself is
    // untouched — the bold simply stops at the first comma, which is kept.
    private static void RenderInlineSection(ColumnDescriptor column, string title, List<string> items)
    {
        column.Item().Column(section =>
        {
            SectionHeader(section, title);
            foreach (var item in items)
            {
                section.Item().PaddingTop(2).PreventPageBreak().Text(text =>
                {
                    var comma = item.IndexOf(',');
                    if (comma <= 0)
                    {
                        text.Span(item);
                        return;
                    }
                    text.Span(item[..comma]).Bold();
                    text.Span(item[comma..]);
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

    // The contact block shows the address itself rather than a "LinkedIn" label, so
    // it reads as one more line of the stack. Scheme and "www." are stripped for
    // display only — the href still gets the full URL from NormalizeUrl.
    private static string DisplayUrl(string url)
    {
        var text = url.Trim();
        foreach (var scheme in (string[])["https://", "http://"])
        {
            if (text.StartsWith(scheme, StringComparison.OrdinalIgnoreCase))
                text = text[scheme.Length..];
        }
        if (text.StartsWith("www.", StringComparison.OrdinalIgnoreCase))
            text = text[4..];
        return text.TrimEnd('/');
    }

    // Profile/project links are stored scheme-less (e.g. "linkedin.com/in/name") since
    // that's how the AI extractor and the Settings free-text field save them. QuestPDF
    // renders a schemeless href as-is, and a PDF viewer resolves that as a relative path
    // against the file's own folder rather than as an external URL — so it must gain a
    // scheme here, at render time, before reaching Hyperlink().
    private static string NormalizeUrl(string url)
    {
        var trimmed = url.Trim();
        return Uri.IsWellFormedUriString(trimmed, UriKind.Absolute) ? trimmed : $"https://{trimmed}";
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
                Highlights = Clean(p.Highlights),
                Description = p.Description?.Trim() ?? "",
                Links = Clean(p.Links),
            })
            .Where(p => p.Name.Length > 0 || p.Highlights.Count > 0 || p.Description.Length > 0)
            .ToList();
}
