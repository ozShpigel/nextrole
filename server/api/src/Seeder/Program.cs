using System.Text.Json;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Infrastructure.Pdf;
using ApplicationTracker.Infrastructure.Profile;
using ApplicationTracker.Infrastructure.Repositories;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;
using QuestPDF.Infrastructure;

QuestPDF.Settings.License = LicenseType.Community;

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

// 1) Persona — sample-profile.json is the single source of truth for the demo
// persona's content, with a hardcoded fake identity (name/email/phone/
// LinkedIn — never part of the file, and the only user-editable fields) laid
// on top. Synced unconditionally on every run, not just when absent: this is
// fictional data with no "real user edit" to protect, and the demo DB has at
// times been used interactively, so this also doubles as the fix for a real
// name/contact ever having ended up here.
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

var sampleProfileJson = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Data/sample-profile.json"));
var sampleProfile = JsonSerializer.Deserialize<StructuredProfile>(sampleProfileJson, new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true,
}) ?? new StructuredProfile();

var demoProfile = sampleProfile with
{
    FullName = "Alex Morgan",
    Email = "alex.morgan@example.com",
    Phone = "+1-555-0100",
    Location = "Tel Aviv, Israel",
    LinkedIn = "linkedin.com/in/alex-morgan-demo",
};
await profileProvider.UpsertProfileAsync(demoProfile);
var profile = await profileProvider.GetProfileDocumentAsync();
Console.WriteLine($"Profile persona synced from sample-profile.json ({profile.Structured.Experience.Length} role(s), {profile.Structured.SideProjects.Length} side project(s)).");

// 1b) A résumé file to preview on the Profile page's Résumé tab — rendered
// straight from the seeded StructuredProfile (no LLM call), reusing the exact
// renderer real Generate Pack output goes through, so it previews identically.
// Always regenerated (not idempotent) so a contact-field reset above is
// reflected in the PDF header too.
var resumeFileCol = client.GetDatabase(profileDb).GetCollection<ResumeFile>("resumeFile");
var resumeFileRepo = new ResumeFileRepository(resumeFileCol);
{
    var sp = profile.Structured;
    var pack = new ResumePack
    {
        TailoredSummary = sp.Summary,
        Experience = sp.Experience.Select(e => new TailoredExperienceItem
        {
            Title = e.Title, Company = e.Company, Dates = e.Dates, Highlights = e.Highlights.ToList(),
        }).ToList(),
        HighlightedSkills = sp.Skills.Select(s => new SkillCategory
        {
            Category = s.Category, Items = s.Items.ToList(),
        }).ToList(),
        SideProjects = sp.SideProjects.ToList(),
    };
    var pdfBytes = new QuestPdfResumeRenderer().Render(pack, sp);
    await resumeFileRepo.UpsertAsync(new ResumeFile
    {
        Bytes = pdfBytes,
        FileName = "resume.pdf",
        ContentType = "application/pdf",
        UploadedAt = DateTime.UtcNow,
        PageCount = PdfPageCounter.CountPages(pdfBytes),
    });
    Console.WriteLine($"Résumé file seeded/refreshed ({pdfBytes.Length} bytes).");
}

// 2) Fictional applications across varied statuses (invented companies only).
var db = client.GetDatabase(trackerDb);
var apps = db.GetCollection<Application>("applications");
var statusUpdates = db.GetCollection<StatusUpdate>("statusUpdates");
var interviews = db.GetCollection<Interview>("interviews");
var resumePacksCol = db.GetCollection<ResumePack>("resumePacks");

var now = DateTime.UtcNow;

// Stratus Cloud is the app the tracker demo clip (docs/demos/specs/tracker.spec.ts)
// clicks into from Recent Activity (it's the most recently created, so it sorts
// first) to show the "AI Analysis" score breakdown. Nothing in the API/mailbot
// ever populates Application.MatchAnalysis (only discovered_jobs.match_analysis
// does, pre-application) — reuse the same breakdown already authored below for
// the matching discovered-job entry (same title/company/score/verdict) so the
// tracker detail page has a real breakdown to render instead of the section
// silently disappearing (AnalysisCard returns null with no matchAnalysisJson).
var stratusMatchAnalysisJson = Analysis(
    "Backend Engineer", "Stratus Cloud", 82, "YES", true, (16, 11), (13, 12), (11, 11, 8),
    new[] { "Strong .NET + cloud background", "Clear ownership of services" }, Array.Empty<string>(),
    "Strong overall fit; stack and seniority line up well with the role.",
    new[] { "Recently raised a growth round" }, Array.Empty<string>(),
    "Company is growing and hiring across engineering.").ToJson();

