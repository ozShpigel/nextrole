using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Infrastructure.Profile;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
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

// 3) Interview-prep on the demo profile (idempotent — skip if already authored).
var prep = await profileProvider.GetInterviewPrepAsync();
if (string.IsNullOrWhiteSpace(prep.SelfPresentationHr))
{
    await profileProvider.UpsertInterviewPrepAsync(
        selfPresentationHr:
            "I'm a backend-leaning full-stack engineer with about six years of experience building and " +
            "operating web services. I care most about shipping reliable software with a small, focused team, " +
            "and I enjoy owning features end to end — from API design through deployment and on-call. I also " +
            "mentor junior engineers and like improving developer experience. I'm looking for a role where I can " +
            "own a meaningful part of the product and grow toward technical leadership.",
        selfPresentationTechnical:
            "My core stack is C#/.NET and TypeScript/Node on the backend with React on the front end, running on " +
            "cloud infrastructure with MongoDB and Postgres. I've designed and operated distributed services — REST " +
            "APIs, background workers, and event-driven pipelines — with an emphasis on observability and graceful " +
            "degradation. Recently I've worked on LLM integrations: prompt design, structured outputs, and cost/latency " +
            "trade-offs. I value clear boundaries, testing at the right level, and pragmatic system design.",
        presentingWorkProject:
            "I led the rebuild of our order-processing service. The legacy monolith couldn't keep up at peak, so I " +
            "extracted the hot path into a queue-backed worker, added idempotency keys to make retries safe, and added " +
            "structured logging and dashboards. It cut p95 latency by ~40% and eliminated the duplicate-charge incidents " +
            "we'd been seeing. The hardest part was migrating without downtime — I used dual-write and shadow-reads before " +
            "cutting over.",
        presentingPersonalProject:
            "On the side I built a small open-source CLI that watches a folder and syncs media to a self-hosted server. " +
            "It's not fancy, but it taught me a lot about filesystem events, backpressure, and writing a tool other people " +
            "rely on — which pushed me to care about clear docs and a stable interface.",
        qaRubric: new List<QaEntry>
        {
            new() { Question = "Where do you see yourself in 5 years?",
                Answer = "Growing into a senior/tech-lead role where I own a significant area of the product and help set " +
                         "technical direction while still writing code — deepening system design and mentoring rather than " +
                         "moving fully into management." },
            new() { Question = "Tell me about a time you disagreed with a teammate.",
                Answer = "On the order-processing rebuild a teammate wanted a full rewrite; I argued for a strangler-fig " +
                         "approach to cut risk. I laid out the migration and rollback plan, we tried it behind a flag, and the " +
                         "incremental cutover saved weeks and avoided downtime." },
            new() { Question = "Why are you looking to leave your current role?",
                Answer = "I've shipped things I'm proud of, but I've grown past the scope available to me. I want harder " +
                         "technical problems and a clearer path toward technical leadership." },
        });
    Console.WriteLine("Interview-prep seeded.");
}
else Console.WriteLine("Interview-prep already present — skipped.");

// 4) Discovery — one active criterion + a completed run + scored jobs (idempotent
//    by criterion name). These collections live in the tracker DB and use the
//    Python scraper's snake_case schema; match_analysis mirrors the API's camelCase
//    MatchResponse so the "Score Breakdown"/"Signals" UI renders.
var criteriaCol = db.GetCollection<BsonDocument>("search_criteria");
var runsCol = db.GetCollection<BsonDocument>("discovery_runs");
var jobsCol = db.GetCollection<BsonDocument>("discovered_jobs");

