using ApplicationTracker.EvalHarness;
using Microsoft.Extensions.Configuration;

// Golden-set matching-quality harnesses. Ported from the scraper's
// `app/cli.py eval-verdict|eval-subscore` in Phase 3c of
// docs/scraper-slimming.md -- they were the last thing keeping that service's
// CLI alive, and they never belonged to a scraper in the first place.
//
// Both measure the API over HTTP, deliberately. This project has no reference
// to Core: calling the scoring service in-process would skip the endpoint, its
// validation and its serialisation, and AGENTS.md's rule is that an eval must
// drive the path the change lives on -- a clean result from an instrument that
// cannot see the change is worse than no result, because it licenses the change.
//
//   dotnet run --project server/api/src/EvalHarness -- verdict [--runs N]
//   dotnet run --project server/api/src/EvalHarness -- subscore
//
// Against a LOCAL API started with Identity__Mode=Fixed. The harness refuses
// anything else -- see MatchClient.EnsureFixedModeAsync.

var configuration = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json", optional: true)
    .AddEnvironmentVariables()
    .AddCommandLine(args)
    .Build();

var command = args.FirstOrDefault();
if (command is not ("verdict" or "subscore"))
{
    Console.Error.WriteLine("usage: eval-harness <verdict|subscore> [--runs N]");
    Console.Error.WriteLine();
    Console.Error.WriteLine("  verdict   does /api/match band 11 hand-labelled postings correctly?");
    Console.Error.WriteLine("  subscore  are the per-dimension sub-scores right, against a frozen profile?");
    return 2;
}

var baseUrl = configuration["Api:BaseUrl"] ?? "http://localhost:5002";
var runs = int.TryParse(configuration["runs"], out var n) ? Math.Max(1, n) : 1;

var fixtures = Path.Combine(AppContext.BaseDirectory, "fixtures");
var goldenSet = Path.Combine(fixtures, "golden-set.json");
var goldenProfile = Path.Combine(fixtures, "golden-profile.json");

using var http = new HttpClient
{
    BaseAddress = new Uri(baseUrl),
    // One Analyst call plus one Evaluator call per case, and the models are
    // slow. The default 100s would time out mid-run and report a partial
    // result as a failure of the thing being measured.
    Timeout = TimeSpan.FromMinutes(5),
};

var client = new MatchClient(http);

try
{
    await client.EnsureFixedModeAsync();

    var cases = VerdictEval.Load(goldenSet);
    Console.Error.WriteLine($"{cases.Count} case(s) against {baseUrl}");

    if (command == "verdict")
    {
        if (runs == 1)
        {
            Console.Write(VerdictEval.Report(await VerdictEval.RunAsync(client, cases)));
        }
        else
        {
            var all = new List<List<VerdictResult>>();
            for (var i = 0; i < runs; i++)
            {
                Console.Error.WriteLine($"run {i + 1}/{runs}");
                all.Add(await VerdictEval.RunAsync(client, cases));
            }
            Console.Write(VerdictEval.MultiRunReport(all));
        }
    }
    else
    {
        Console.Write(SubscoreEval.Report(await SubscoreEval.RunAsync(http, cases, goldenProfile)));
    }

    return 0;
}
catch (Exception e)
{
    // Non-zero, and no report. A run that could not complete every case is not
    // a smaller version of the same measurement -- printing what it managed
    // would invite comparing it against a full baseline.
    Console.Error.WriteLine();
    Console.Error.WriteLine($"ABORTED: {e.Message}");
    return 1;
}