var seeds = new List<(Application App, Interview[] Interviews, string? MatchAnalysisJson)>
{
    (new Application
    {
        JobTitle = "Backend Engineer", Company = "Stratus Cloud", Status = ApplicationStatus.DecidedToApply,
        MatchScore = 82, MatchVerdict = "YES", JobUrl = "https://example.com/jobs/stratus-backend",
        JobDescription = "Build and operate backend services for a cloud platform team.",
        CreatedAt = now.AddDays(-2), UpdatedAt = now.AddDays(-2),
    }, Array.Empty<Interview>(), stratusMatchAnalysisJson),

    // Every tracked application below also appears in the discovery pool further
    // down (same title/company/score — see trackedCompanies), marked
    // saved_to_tracker there: a reviewer clicking through from Matches sees the
    // exact same job already sitting on the Active board, the way a real "Added"
    // card behaves, instead of two disconnected fake datasets.
    (new Application
    {
        JobTitle = "DevOps Engineer", Company = "Ridgeline Cloud", Status = ApplicationStatus.TechnicalInterview,
        MatchScore = 72, MatchVerdict = "YES", JobUrl = "https://example.com/jobs/ridgeline-cloud",
        JobDescription = "Infra automation for a cloud consultancy.",
        CreatedAt = now.AddDays(-20), AppliedAt = now.AddDays(-18), UpdatedAt = now.AddDays(-2),
    }, new[]
    {
        new Interview { ApplicationId = Guid.Empty, ScheduledAt = now.AddDays(-6), Type = InterviewType.Phone,
            Interviewer = "Recruiting", Completed = true },
        new Interview { ApplicationId = Guid.Empty, ScheduledAt = now.AddDays(1), Type = InterviewType.Technical,
            Interviewer = "Priya Nair", Topics = "System design, coding", Completed = false },
    }, null),

    (new Application
    {
        JobTitle = "Full Stack Engineer", Company = "Verdant Foods", Status = ApplicationStatus.OfferReceived,
        MatchScore = 68, MatchVerdict = "YES", Salary = "$150k base",
        JobUrl = "https://example.com/jobs/verdant-foods",
        JobDescription = "Ship features across a React/Node e-commerce stack.",
        CreatedAt = now.AddDays(-30), AppliedAt = now.AddDays(-28), UpdatedAt = now.AddDays(-1),
    }, Array.Empty<Interview>(), null),

    (new Application
    {
        JobTitle = "Site Reliability Engineer", Company = "Anchorpoint Security", Status = ApplicationStatus.Applied,
        MatchScore = 63, MatchVerdict = "MAYBE", JobUrl = "https://example.com/jobs/anchorpoint-security",
        JobDescription = "On-call, observability, and incident response for a security product.",
        CreatedAt = now.AddDays(-9), AppliedAt = now.AddDays(-8), UpdatedAt = now.AddDays(-8),
    }, Array.Empty<Interview>(), null),

    (new Application
    {
        JobTitle = "Software Engineer", Company = "Bramble Media", Status = ApplicationStatus.PhoneScreen,
        MatchScore = 61, MatchVerdict = "MAYBE", JobUrl = "https://example.com/jobs/bramble-media",
        JobDescription = "Build content pipelines for a media platform.",
        CreatedAt = now.AddDays(-14), AppliedAt = now.AddDays(-12), UpdatedAt = now.AddDays(-4),
    }, new[]
    {
        new Interview { ApplicationId = Guid.Empty, ScheduledAt = now.AddDays(-3), Type = InterviewType.Phone,
            Interviewer = "Dana Levin", Topics = "Background, role expectations", Completed = true },
    }, null),

    (new Application
    {
        JobTitle = "Backend Engineer", Company = "Coppermine Insurance", Status = ApplicationStatus.Rejected,
        MatchScore = 54, MatchVerdict = "MAYBE", JobUrl = "https://example.com/jobs/coppermine-insurance",
        JobDescription = "Maintain claims-processing services.",
        CreatedAt = now.AddDays(-35), AppliedAt = now.AddDays(-33), UpdatedAt = now.AddDays(-10),
    }, Array.Empty<Interview>(), null),

    (new Application
    {
        JobTitle = "Senior Backend Engineer", Company = "Meridian Robotics", Status = ApplicationStatus.DecidedToApply,
        MatchScore = 91, MatchVerdict = "STRONG_YES", JobUrl = "https://example.com/jobs/meridian-robotics",
        JobDescription = "Build control-plane services for autonomous fleet software.",
        CreatedAt = now.AddDays(-1), UpdatedAt = now.AddDays(-1),
    }, Array.Empty<Interview>(), null),

    (new Application
    {
        JobTitle = "Staff Software Engineer", Company = "Solace Fintech", Status = ApplicationStatus.DecidedToApply,
        MatchScore = 88, MatchVerdict = "STRONG_YES", JobUrl = "https://example.com/jobs/solace-fintech",
        JobDescription = "Own payments infrastructure reliability and scale.",
        CreatedAt = now.AddDays(-3), UpdatedAt = now.AddDays(-3),
    }, Array.Empty<Interview>(), null),

    (new Application
    {
        JobTitle = "Backend Engineer", Company = "Harborlight Logistics", Status = ApplicationStatus.Applied,
        MatchScore = 79, MatchVerdict = "YES", JobUrl = "https://example.com/jobs/harborlight-logistics",
        JobDescription = "Build tracking and routing services for a logistics platform.",
        CreatedAt = now.AddDays(-11), AppliedAt = now.AddDays(-10), UpdatedAt = now.AddDays(-10),
    }, Array.Empty<Interview>(), null),

    (new Application
    {
        JobTitle = "Platform Engineer", Company = "Kestrel Analytics", Status = ApplicationStatus.PhoneScreen,
        MatchScore = 77, MatchVerdict = "YES", JobUrl = "https://example.com/jobs/kestrel-analytics",
        JobDescription = "Internal developer platform and CI/CD.",
        CreatedAt = now.AddDays(-16), AppliedAt = now.AddDays(-15), UpdatedAt = now.AddDays(-6),
    }, new[]
    {
        new Interview { ApplicationId = Guid.Empty, ScheduledAt = now.AddDays(-6), Type = InterviewType.Phone,
            Interviewer = "Recruiting", Topics = "Background, role expectations", Completed = true },
    }, null),
};

