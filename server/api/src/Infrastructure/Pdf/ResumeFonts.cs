using QuestPDF.Drawing;

namespace ApplicationTracker.Infrastructure.Pdf;

// Source Sans 3 and Source Serif 4 (both SIL Open Font License 1.1 — see
// Pdf/Fonts/OFL-*.txt), embedded as resources so the résumé PDF renders
// identically everywhere. The renderer previously used Fonts.Arial, which isn't
// installed in the Linux Docker image; QuestPDF silently substituted whatever
// sans-serif the container had, so local (Windows) and deployed output didn't
// match. Call Register() once at startup, before any PDF is rendered.
public static class ResumeFonts
{
    // Sans carries the whole document. The serif is used for one thing only —
    // the candidate's name in the header — so it ships Regular/Bold and no
    // italics: nothing else is ever set in it.
    public const string SansFamilyName = "Source Sans 3";
    public const string SerifFamilyName = "Source Serif 4";

    // Family and style are read from each file's own name table, so all four
    // sans styles register under one family and .Bold()/.Italic() resolve to
    // the right file.
    private static readonly string[] FontFileNames =
    [
        "SourceSans3-Regular.ttf",
        "SourceSans3-Bold.ttf",
        "SourceSans3-It.ttf",
        "SourceSans3-BoldIt.ttf",
        "SourceSerif4-Regular.ttf",
        "SourceSerif4-Bold.ttf",
    ];

    private static bool _registered;

    public static void Register()
    {
        if (_registered) return;

        var assemblyName = typeof(ResumeFonts).Assembly.GetName().Name;
        foreach (var fileName in FontFileNames)
            FontManager.RegisterFontFromEmbeddedResource($"{assemblyName}.Pdf.Fonts.{fileName}");

        _registered = true;
    }
}
