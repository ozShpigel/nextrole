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

    var orchestrator = host.Services.GetRequiredService<MailbotOrchestrator>();

    logger.LogInformation("Mailbot service started");
    logger.LogInformation("Current time: {Time}", DateTime.Now);

    // Run sync immediately on start
    var result = await orchestrator.RunSyncAsync();

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