// Self-healing: keyed by (Company, JobTitle) case-insensitively (mirrors the
// unique index). An already-existing curated application gets its
// demo-mutable fields (Status/AppliedAt/UpdatedAt — what the Active board's
// "I Applied"/"Remove" actions change) force-reset back to the seed's
// values, rather than skipped, so a demo visitor's status changes don't
// stick around forever. New ones are inserted as before.
var existing = await apps.Find(FilterDefinition<Application>.Empty).ToListAsync();
var existingByKey = existing.ToDictionary(a => $"{a.Company}|{a.JobTitle}".ToLowerInvariant());
var curatedKeys = seeds.Select(s => $"{s.App.Company}|{s.App.JobTitle}".ToLowerInvariant()).ToHashSet();

int created = 0, reset = 0, backfilled = 0;
foreach (var (app, ivs, matchAnalysisJson) in seeds)
{
    var key = $"{app.Company}|{app.JobTitle}".ToLowerInvariant();
    if (existingByKey.TryGetValue(key, out var current))
    {
        if (current.Status != app.Status || current.AppliedAt != app.AppliedAt)
        {
            await apps.UpdateOneAsync(
                a => a.Id == current.Id,
                Builders<Application>.Update
                    .Set(a => a.Status, app.Status)
                    .Set(a => a.AppliedAt, app.AppliedAt)
                    .Set(a => a.UpdatedAt, app.UpdatedAt));
            reset++;
        }
        // Backfill MatchAnalysis onto an already-seeded app from an earlier run
        // (only if still unset, so this never clobbers real data).
        if (matchAnalysisJson != null)
        {
            var backfillFilter = Builders<Application>.Filter.And(
                Builders<Application>.Filter.Eq(a => a.Company, app.Company),
                Builders<Application>.Filter.Eq(a => a.JobTitle, app.JobTitle),
                Builders<Application>.Filter.Eq(a => a.MatchAnalysis, null));
            var result = await apps.UpdateOneAsync(backfillFilter, Builders<Application>.Update.Set(a => a.MatchAnalysis, matchAnalysisJson));
            if (result.ModifiedCount > 0) backfilled++;
        }
        continue;
    }

    var toInsert = matchAnalysisJson != null ? app with { MatchAnalysis = matchAnalysisJson } : app;
    await apps.InsertOneAsync(toInsert);
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

    created++;
}

// Cleanup: any application NOT in the curated seed list is a demo-visitor
// artifact (added via the Matches page's "Add" button) — remove it and its
// cascaded rows so a reseed fully restores the curated board.
var orphans = existing.Where(a => !curatedKeys.Contains($"{a.Company}|{a.JobTitle}".ToLowerInvariant())).ToList();
if (orphans.Count > 0)
{
    var orphanIds = orphans.Select(a => a.Id).ToList();
    await apps.DeleteManyAsync(a => orphanIds.Contains(a.Id));
    await interviews.DeleteManyAsync(i => orphanIds.Contains(i.ApplicationId));
    await statusUpdates.DeleteManyAsync(s => orphanIds.Contains(s.ApplicationId));
    await resumePacksCol.DeleteManyAsync(p => orphanIds.Contains(p.ApplicationId));
}

Console.WriteLine($"Applications: {created} created, {reset} reset to curated state, {backfilled} backfilled with match analysis, {orphans.Count} demo-added orphans removed.");

