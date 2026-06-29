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

    // Logging
    builder.Logging.ClearProviders();
    builder.Logging.AddConsole();

    // Services
    builder.Services.AddSingleton<IGmailEmailService, GmailEmailService>();
    builder.Services.AddSingleton<MailbotOrchestrator>();

    var trackerUrl = builder.Configuration["Tracker:BaseUrl"] ?? "http://localhost:5002";

    builder.Services.AddHttpClient<IEmailParser, HttpEmailParser>(client =>
    {
        client.BaseAddress = new Uri(trackerUrl);
        client.Timeout = TimeSpan.FromSeconds(120);
    });

    builder.Services.AddHttpClient<ITrackerApiClient, TrackerApiClient>(client =>
    {
        client.BaseAddress = new Uri(trackerUrl);
        client.Timeout = TimeSpan.FromSeconds(120);
    });

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

    // Modes (re-sync reconciles from full email history; default is last-24h sync):
    //   default                                  → daily last-24h sync
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
