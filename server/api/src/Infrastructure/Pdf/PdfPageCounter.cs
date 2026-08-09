namespace ApplicationTracker.Infrastructure.Pdf;

// Cheap page count for PDF pagers — no PDF library dependency for what's a
// cosmetic count. Reads the raw object structure directly: Latin1 is a
// byte-for-byte-safe decode for PDF syntax (ASCII operators interleaved with
// binary streams), then looks for the page-tree root's /Count entry. Falls
// back to counting individual /Type /Page objects if no /Pages node with a
// /Count is found. Null (never fails the caller) if neither pattern matches.
// Works equally on arbitrary uploaded PDFs and QuestPDF-generated ones.
public static class PdfPageCounter
{
    private static readonly System.Text.RegularExpressions.Regex PagesNodeRegex =
        new(@"/Type\s*/Pages\b", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex CountRegex =
        new(@"/Count\s+(\d+)", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex PageObjectRegex =
        new(@"/Type\s*/Page(?!s)\b", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex MediaBoxRegex =
        new(@"/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]",
            System.Text.RegularExpressions.RegexOptions.Compiled);

    // First page's /MediaBox (in PDF points) — lets the client size a preview
    // container to the document's real aspect ratio instead of guessing, so
    // "fit to width" leaves no leftover space for the next page to peek
    // through underneath. Null (never fails the caller) if not found.
    public static (double Width, double Height)? GetFirstPageSize(byte[] bytes)
    {
        try
        {
            var text = System.Text.Encoding.Latin1.GetString(bytes);
            var match = MediaBoxRegex.Match(text);
            if (!match.Success) return null;
            var x0 = double.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
            var y0 = double.Parse(match.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture);
            var x1 = double.Parse(match.Groups[3].Value, System.Globalization.CultureInfo.InvariantCulture);
            var y1 = double.Parse(match.Groups[4].Value, System.Globalization.CultureInfo.InvariantCulture);
            var width = Math.Abs(x1 - x0);
            var height = Math.Abs(y1 - y0);
            return width > 0 && height > 0 ? (width, height) : null;
        }
        catch
        {
            return null;
        }
    }

    public static int? CountPages(byte[] bytes)
    {
        try
        {
            var text = System.Text.Encoding.Latin1.GetString(bytes);
            var max = 0;
            foreach (System.Text.RegularExpressions.Match node in PagesNodeRegex.Matches(text))
            {
                var start = Math.Max(0, node.Index - 300);
                var window = text.Substring(start, Math.Min(600, text.Length - start));
                var countMatch = CountRegex.Match(window);
                if (countMatch.Success && int.TryParse(countMatch.Groups[1].Value, out var n) && n > max)
                    max = n;
            }
            if (max > 0) return max;

            var pageCount = PageObjectRegex.Matches(text).Count;
            return pageCount > 0 ? pageCount : null;
        }
        catch
        {
            return null;
        }
    }
}