// 2a) A résumé pack for Solace Fintech so the Active board's "Ready" column
// (DecidedToApply + a generated pack) isn't permanently empty — Generate Pack
// itself isn't demo-allowlisted, so a visitor could never fill this column
// themselves. Idempotent — skip if a pack already exists for that application.
var solaceApp = await apps.Find(a => a.Company == "Solace Fintech").FirstOrDefaultAsync();
if (solaceApp is not null && await resumePacksCol.Find(p => p.ApplicationId == solaceApp.Id).FirstOrDefaultAsync() is null)
{
    var sp = profile.Structured;
    await resumePacksCol.InsertOneAsync(new ResumePack
    {
        ApplicationId = solaceApp.Id,
        TailoredSummary = sp.Summary,
        Experience = sp.Experience.Select(e => new TailoredExperienceItem
        {
            Title = e.Title, Company = e.Company, Dates = e.Dates, Highlights = e.Highlights.ToList(),
        }).ToList(),
        HighlightedSkills = sp.Skills.Select(s => new SkillCategory
        {
            Category = s.Category, Items = s.Items.ToList(),
        }).ToList(),
        SideProjects = sp.SideProjects.ToList(),
        GeneratedAt = now.AddDays(-3),
    });
    Console.WriteLine("Résumé pack seeded for Solace Fintech.");
}
else Console.WriteLine("Résumé pack already present or Solace Fintech app missing — skipped.");

// 2b) Fake mailbot-parsed messages tied to the applications above — Messages is
// otherwise permanently empty on the demo (the real mailbot refuses to run
// against a DemoMode tracker). Self-healing: always deleted and reinserted
// fresh (not skip-if-any-exist) so a demo visitor marking one read doesn't
// stick around past the next reseed — mirrors the discovery jobs pattern.
var messagesCol = db.GetCollection<TrackedEmail>("messages");
await messagesCol.DeleteManyAsync(FilterDefinition<TrackedEmail>.Empty);
{
    var appIdByCompany = (await apps.Find(FilterDefinition<Application>.Empty).ToListAsync())
        .ToDictionary(a => a.Company, a => a.Id);

    Guid? AppId(string company) => appIdByCompany.TryGetValue(company, out var id) ? id : null;

    var messages = new List<TrackedEmail>
    {
        new()
        {
            GmailMessageId = "demo-seed-anchorpoint-received", ApplicationId = AppId("Anchorpoint Security"),
            Company = "Anchorpoint Security", JobTitle = "Site Reliability Engineer", UpdateType = "ApplicationReceived",
            From = "careers@anchorpointsecurity.example", Subject = "We've received your application",
            Snippet = "Thanks for applying to the Site Reliability Engineer role at Anchorpoint Security. Our team will review your application and follow up within two weeks.",
            ReceivedAt = now.AddDays(-8),
        },
        new()
        {
            GmailMessageId = "demo-seed-bramble-received", ApplicationId = AppId("Bramble Media"),
            Company = "Bramble Media", JobTitle = "Software Engineer", UpdateType = "ApplicationReceived",
            From = "talent@bramblemedia.example", Subject = "Application received — Software Engineer",
            Snippet = "Hi, thanks for your interest in Bramble Media. We're reviewing applications now and will be in touch soon.",
            ReceivedAt = now.AddDays(-12),
        },
        new()
        {
            GmailMessageId = "demo-seed-bramble-interview", ApplicationId = AppId("Bramble Media"),
            Company = "Bramble Media", JobTitle = "Software Engineer", UpdateType = "InterviewScheduled",
            From = "dana.levin@bramblemedia.example", Subject = "Let's schedule a call",
            Snippet = "I'd love to set up a quick phone screen to learn more about your background — are you free later this week?",
            ReceivedAt = now.AddDays(-5),
        },
        new()
        {
            GmailMessageId = "demo-seed-ridgeline-received", ApplicationId = AppId("Ridgeline Cloud"),
            Company = "Ridgeline Cloud", JobTitle = "DevOps Engineer", UpdateType = "ApplicationReceived",
            From = "recruiting@ridgelinecloud.example", Subject = "Thanks for applying to Ridgeline Cloud",
            Snippet = "We've received your application for DevOps Engineer and will reach out if there's a fit.",
            ReceivedAt = now.AddDays(-18),
        },
        new()
        {
            GmailMessageId = "demo-seed-ridgeline-recruiter-call", ApplicationId = AppId("Ridgeline Cloud"),
            Company = "Ridgeline Cloud", JobTitle = "DevOps Engineer", UpdateType = "InterviewScheduled",
            From = "recruiting@ridgelinecloud.example", Subject = "Quick intro call?",
            Snippet = "Your background looks like a strong match — do you have 20 minutes this week for an intro call with our recruiting team?",
            ReceivedAt = now.AddDays(-7),
        },
        new()
        {
            GmailMessageId = "demo-seed-ridgeline-technical", ApplicationId = AppId("Ridgeline Cloud"),
            Company = "Ridgeline Cloud", JobTitle = "DevOps Engineer", UpdateType = "InterviewScheduled",
            From = "priya.nair@ridgelinecloud.example", Subject = "Technical interview confirmed",
            Snippet = "Confirming your technical interview with Priya Nair — system design and coding. Looking forward to it.",
            ReceivedAt = now.AddDays(-2),
        },
        new()
        {
            GmailMessageId = "demo-seed-verdant-received", ApplicationId = AppId("Verdant Foods"),
            Company = "Verdant Foods", JobTitle = "Full Stack Engineer", UpdateType = "ApplicationReceived",
            From = "careers@verdantfoods.example", Subject = "Application received — Full Stack Engineer",
            Snippet = "Thanks for applying! We'll be in touch once our team has reviewed your background.",
            ReceivedAt = now.AddDays(-28),
        },
        new()
        {
            GmailMessageId = "demo-seed-verdant-offer", ApplicationId = AppId("Verdant Foods"),
            Company = "Verdant Foods", JobTitle = "Full Stack Engineer", UpdateType = "OfferReceived",
            From = "careers@verdantfoods.example", Subject = "An offer from Verdant Foods",
            Snippet = "We're excited to offer you the Full Stack Engineer role. Details on compensation and next steps are attached.",
            ReceivedAt = now.AddDays(-1),
        },
        new()
        {
            GmailMessageId = "demo-seed-coppermine-received", ApplicationId = AppId("Coppermine Insurance"),
            Company = "Coppermine Insurance", JobTitle = "Backend Engineer", UpdateType = "ApplicationReceived",
            From = "jobs@coppermineinsurance.example", Subject = "Application received — Backend Engineer",
            Snippet = "Thanks for applying to Coppermine Insurance. Our hiring team is reviewing applications now.",
            ReceivedAt = now.AddDays(-33),
        },
        new()
        {
            GmailMessageId = "demo-seed-coppermine-rejected", ApplicationId = AppId("Coppermine Insurance"),
            Company = "Coppermine Insurance", JobTitle = "Backend Engineer", UpdateType = "Rejected",
            From = "jobs@coppermineinsurance.example", Subject = "Update on your application",
            Snippet = "After careful consideration, we've decided to move forward with other candidates for this role. We wish you the best in your search.",
            ReceivedAt = now.AddDays(-10),
        },
    };
    await messagesCol.InsertManyAsync(messages);
    Console.WriteLine($"Messages reset: {messages.Count} reinserted.");
}

