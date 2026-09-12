using System.Text.RegularExpressions;

namespace ArchitectureTests;

// Locates the repository's C# sources so the scanning tests below read the real
// tree rather than a copy in the test output. Failing loudly when the root
// cannot be found matters: a check that silently finds zero files to scan is a
// check that passes forever while verifying nothing.
internal static class RepoSources
{
    internal static string Root { get; } = FindRoot();

    private static string FindRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "AGENTS.md"))) return dir.FullName;
            dir = dir.Parent;
        }
        throw new InvalidOperationException(
            $"Could not find the repository root (no AGENTS.md above {AppContext.BaseDirectory}).");
    }

    // Every hand-written .cs file in the API solution: build output and
    // generated obj/ sources are excluded so the scans only see real source.
    internal static IReadOnlyList<string> ApiSourceFiles { get; } =
        Directory.EnumerateFiles(Path.Combine(Root, "server", "api", "src"), "*.cs", SearchOption.AllDirectories)
            .Where(p => !p.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                     && !p.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToList();

    internal static string RelativePath(string absolute) =>
        Path.GetRelativePath(Root, absolute).Replace(Path.DirectorySeparatorChar, '/');

    // Line numbers make a failure actionable instead of just "somewhere in this file".
    internal static IEnumerable<(string File, int Line, string Text)> Matches(Regex pattern)
    {
        foreach (var path in ApiSourceFiles)
        {
            var lines = File.ReadAllLines(path);
            for (var i = 0; i < lines.Length; i++)
                if (pattern.IsMatch(lines[i]))
                    yield return (RelativePath(path), i + 1, lines[i].Trim());
        }
    }
}
