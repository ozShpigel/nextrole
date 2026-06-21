using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Infrastructure.Profile;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Driver;

// Seeds a database with fictional demo data: the sample persona profile + a
// handful of fictional tracked applications across varied statuses. Idempotent
// (skips applications that already exist by Company+JobTitle). Intended to be
// run against the SEPARATE demo database — never the real one.
//
//   MongoDB__ConnectionString="<demo-db-uri>" dotnet run --project server/api/src/Seeder

string Env(string key) =>
    Environment.GetEnvironmentVariable(key)
    ?? Environment.GetEnvironmentVariable(key.Replace("__", ":"))
    ?? "";

var connectionString = Env("MongoDB__ConnectionString");
if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine("MongoDB__ConnectionString is required. Set it to the DEMO database URI.");
    return 1;
}

var trackerDb = Env("MongoDB__DatabaseName") is { Length: > 0 } t ? t : "job-tracker";
var profileDb = Env("MongoDB__ProfileDatabase") is { Length: > 0 } p ? p
    : (Env("MongoDB__Database") is { Length: > 0 } d ? d : "jobmatch");

var host = new MongoUrl(connectionString).Server?.Host ?? "(unknown host)";
Console.WriteLine($"Seeding demo data → host={host}, tracker DB='{trackerDb}', profile DB='{profileDb}'");

var client = new MongoClient(connectionString);

// 1) Persona — reuse the API's seed path so the stored shape matches exactly
//    (structured + rendered content). Seeds only if absent (idempotent).
var config = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["ContentRoot"] = AppContext.BaseDirectory,
        ["Profile:FilePath"] = "Data/sample-profile.json",
        ["MongoDB:ProfileDatabase"] = profileDb,
    })
    .Build();

var profileProvider = new MongoProfileProvider(
    client, config, new MemoryCache(new MemoryCacheOptions()), NullLogger<MongoProfileProvider>.Instance);
var profile = await profileProvider.GetProfileDocumentAsync();
Console.WriteLine($"Profile persona ensured ({profile.Structured.Experience.Length} role(s) in sample).");

// 2) Fictional applications across varied statuses (invented companies only).
var db = client.GetDatabase(trackerDb);
var apps = db.GetCollection<Application>("applications");
var statusUpdates = db.GetCollection<StatusUpdate>("statusUpdates");
var interviews = db.GetCollection<Interview>("interviews");

var now = DateTime.UtcNow;

var seeds = new List<(Application App, Interview[] Interviews)>
{
    (new Application
    {
        JobTitle = "Backend Engineer", Company = "Stratus Cloud", Status = ApplicationStatus.DecidedToApply,
        MatchScore = 82, MatchVerdict = "YES", JobUrl = "https://example.com/jobs/stratus-backend",
        JobDescription = "Build and operate backend services for a cloud platform team.",
        CreatedAt = now.AddDays(-2), UpdatedAt = now.AddDays(-2),
    }, Array.Empty<Interview>()),

    (new Application
    {
        JobTitle = "Full Stack Engineer", Company = "Vela Systems", Status = ApplicationStatus.Applied,
        MatchScore = 76, MatchVerdict = "YES", JobUrl = "https://example.com/jobs/vela-fullstack",
        JobDescription = "Ship product features across a TypeScript/Node stack.",
        CreatedAt = now.AddDays(-9), AppliedAt = now.AddDays(-8), UpdatedAt = now.AddDays(-8),
    }, Array.Empty<Interview>()),

    (new Application
    {
        JobTitle = "Software Engineer", Company = "Orchard Health", Status = ApplicationStatus.PhoneScreen,
        MatchScore = 71, MatchVerdict = "YES", JobUrl = "https://example.com/jobs/orchard-swe",
        JobDescription = "Backend + data work for a digital health product.",
        CreatedAt = now.AddDays(-14), AppliedAt = now.AddDays(-12), UpdatedAt = now.AddDays(-4),
    }, new[]
    {
        new Interview { ApplicationId = Guid.Empty, ScheduledAt = now.AddDays(-3), Type = InterviewType.Phone,
            Interviewer = "Dana Levin", Topics = "Background, role expectations", Completed = true },
    }),

    (new Application
    {
        JobTitle = "Senior Software Engineer", Company = "Nimbus Data", Status = ApplicationStatus.TechnicalInterview,
        MatchScore = 88, MatchVerdict = "STRONG_YES", JobUrl = "https://example.com/jobs/nimbus-senior",
        JobDescription = "Own distributed data pipelines and service reliability.",
        CreatedAt = now.AddDays(-20), AppliedAt = now.AddDays(-18), UpdatedAt = now.AddDays(-2),
    }, new[]
    {
        new Interview { ApplicationId = Guid.Empty, ScheduledAt = now.AddDays(-6), Type = InterviewType.Phone,
            Interviewer = "Recruiting", Completed = true },
        new Interview { ApplicationId = Guid.Empty, ScheduledAt = now.AddDays(1), Type = InterviewType.Technical,
            Interviewer = "Priya Nair", Topics = "System design, coding", Completed = false },
    }),

    (new Application
    {
        JobTitle = "Platform Engineer", Company = "Beacon Labs", Status = ApplicationStatus.OfferReceived,
        MatchScore = 84, MatchVerdict = "STRONG_YES", Salary = "$150k base",
        JobUrl = "https://example.com/jobs/beacon-platform",
        JobDescription = "Developer platform and CI/CD tooling for product teams.",
        CreatedAt = now.AddDays(-30), AppliedAt = now.AddDays(-28), UpdatedAt = now.AddDays(-1),
    }, Array.Empty<Interview>()),

    (new Application
    {
        JobTitle = "Backend Developer", Company = "Ironwood Retail", Status = ApplicationStatus.Rejected,
        MatchScore = 58, MatchVerdict = "MAYBE", JobUrl = "https://example.com/jobs/ironwood-backend",
        JobDescription = "Maintain order-management services for a retail platform.",
        CreatedAt = now.AddDays(-35), AppliedAt = now.AddDays(-33), UpdatedAt = now.AddDays(-10),
    }, Array.Empty<Interview>()),
};

// Idempotency: skip any application that already exists by (Company, JobTitle),
// case-insensitively (mirrors the unique index).
var existing = await apps.Find(FilterDefinition<Application>.Empty).ToListAsync();
var existingKeys = existing
    .Select(a => $"{a.Company}|{a.JobTitle}".ToLowerInvariant())
    .ToHashSet();

int created = 0, skipped = 0;
foreach (var (app, ivs) in seeds)
{
    var key = $"{app.Company}|{app.JobTitle}".ToLowerInvariant();
    if (existingKeys.Contains(key)) { skipped++; continue; }

    await apps.InsertOneAsync(app);
    await statusUpdates.InsertOneAsync(new StatusUpdate
    {
        ApplicationId = app.Id,
        FromStatus = ApplicationStatus.Analyzing,
        ToStatus = app.Status,
        Note = "Seeded demo data",
        Timestamp = app.CreatedAt,
    });
    foreach (var iv in ivs)
        await interviews.InsertOneAsync(iv with { ApplicationId = app.Id });

    existingKeys.Add(key);
    created++;
}

Console.WriteLine($"Applications: {created} created, {skipped} skipped (already present).");
Console.WriteLine("Demo seed complete.");
return 0;