// 3) Interview-prep on the demo profile — synced unconditionally (not
// idempotent) for the same reason the profile persona is: it needs to track
// sample-profile.json's actual content, and previously went stale here (it
// still referenced "C#/.NET" and an "order-processing service" from an
// earlier persona iteration, neither of which appear on the résumé anymore).
await profileProvider.UpsertInterviewPrepAsync(
    selfPresentationHr:
        "I'm a backend-leaning software engineer with about nine years of experience building and operating " +
        "web services in e-commerce and healthtech. I care most about shipping reliable software with a small, " +
        "focused team, and I enjoy owning a service end to end — from design through deployment and on-call. I " +
        "also mentor junior engineers and like improving how a team ships. I'm looking for a role where I can own " +
        "a meaningful part of the product and grow toward technical leadership.",
    selfPresentationTechnical:
        "My core stack is TypeScript/React and Node.js/Express on the frontend and API layer, Java/Spring Boot " +
        "for backend services, and Python for scripting and data work. I run this on AWS with Docker, Terraform, " +
        "and Kubernetes, backed by PostgreSQL, Redis, and DynamoDB. I've designed and operated distributed " +
        "services at real scale — a checkout platform handling millions of orders a month — with an emphasis on " +
        "observability, structured logging, and graceful degradation. I value clear boundaries, testing at the " +
        "right level, and pragmatic system design over cleverness.",
    presentingWorkProject:
        "I led moving our checkout platform off a single monolith into independently deployable services. The " +
        "monolith couldn't keep up at peak and a chunk of failed checkouts were retry storms after payment " +
        "failures, so I redesigned the retry path, added contract tests and CI gates to stop regressions, and " +
        "split out the highest-traffic pieces first. It cut payment-failure retries by 40% and cut production " +
        "regressions by roughly a third. The hardest part was sequencing the migration without downtime on a " +
        "service processing millions of orders a month — I leaned on the CI gates and a staged rollout rather " +
        "than a single cutover.",
    presentingPersonalProject:
        "On the side I built RouteCast, an open-source CLI that records and replays webhook events for local " +
        "development, so testing an integration doesn't require a live tunnel back to your machine. It came out " +
        "of being annoyed at how fragile tunnel-based webhook testing was on a previous project. It taught me a " +
        "lot about designing a good CLI interface and writing docs clear enough that a few other people actually " +
        "picked it up and used it.",
    qaRubric: new List<QaEntry>
    {
        new() { Question = "Where do you see yourself in 5 years?",
            Answer = "Growing into a senior/tech-lead role where I own a significant area of the product and help set " +
                     "technical direction while still writing code — deepening system design and mentoring rather than " +
                     "moving fully into management.",
            Categories = new List<string> { "HR" } },
        new() { Question = "Tell me about a time you disagreed with a teammate.",
            Answer = "On the checkout platform migration a teammate wanted a full rewrite; I argued for peeling off the " +
                     "highest-traffic services first behind contract tests instead, to cut risk. I laid out the migration " +
                     "and rollback plan, we tried the incremental approach, and it avoided downtime and shipped in stages " +
                     "instead of one high-risk cutover.",
            Categories = new List<string> { "Behavioral" },
            Topic = "Checkout platform migration" },
        new() { Question = "Why are you looking to leave your current role?",
            Answer = "I've shipped things I'm proud of, but I've grown past the scope available to me at Lumen Retail. " +
                     "I want harder technical problems and a clearer path toward technical leadership.",
            Categories = new List<string> { "HR" } },
        new() { Question = "Walk me through a production incident you handled under pressure.",
            Answer = "At Atlas Health I was on-call for the patient scheduling service when we started seeing elevated " +
                     "error rates after a deploy. I hadn't had structured logging or dashboards for that service yet, so " +
                     "triage was slow — that incident is exactly why I set them up afterward, along with the service's " +
                     "first on-call runbook. The next time something went wrong, triage took minutes instead of the better " +
                     "part of an hour.",
            Categories = new List<string> { "Technical", "Behavioral" },
            Topic = "Atlas Health on-call" },
        new() { Question = "Tell me about a side project you're proud of.",
            Answer = "RouteCast — an open-source CLI that records and replays webhook events for local dev, so testing " +
                     "an integration doesn't need a live tunnel. It's a small tool, but real people other than me use it, " +
                     "which pushed me to care about the CLI's ergonomics and docs a lot more than a purely internal tool " +
                     "would have required.",
            Categories = new List<string> { "HR", "Technical" },
            Topic = "RouteCast" },
        new() { Question = "How do you approach mentoring more junior engineers?",
            Answer = "Mostly through design review and pairing rather than lecturing — I'd rather ask questions that get " +
                     "someone to the right design themselves than hand it to them. At Lumen Retail I mentored three " +
                     "engineers and ran the team's design-review process; the goal was making review fast enough that " +
                     "people actually wanted feedback early, not just at the end.",
            Categories = new List<string> { "Behavioral" } },
        new() { Question = "Why did you get the AWS Solutions Architect certification, and does it actually show up in your work?",
            Answer = "I'd been doing infra work — Terraform, Docker, Kubernetes — mostly by pattern-matching what already " +
                     "existed, and wanted to actually understand the trade-offs instead of just copying the last " +
                     "approach. It shows up mostly in how I reason about cost and reliability trade-offs when I'm " +
                     "proposing infra changes now, not in day-to-day coding.",
            Categories = new List<string> { "Technical" } },
    });