const string demoCriteriaName = "Backend / Platform Engineer";
if (!await criteriaCol.Find(Builders<BsonDocument>.Filter.Eq("name", demoCriteriaName)).AnyAsync())
{
    var criteriaId = Guid.NewGuid().ToString();
    var runId = Guid.NewGuid().ToString();
    var runAt = now.AddDays(-1);

    await criteriaCol.InsertOneAsync(new BsonDocument
    {
        ["id"] = criteriaId, ["name"] = demoCriteriaName,
        ["job_titles"] = new BsonArray { "Backend Engineer", "Platform Engineer", "Software Engineer" },
        ["locations"] = new BsonArray { "Tel Aviv", "Remote" },
        ["site_names"] = new BsonArray { "linkedin", "indeed" },
        ["results_wanted"] = 15, ["hours_old"] = 72, ["country"] = "Israel",
        ["is_remote"] = BsonNull.Value, ["min_score_to_save"] = 70, ["is_active"] = true,
        ["created_at"] = now.AddDays(-6), ["updated_at"] = now.AddDays(-1),
    });

    await runsCol.InsertOneAsync(new BsonDocument
    {
        ["id"] = runId, ["criteria_id"] = criteriaId, ["criteria_name"] = demoCriteriaName,
        ["status"] = "completed", ["mode"] = "live",
        ["batch_id"] = BsonNull.Value, ["batch_submitted_at"] = BsonNull.Value,
        ["started_at"] = runAt, ["completed_at"] = runAt.AddMinutes(4),
        ["jobs_scraped"] = 8, ["jobs_scored"] = 3, ["jobs_saved"] = 1, ["jobs_skipped_duplicate"] = 2,
        ["error"] = BsonNull.Value,
    });

    var jobs = new List<BsonDocument>
    {
        Job(runId, criteriaId, "Backend Engineer", "Stratus Cloud", "Tel Aviv",
            "Build and operate backend services for a cloud platform team.", 82, "YES", true, true, runAt,
            Analysis("Backend Engineer", "Stratus Cloud", 82, "YES", true, (16, 11), (13, 12), (11, 11, 8),
                new[] { "Strong .NET + cloud background", "Clear ownership of services" }, Array.Empty<string>(),
                "Strong overall fit; stack and seniority line up well with the role.",
                new[] { "Recently raised a growth round" }, Array.Empty<string>(),
                "Company is growing and hiring across engineering.")),
        Job(runId, criteriaId, "Platform Engineer", "Northwind Labs", "Remote",
            "Developer platform and CI/CD tooling for product teams.", 74, "YES", true, false, runAt,
            Analysis("Platform Engineer", "Northwind Labs", 74, "YES", true, (14, 11), (12, 10), (10, 9, 8),
                new[] { "Platform / DevX experience", "Comfortable with CI/CD" }, new[] { "Domain is newer to the candidate" },
                "Good fit with a mild ramp on the platform domain.",
                Array.Empty<string>(), Array.Empty<string>(), "No notable recent news.")),
        Job(runId, criteriaId, "Data Engineer", "Cobalt Systems", "Tel Aviv",
            "Own batch and streaming data pipelines for analytics.", 56, "MAYBE", false, false, runAt,
            Analysis("Data Engineer", "Cobalt Systems", 56, "MAYBE", false, (11, 9), (9, 7), (7, 7, 6),
                new[] { "Transferable backend skills" }, new[] { "Limited data-engineering depth", "On-call load hinted" },
                "Partial fit; the role leans more data-engineering than the candidate's core.",
                Array.Empty<string>(), new[] { "Some Glassdoor reviews mention long hours" },
                "Mixed signals on work-life balance.")),
    };
    await jobsCol.InsertManyAsync(jobs);
    Console.WriteLine($"Discovery seeded: 1 criterion, 1 completed run, {jobs.Count} jobs.");
}
else Console.WriteLine("Discovery data already present — skipped.");

Console.WriteLine("Demo seed complete.");
return 0;

// ---- local helpers for the discovery seed ----
static BsonArray Arr(params string[] items) => new(items);

static BsonDocument Comp(string name, int score, int max, string reason) =>
    new() { ["name"] = name, ["score"] = score, ["maxScore"] = max, ["reason"] = reason };

