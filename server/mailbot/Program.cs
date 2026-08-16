using Mailbot.Models;
using Mailbot.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

try
{
    // Set content root to the directory where the executable lives,
    // so appsettings.json and credentials.json are found regardless of cwd
    var exeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location)!;

    Console.WriteLine($"Mailbot starting. exeDir: {exeDir}");

    var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
    {
        Args = args,
        ContentRootPath = exeDir
    });

    // Local convenience: load a .env (KEY__SUB=value, mapped to KEY:SUB) from the
    // working dir or the exe dir if present. Not used in production — Render injects
    // real env vars. (`dotnet run --project server/mailbot` runs with cwd = the
    // project dir, so server/mailbot/.env is picked up.)
    foreach (var dir in new[] { Directory.GetCurrentDirectory(), exeDir })
    {
        var envPath = Path.Combine(dir, ".env");
        if (!File.Exists(envPath)) continue;
        var envVars = new Dictionary<string, string?>();
        foreach (var line in File.ReadAllLines(envPath))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;
            var sep = trimmed.IndexOf('=');
            if (sep <= 0) continue;
            envVars[trimmed[..sep].Trim().Replace("__", ":")] = trimmed[(sep + 1)..].Trim();
        }
        builder.Configuration.AddInMemoryCollection(envVars);
        Console.WriteLine($"Loaded .env from {envPath}");
        break;
    }

    // Logging
    builder.Logging.ClearProviders();
    builder.Logging.AddConsole();

    // Services
    builder.Services.AddSingleton<IGmailEmailService, GmailEmailService>();
    builder.Services.AddSingleton<MailbotOrchestrator>();

    var trackerUrl = builder.Configuration["Tracker:BaseUrl"] ?? "http://localhost:5002";
    // Shared secret for a privately *hosted* tracker (its ApiKey env var). Unset for
    // local/private-network instances that don't gate requests.
    var trackerApiKey = builder.Configuration["Tracker:ApiKey"];

    void ConfigureTrackerClient(HttpClient client)
    {
        client.BaseAddress = new Uri(trackerUrl);
        client.Timeout = TimeSpan.FromSeconds(120);
        if (!string.IsNullOrEmpty(trackerApiKey))
            client.DefaultRequestHeaders.Add("X-Api-Key", trackerApiKey);
        // Lets the API bill mailbot's Claude calls (email parsing) on their own
        // Anthropic API key, separate from ingest scoring — no-op on the CRUD
        // calls this client also makes.
        client.DefaultRequestHeaders.Add("X-Source", "mailbot");
    }

    builder.Services.AddHttpClient<IEmailParser, HttpEmailParser>(ConfigureTrackerClient);
    builder.Services.AddHttpClient<ITrackerApiClient, TrackerApiClient>(ConfigureTrackerClient);

    var host = builder.Build();

    var logger = host.Services.GetRequiredService<ILogger<Program>>();

    // Optional integration: with no Gmail credentials, skip cleanly instead of
    // crashing. Lets the platform run on just a Mongo connection string + AI key.
    if (!GmailEmailService.TryResolveCredentialsPath(builder.Configuration, exeDir, out _))
    {
        // Direct stdout (not ILogger): this one-shot exits immediately, before
        // the buffered console logger would flush.
        Console.WriteLine("Gmail not configured (no credentials file) — skipping email sync.");
        return 0;
    }

    var orchestrator = host.Services.GetRequiredService<MailbotOrchestrator>();

    logger.LogInformation("Mailbot service started");
    logger.LogInformation("Current time: {Time}", DateTime.Now);

    // Fail fast when pointed at a demo instance: demo mode rejects all tracker
    // writes (403), so syncing against it is always a misconfiguration. Exit
    // non-zero so a scheduled run fails visibly instead of "succeeding" against
    // fictional seeded data. Unreachable/unknown (null) falls through — the sync
    // itself will surface transport errors.
    var trackerApi = host.Services.GetRequiredService<ITrackerApiClient>();
    if (await trackerApi.GetDemoModeAsync() == true)
    {
        // Direct stderr as well as ILogger: this one-shot exits immediately, and
        // the buffered console logger may not flush in time.
        logger.LogError("Tracker at {Url} is a DEMO instance — aborting", trackerUrl);
        Console.Error.WriteLine(
            $"Tracker at {trackerUrl} reports demoMode=true — its tracker is read-only, " +
            "so this sync could never write anything. Point Tracker__BaseUrl at the " +
            "private instance. Aborting.");
        return 1;
    }

    // Modes (re-sync reconciles from full email history; default is the recent-window sync):
    //   default                                  → daily sync: recent mail (Gmail:LookbackDays,
    //                                              default 3d) searched by tracked-company names
    //   env  Mailbot__Resync=true                → re-sync (set Mailbot__ResyncCompany to scope,
    //        [+ Mailbot__ResyncCompany / ...Title]  else all applications). Flip false to resume.
    //   cli  resync --company "X" [--title "Y"]  → same, for local use
    var resyncByEnv = bool.TryParse(builder.Configuration["Mailbot:Resync"], out var re) && re;
    var resyncByCli = args.Length > 0 && args[0].Equals("resync", StringComparison.OrdinalIgnoreCase);
    var company = GetArg(args, "--company") ?? builder.Configuration["Mailbot:ResyncCompany"];
    var title = GetArg(args, "--title") ?? builder.Configuration["Mailbot:ResyncTitle"];

    SyncResult result;
    if (resyncByEnv || resyncByCli)
    {
        result = string.IsNullOrWhiteSpace(company)
            ? await orchestrator.RunResyncAllAsync()
            : await orchestrator.RunResyncAsync(company, title);
    }
    else
    {
        result = await orchestrator.RunSyncAsync();
    }

    logger.LogInformation("Sync Result: {Result}",
        System.Text.Json.JsonSerializer.Serialize(result));

    logger.LogInformation("Mailbot sync completed. Service will exit.");
    logger.LogInformation("Schedule this to run daily using Windows Task Scheduler, cron, or systemd timer");

    // Exit after one run (will be scheduled externally)
    return result.Success ? 0 : 1;
}
catch (Exception ex)
{
    Console.Error.WriteLine("Fatal error in Mailbot worker:");
    Console.Error.WriteLine(ex.ToString());
    return 1;
}

// Reads `--name value` from the CLI args (case-insensitive); null if absent.
static string? GetArg(string[] args, string name)
{
    var i = Array.FindIndex(args, a => a.Equals(name, StringComparison.OrdinalIgnoreCase));
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}