Console.WriteLine("Interview-prep synced.");

// 4) Discovery — one active criterion + a completed run + a pool of fake, already-
//    scored jobs. These collections live in the tracker DB and use the Python
//    scraper's snake_case schema; match_analysis mirrors the API's camelCase
//    MatchResponse so the "Score Breakdown"/"Signals" UI renders.
//
//    Always refreshed (not skip-if-exists): the Matches page only shows jobs whose
//    discovered_at falls inside its default 14-day window, so a one-time seed goes
//    permanently stale. Re-running this script (or the DemoJobFreshnessInitializer
//    startup hook in the API, gated on DemoMode) re-anchors discovered_at to now.
var criteriaCol = db.GetCollection<BsonDocument>("search_criteria");
var runsCol = db.GetCollection<BsonDocument>("discovery_runs");
var jobsCol = db.GetCollection<BsonDocument>("discovered_jobs");

const string demoCriteriaName = "Backend / Platform Engineer";
var existingCriteria = await criteriaCol.Find(Builders<BsonDocument>.Filter.Eq("name", demoCriteriaName)).FirstOrDefaultAsync();
var criteriaId = existingCriteria?["id"].AsString ?? Guid.NewGuid().ToString();
var runId = Guid.NewGuid().ToString();
var runAt = now.AddHours(-2);

await jobsCol.DeleteManyAsync(Builders<BsonDocument>.Filter.Eq("criteria_id", criteriaId));
await runsCol.DeleteManyAsync(Builders<BsonDocument>.Filter.Eq("criteria_id", criteriaId));
await criteriaCol.ReplaceOneAsync(
    Builders<BsonDocument>.Filter.Eq("name", demoCriteriaName),
    new BsonDocument
    {
        ["id"] = criteriaId, ["name"] = demoCriteriaName,
        ["job_titles"] = new BsonArray { "Senior Software Developer" },
        ["locations"] = new BsonArray { "Tel Aviv" },
        ["site_names"] = new BsonArray { "linkedin", "indeed" },
        ["results_wanted"] = 25, ["hours_old"] = 168, ["country"] = "Israel",
        ["is_remote"] = BsonNull.Value, ["min_score_to_save"] = 70, ["is_active"] = true,
        ["created_at"] = existingCriteria?.GetValue("created_at", now.AddDays(-6)) ?? now.AddDays(-6),
        ["updated_at"] = now,
    },
    new ReplaceOptions { IsUpsert = true });