static BsonDocument Analysis(
    string title, string company, int overall, string verdict, bool shouldApply,
    (int core, int sys) tech, (int a, int b) exec, (int wl, int comm, int growth) sust,
    string[] green, string[] red, string honest, string[] newsGreen, string[] newsRed, string newsSummary) =>
    new()
    {
        ["jobTitle"] = title, ["company"] = company, ["overallScore"] = overall, ["verdict"] = verdict,
        ["breakdown"] = new BsonDocument
        {
            ["technicalFit"] = new BsonDocument
            {
                ["score"] = tech.core + tech.sys, ["maxScore"] = 35,
                ["components"] = new BsonArray
                {
                    Comp("Core Stack", tech.core, 20, "Stack overlaps well with the role's primary languages and frameworks."),
                    Comp("System Design", tech.sys, 15, "Relevant experience with services, queues, and data modeling at scale."),
                },
                ["strengths"] = Arr("Strong backend fundamentals", "Ships end to end"),
                ["gaps"] = Arr("Limited exposure to the exact domain"),
            },
            ["engineeringExecutionFit"] = new BsonDocument
            {
                ["score"] = exec.a + exec.b, ["maxScore"] = 30,
                ["components"] = new BsonArray
                {
                    Comp("Practices & Ownership", exec.a, 15, "Owns features from design through on-call; healthy testing habits."),
                    Comp("Engineering Maturity", exec.b, 15, "Comfortable with CI/CD, observability, and incremental migration."),
                },
                ["strengths"] = Arr("Ownership mindset", "Pragmatic testing"),
                ["concerns"] = Arr("Team process not fully described in the posting"),
            },
            ["sustainabilityPaceFit"] = new BsonDocument
            {
                ["score"] = sust.wl + sust.comm + sust.growth, ["maxScore"] = 35,
                ["components"] = new BsonArray
                {
                    Comp("Work-Life", sust.wl, 12, "No signals of chronic crunch; reasonable scope."),
                    Comp("Communication & Pace", sust.comm, 12, "Clear role definition; collaborative team described."),
                    Comp("Growth & Long-term", sust.growth, 11, "Room to grow toward technical leadership."),
                },
                ["positiveSignals"] = Arr("Sustainable pace", "Growth path"),
                ["concerns"] = Arr("Compensation not stated"),
            },
        },
        ["recommendation"] = new BsonDocument
        {
            ["shouldApply"] = shouldApply,
            ["keyReasons"] = new BsonArray(green),
            ["questionsToAsk"] = Arr("What does on-call look like?", "How are technical decisions made?"),
            ["redFlags"] = new BsonArray(red),
            ["greenFlags"] = new BsonArray(green),
        },
        ["honestAssessment"] = honest,
        ["companyNewsAnalysis"] = new BsonDocument
        {
            ["greenSignals"] = new BsonArray(newsGreen),
            ["redSignals"] = new BsonArray(newsRed),
            ["summary"] = newsSummary,
        },
    };

static BsonDocument Job(
    string runId, string criteriaId, string title, string company, string location,
    string description, int score, string verdict, bool shouldApply, bool saved, DateTime at, BsonDocument analysis) =>
    new()
    {
        ["id"] = Guid.NewGuid().ToString(),
        ["run_id"] = runId, ["criteria_id"] = criteriaId,
        ["title"] = title, ["company"] = company, ["location"] = location, ["description"] = description,
        ["job_url"] = "https://example.com/jobs/" + company.ToLowerInvariant().Replace(" ", "-"),
        ["date_posted"] = at.AddDays(-1).ToString("yyyy-MM-dd"), ["site"] = "linkedin",
        ["score"] = score, ["verdict"] = verdict, ["should_apply"] = shouldApply,
        ["match_analysis"] = analysis,
        ["analyst_snapshot_input"] = BsonNull.Value, ["analyst_snapshot_output"] = BsonNull.Value,
        ["evaluator_snapshot_input"] = BsonNull.Value, ["evaluator_snapshot_output"] = BsonNull.Value,
        ["company_news"] = BsonNull.Value, ["glassdoor_data"] = BsonNull.Value,
        ["is_duplicate"] = false, ["saved_to_tracker"] = saved, ["dismissed"] = false,
        ["discovered_at"] = at,
    };
