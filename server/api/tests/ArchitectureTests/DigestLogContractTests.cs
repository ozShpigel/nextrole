using System.Reflection;
using System.Text.RegularExpressions;

namespace ArchitectureTests;

/// <summary>
/// The Telegram digest greps a log line. Nothing else connects them.
/// </summary>
/// <remarks>
/// `deploy/monitoring/daily-digest.sh` filters Loki for a literal substring and
/// then pulls `score=`, `company=`, `title=` and `jobId=` out with sed. The
/// producer is one `_logger.LogInformation` in JobMatchService. A compiler sees
/// no relationship between them, so renaming a field in the log template
/// silently empties the digest — and a digest reporting nothing looks exactly
/// like a quiet day.
///
/// That is not hypothetical: the digest filtered `source=ingest` for months
/// after ingest stopped scoring, and reported "no ingest run detected" nightly
/// while the per-user scan was scoring hundreds of jobs under `source=(null)`.
///
/// These read both files and assert they still agree. Cheap, and it fails on the
/// edit rather than in three weeks of silence.
/// </remarks>
public class DigestLogContractTests
{
    private static string RepoFile(string relative)
    {
        var dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!;
        while (!Directory.Exists(Path.Combine(dir, ".git")))
        {
            var parent = Directory.GetParent(dir)?.FullName
                ?? throw new InvalidOperationException("repo root not found from " + dir);
            dir = parent;
        }
        return File.ReadAllText(Path.Combine(dir, relative));
    }

    private static string Digest => RepoFile("deploy/monitoring/daily-digest.sh");
    private static string MatchService => RepoFile("server/api/src/Core/Matching/JobMatchService.cs");
    private static string PoolScan => RepoFile("server/api/src/Core/Matching/PoolScanService.cs");

    [Fact]
    public void LogTemplate_CarriesEveryFieldTheDigestParses()
    {
        var template = Regex.Match(MatchService, @"""Job scored: [^""]*""").Value;
        Assert.False(string.IsNullOrEmpty(template), "the 'Job scored' log template moved or was renamed");

        foreach (var field in new[] { "source=", "score=", "company=", "title=", "jobId=" })
            Assert.True(template.Contains(field, StringComparison.Ordinal),
                $"daily-digest.sh parses '{field}' out of this line, and the template no longer emits it: {template}");
    }

    [Fact]
    public void Digest_FiltersOnASourceTheCodeActuallyEmits()
    {
        var filter = Regex.Match(Digest, @"source=(?<v>[a-z]+)").Groups["v"].Value;
        Assert.False(string.IsNullOrEmpty(filter), "daily-digest.sh no longer filters on a source= value");

        // "pool" is stamped server-side by PoolScanService; "ingest" arrives as
        // an X-Source header from the scraper. Either is a real value — a typo
        // or a retired one is what this catches.
        var emitted = filter == "ingest"
            || PoolScan.Contains($"Source = \"{filter}\"", StringComparison.Ordinal);
        Assert.True(emitted,
            $"daily-digest.sh filters source={filter}, which nothing sets. The per-user scan stamps "
            + "Source in PoolScanService; the scraper sends X-Source: ingest.");
    }

    [Fact]
    public void Digest_DoesNotFilterOnTheRetiredIngestSource()
    {
        // ingest stopped scoring when scoring moved to the per-user scan
        // (orchestrator.py: "Ingest does NOT score"), so a digest filtered on
        // source=ingest matches nothing, forever, quietly.
        Assert.DoesNotContain("source=ingest\"", Digest, StringComparison.Ordinal);
    }
}