// Hand-authored — the app the tracker demo clip clicks into for a full breakdown.
var stratusJob = Job(runId, criteriaId, "Backend Engineer", "Stratus Cloud", "Tel Aviv",
    "Build and operate backend services for a cloud platform team.", 82, "YES", true, true, runAt,
    Analysis("Backend Engineer", "Stratus Cloud", 82, "YES", true, (16, 11), (13, 12), (11, 11, 8),
        new[] { "Strong .NET + cloud background", "Clear ownership of services" }, Array.Empty<string>(),
        "Strong overall fit; stack and seniority line up well with the role.",
        new[] { "Recently raised a growth round" }, Array.Empty<string>(),
        "Company is growing and hiring across engineering."));
var northwindJob = Job(runId, criteriaId, "Platform Engineer", "Northwind Labs", "Remote",
    "Developer platform and CI/CD tooling for product teams.", 74, "YES", true, false, runAt,
    Analysis("Platform Engineer", "Northwind Labs", 74, "YES", true, (14, 11), (12, 10), (10, 9, 8),
        new[] { "Platform / DevX experience", "Comfortable with CI/CD" }, new[] { "Domain is newer to the candidate" },
        "Good fit with a mild ramp on the platform domain.",
        Array.Empty<string>(), Array.Empty<string>(), "No notable recent news."));
var cobaltJob = Job(runId, criteriaId, "Data Engineer", "Cobalt Systems", "Tel Aviv",
    "Own batch and streaming data pipelines for analytics.", 56, "MAYBE", false, false, runAt,
    Analysis("Data Engineer", "Cobalt Systems", 56, "MAYBE", false, (11, 9), (9, 7), (7, 7, 6),
        new[] { "Transferable backend skills" }, new[] { "Limited data-engineering depth", "On-call load hinted" },
        "Partial fit; the role leans more data-engineering than the candidate's core.",
        Array.Empty<string>(), new[] { "Some Glassdoor reviews mention long hours" },
        "Mixed signals on work-life balance."));

// Hand-authored, résumé-grounded reasoning for the two highest-scoring jobs
// (also tracked on the Active board) — a reviewer who opens the score
// breakdown should see it reference the résumé's actual content, not generic
// tier text, or the "AI scoring" story falls apart under a click.
var meridianJob = Job(runId, criteriaId, "Senior Backend Engineer", "Meridian Robotics", "Tel Aviv",
    "Build control-plane services for autonomous fleet software.", 91, "STRONG_YES", true, true, runAt,
    Analysis("Senior Backend Engineer", "Meridian Robotics", 91, "STRONG_YES", true, (18, 14), (14, 14), (12, 11, 10),
        new[] { "Led the checkout platform's move off a monolith into independently deployable services",
                "Direct experience owning distributed backend systems at scale (millions of orders/month)" },
        Array.Empty<string>(),
        "Excellent fit — the control-plane/distributed-systems work here is a close match for the checkout platform ownership on the résumé, and seniority lines up.",
        new[] { "Recently expanded its Tel Aviv engineering team" }, Array.Empty<string>(),
        "Growing headcount locally, consistent with an active hiring push."));
var solaceJob = Job(runId, criteriaId, "Staff Software Engineer", "Solace Fintech", "Remote",
    "Own payments infrastructure reliability and scale.", 88, "STRONG_YES", true, true, runAt,
    Analysis("Staff Software Engineer", "Solace Fintech", 88, "STRONG_YES", true, (17, 14), (15, 13), (11, 10, 8),
        new[] { "Directly reduced payment-failure retries by 40% on a high-volume checkout platform",
                "Strong reliability/observability track record (structured logging, dashboards, on-call runbooks)" },
        new[] { "Staff-level scope is a step up from the résumé's current title" },
        "Very strong fit — payments reliability is close to exactly what the résumé already shows hands-on impact in; the step to Staff is a stretch but a reasonable one.",
        Array.Empty<string>(), Array.Empty<string>(),
        "No notable recent news."));

// Broader pool — score/verdict/company/title varied for a realistic-looking
// spread; breakdown text is tier-derived (TieredAnalysis) rather than hand-authored
// per posting.
var morePostings = new (string Title, string Company, string Location, string Description, int Score, string Verdict)[]
{
    ("Backend Engineer", "Harborlight Logistics", "Herzliya", "Build tracking and routing services for a logistics platform.", 79, "YES"),
    ("Platform Engineer", "Kestrel Analytics", "Remote", "Internal developer platform and CI/CD.", 77, "YES"),
    ("DevOps Engineer", "Ridgeline Cloud", "Remote", "Infra automation for a cloud consultancy.", 72, "YES"),
    ("Full Stack Engineer", "Verdant Foods", "Tel Aviv", "Ship features across a React/Node e-commerce stack.", 68, "YES"),
    ("Site Reliability Engineer", "Anchorpoint Security", "Ramat Gan", "On-call, observability, and incident response for a security product.", 63, "MAYBE"),
    ("Software Engineer", "Bramble Media", "Remote", "Build content pipelines for a media platform.", 61, "MAYBE"),
    ("Backend Engineer", "Coppermine Insurance", "Tel Aviv", "Maintain claims-processing services.", 54, "MAYBE"),
    ("Data Platform Engineer", "Fernwood Analytics", "Remote", "Own batch/streaming data infra.", 49, "MAYBE"),
    ("Engineering Manager", "Cascade Systems", "Tel Aviv", "People-management-heavy leadership role.", 41, "NO"),
    ("Frontend Engineer", "Lucent Design", "Tel Aviv", "React component library and design systems.", 38, "NO"),
    ("Mobile Engineer", "Skyline Apps", "Ramat Gan", "iOS/Android app development.", 33, "NO"),
};

// Also tracked on the Active board (same title/company, see the seeds list
// above) — shown as "Added" on Matches instead of an "Add" button, the way a
// job you've already acted on looks in the real app.
var trackedCompanies = new HashSet<string>
{
    "Harborlight Logistics", "Kestrel Analytics",
    "Ridgeline Cloud", "Verdant Foods", "Anchorpoint Security", "Bramble Media", "Coppermine Insurance",
};

var jobs = new List<BsonDocument> { stratusJob, northwindJob, cobaltJob, meridianJob, solaceJob };
foreach (var (i, posting) in morePostings.Select((posting, i) => (i, posting)))
{
    var at = runAt.AddMinutes(-5 * i);
    jobs.Add(Job(runId, criteriaId, posting.Title, posting.Company, posting.Location, posting.Description, posting.Score, posting.Verdict,
        posting.Verdict is "STRONG_YES" or "YES", trackedCompanies.Contains(posting.Company), at,
        TieredAnalysis(posting.Title, posting.Company, posting.Score, posting.Verdict)));
}

await jobsCol.InsertManyAsync(jobs);
await runsCol.InsertOneAsync(new BsonDocument
{
    ["id"] = runId, ["criteria_id"] = criteriaId, ["criteria_name"] = demoCriteriaName,
    ["status"] = "completed", ["mode"] = "live",
    ["batch_id"] = BsonNull.Value, ["batch_submitted_at"] = BsonNull.Value,
    ["started_at"] = runAt, ["completed_at"] = runAt.AddMinutes(4),
    ["jobs_scraped"] = jobs.Count + 5, ["jobs_scored"] = jobs.Count, ["jobs_saved"] = 1, ["jobs_skipped_duplicate"] = 2,
    ["error"] = BsonNull.Value,
});
Console.WriteLine($"Discovery seeded/refreshed: 1 criterion, 1 completed run, {jobs.Count} jobs.");

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
        // Lets DemoJobFreshnessInitializer (API startup, DemoMode-gated) find and
        // re-bump these docs' discovered_at without touching any real scraped data.
        ["seed_marker"] = true,
    };

// Derives a plausible-looking breakdown from just (score, verdict) — used for the
// bulk posting pool where hand-authoring bespoke text per entry isn't worth it.
static BsonDocument TieredAnalysis(string title, string company, int score, string verdict)
{
    var shouldApply = verdict is "STRONG_YES" or "YES";
    var techTotal = (int)Math.Round(score * 0.35);
    var execTotal = (int)Math.Round(score * 0.30);
    var sustTotal = score - techTotal - execTotal;
    var techCore = (int)Math.Round(techTotal * 0.55);
    var execA = execTotal / 2;
    var sustWl = sustTotal / 3;
    var sustComm = sustTotal / 3;

    var (green, red, honest) = score switch
    {
        >= 80 => (new[] { "Strong stack overlap", "Seniority matches the role" }, Array.Empty<string>(),
            "Strong overall fit; stack and seniority line up well with the role."),
        >= 65 => (new[] { "Good stack overlap" }, new[] { "Some ramp-up expected in one area" },
            "Solid fit with a mild ramp in one area."),
        >= 50 => (new[] { "Transferable core skills" }, new[] { "Domain gap on part of the stack" },
            "Partial fit; some real gaps against the role's core stack."),
        _ => (Array.Empty<string>(), new[] { "Limited overlap with the role's core stack" },
            "Weak fit; the role's requirements diverge meaningfully from the candidate's background."),
    };

    return Analysis(title, company, score, verdict, shouldApply,
        (techCore, techTotal - techCore), (execA, execTotal - execA), (sustWl, sustComm, sustTotal - sustWl - sustComm),
        green, red, honest, Array.Empty<string>(), Array.Empty<string>(), "No notable recent news.");
}
