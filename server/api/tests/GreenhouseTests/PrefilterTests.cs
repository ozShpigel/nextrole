using System.Net;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Greenhouse;
using Microsoft.Extensions.Logging;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The pre-read filter's rules. Every case that reads is as deliberate as every
/// case that skips: a wrong skip loses a job with no symptom, a wrong read costs
/// one read.
/// </summary>
public class PrefilterTests
{
    // ---- the function guess --------------------------------------------------

    [Theory]
    [InlineData("Account Executive, Enterprise", JobFunctions.Sales)]
    [InlineData("Business Development Representative", JobFunctions.Sales)]
    [InlineData("Recruiter", JobFunctions.Operations)]
    [InlineData("Senior Legal Counsel", JobFunctions.Operations)]
    [InlineData("Revenue Accountant", JobFunctions.Operations)]
    [InlineData("Customer Success Manager", JobFunctions.CustomerSuccess)]
    [InlineData("Senior Marketing Manager", JobFunctions.Marketing)]
    [InlineData("Product Designer", JobFunctions.Design)]
    [InlineData("Brand Designer", JobFunctions.Design)]
    [InlineData("Senior Product Manager", JobFunctions.Product)]
    [InlineData("Group Product Manager, Regulatory Finance", JobFunctions.Product)]
    [InlineData("FP&A Manager", JobFunctions.Operations)]
    public void A_clearly_non_technical_title_is_guessed(string title, string expected) =>
        Assert.Equal(expected, Prefilter.GuessFunction(title, ["Engineering"]));

    [Theory]
    // A technical word anywhere means "read it" -- whatever else the title says.
    [InlineData("Technical Recruiter")]
    [InlineData("Sales Engineer")]
    [InlineData("Marketing Analyst")]
    [InlineData("Finance Data Engineer")]
    [InlineData("Security Counsel")]
    [InlineData("Platform Engineer")]
    [InlineData("Senior Software Engineer, Payments")]
    // Claude's label is split on these, so no guess (measured on the box):
    // financial crime was labelled security, product marketing was product.
    [InlineData("Senior Financial Crime Investigator  - EU, Spanish & English")]
    [InlineData("Product Marketing Lead")]
    [InlineData("Senior Product Marketing Manager, Business Banking")]
    [InlineData("Fraud Operations Manager")]
    [InlineData("Head of Risk")]
    [InlineData("Compliance Officer")]
    [InlineData("Trust & Safety Specialist")]
    // Nothing clear either way.
    [InlineData("Manager, EMEA")]
    [InlineData("")]
    public void Anything_unclear_is_not_guessed(string title) =>
        Assert.Null(Prefilter.GuessFunction(title, []));

    [Fact]
    public void The_department_decides_only_when_the_title_says_nothing()
    {
        Assert.Equal(JobFunctions.Operations, Prefilter.GuessFunction("Manager, EMEA", ["People"]));
        Assert.Equal(JobFunctions.Sales, Prefilter.GuessFunction("Lead, EMEA", ["Go To Market"]));
        // A technical title is read whatever team it sits in.
        Assert.Null(Prefilter.GuessFunction("Backend Engineer", ["Sales"]));
    }

    [Fact]
    public void A_technical_or_conflicting_department_is_not_a_guess()
    {
        Assert.Null(Prefilter.GuessFunction("Manager, EMEA", ["Data & Engineering"]));
        Assert.Null(Prefilter.GuessFunction("Manager, EMEA", ["Sales", "Legal"]));
        Assert.Null(Prefilter.GuessFunction("Manager, EMEA", ["Risk & Compliance"]));
    }

    // ---- served locations ----------------------------------------------------

    [Fact]
    public void Locations_match_whole_words_only()
    {
        // The case this exists for: "UK" inside "Ukraine".
        Assert.False(Prefilter.InServedLocation(["Kyiv, Ukraine"], ["UK"]));
        Assert.True(Prefilter.InServedLocation(["London, UK"], ["UK"]));
        Assert.True(Prefilter.InServedLocation(["tel aviv"], ["Tel Aviv"]));
    }

    [Fact]
    public void No_location_text_or_no_served_list_is_a_pass()
    {
        Assert.True(Prefilter.InServedLocation([null, " "], ["Israel"]));
        Assert.True(Prefilter.InServedLocation(["Tokyo, Japan"], []));
    }

    [Fact]
    public void Any_office_can_place_a_posting()
    {
        // The board location is often a label ("Hybrid"); the office is the place.
        Assert.True(Prefilter.InServedLocation(["Hybrid", "Tel Aviv"], ["Tel Aviv"]));
    }

    // ---- the decision --------------------------------------------------------

    private static BoardJob Job(string title, string location, params string[] departments) => new()
    {
        Id = 1,
        Title = title,
        Location = new BoardLocation { Name = location },
        Departments = [.. departments.Select(d => new BoardTaxonomy { Name = d })],
    };

    private static readonly string[] Served = ["Israel", "Tel Aviv", "London"];

    [Fact]
    public void Outside_every_served_location_is_skipped_whatever_the_role()
    {
        var skip = Prefilter.Decide(Job("Platform Engineer", "Tokyo, Japan"), Served, null);
        Assert.Equal(PrefilterSkip.Location, skip?.Reason);
    }

    [Fact]
    public void With_no_recorded_demand_nothing_is_skipped_by_function()
    {
        Assert.Null(Prefilter.Decide(Job("Recruiter", "Tel Aviv"), Served, null));
    }

    [Fact]
    public void A_function_nobody_wants_is_skipped()
    {
        var accepted = Prefilter.Accepted([JobFunctions.Infrastructure]);

        var skip = Prefilter.Decide(Job("Recruiter", "Tel Aviv"), Served, accepted);

        Assert.Equal(PrefilterSkip.Function, skip?.Reason);
        Assert.Equal(JobFunctions.Operations, skip?.Detail);
    }

    [Fact]
    public void A_neighbour_of_a_wanted_function_is_read()
    {
        // A customer-success user also accepts sales (JobFunctions' neighbours),
        // so the filter must not skip what Matches would show them.
        var accepted = Prefilter.Accepted([JobFunctions.CustomerSuccess]);

        Assert.Null(Prefilter.Decide(Job("Account Executive", "London"), Served, accepted));
    }
}

/// <summary>The filter inside the unit of work.</summary>
public class PrefilterHandlerTests
{
    private static readonly string Content = "&lt;p&gt;" + new string('a', 400) + "&lt;/p&gt;";

    private sealed class Demand(params string[] wanted) : IFunctionDemand
    {
        public Task<IReadOnlyList<string>> WantedAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<string>>(wanted);
    }

    private sealed class ListLogger : ILogger<CompanyHandler>
    {
        public List<string> Lines { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => Lines.Add(formatter(state, exception));
    }

    private static CompaniesConfig Config() =>
        CompaniesConfig.ForTesting(Build.Token) with { ServedLocations = ["Tel Aviv"] };

    // Every job on Build.BoardJson is in Tel Aviv, in "Engineering".
    private static string Board(params (long Id, string Title)[] jobs) =>
        Build.BoardJson([.. jobs.Select(j => (j.Id, j.Title, Content))]);

    private static StubHandler Serve(string json) => new StubHandler().EnqueueJson(HttpStatusCode.OK, json);

    [Fact]
    public async Task On_a_new_posting_nobody_wants_is_neither_embedded_nor_stored()
    {
        var store = new FakeJobStore();
        var embeddings = new FakeEmbeddingClient();

        var result = await Build.Handler(Serve(Board((1, "Platform Engineer"), (2, "Recruiter"))),
                embeddings, store, Config(), prefilter: PrefilterMode.On,
                demand: new Demand(JobFunctions.Infrastructure))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, result.Prefiltered);
        Assert.Equal(1, result.Embedded);
        Assert.Equal([1L], store.Hashes.Keys);
        Assert.DoesNotContain(2L, store.Touched);
    }

    [Fact]
    public async Task Log_mode_skips_nothing()
    {
        var store = new FakeJobStore();

        var result = await Build.Handler(Serve(Board((1, "Platform Engineer"), (2, "Recruiter"))),
                new FakeEmbeddingClient(), store, Config(), prefilter: PrefilterMode.Log,
                demand: new Demand(JobFunctions.Infrastructure))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(0, result.Prefiltered);
        Assert.Equal(2, result.Embedded);
    }

    [Fact]
    public async Task A_stored_posting_is_never_prefiltered()
    {
        // Already paid for. Dropping it from the run would skip its presence
        // touch and hand it to the close diff.
        var store = new FakeJobStore();
        await Build.Handler(Serve(Board((2, "Recruiter"))), new FakeEmbeddingClient(), store, Config())
            .HandleCompanyAsync(Build.Token);

        var result = await Build.Handler(Serve(Board((2, "Recruiter"))),
                new FakeEmbeddingClient(), store, Config(), prefilter: PrefilterMode.On,
                demand: new Demand(JobFunctions.Infrastructure))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(0, result.Prefiltered);
        Assert.Contains(2L, store.Touched);
    }

    [Fact]
    public async Task A_skipped_posting_is_read_once_someone_wants_it()
    {
        // Not stored, so the next run sees it as new -- no backfill needed.
        var store = new FakeJobStore();
        var json = Board((2, "Recruiter"));

        await Build.Handler(Serve(json), new FakeEmbeddingClient(), store, Config(),
                prefilter: PrefilterMode.On, demand: new Demand(JobFunctions.Infrastructure))
            .HandleCompanyAsync(Build.Token);
        Assert.Empty(store.Hashes);

        var result = await Build.Handler(Serve(json), new FakeEmbeddingClient(), store, Config(),
                prefilter: PrefilterMode.On, demand: new Demand(JobFunctions.Infrastructure, JobFunctions.Operations))
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(1, result.Embedded);
        Assert.Equal([2L], store.Hashes.Keys);
    }

    [Fact]
    public async Task With_no_recorded_demand_every_role_is_read()
    {
        var result = await Build.Handler(Serve(Board((2, "Recruiter"))), new FakeEmbeddingClient(),
                new FakeJobStore(), Config(), prefilter: PrefilterMode.On, demand: new Demand())
            .HandleCompanyAsync(Build.Token);

        Assert.Equal(0, result.Prefiltered);
        Assert.Equal(1, result.Embedded);
    }

    [Fact]
    public async Task The_check_reports_a_guess_that_would_hide_a_wanted_posting()
    {
        // Stored "Recruiter" that Claude labelled infrastructure (say, an infra
        // hiring role): the title guess says operations, an infra user wants it.
        var store = new FakeJobStore();
        await Build.Handler(Serve(Board((2, "Recruiter"))), new FakeEmbeddingClient(), store, Config())
            .HandleCompanyAsync(Build.Token);
        store.Functions[2] = [JobFunctions.Infrastructure];

        var log = new ListLogger();
        await Build.Handler(Serve(Board((2, "Recruiter"))), new FakeEmbeddingClient(), store, Config(),
                prefilter: PrefilterMode.Log, demand: new Demand(JobFunctions.Infrastructure), log: log)
            .HandleCompanyAsync(Build.Token);

        var check = Assert.Single(log.Lines, l => l.Contains("pre-read filter check"));
        Assert.Contains("0 right, 1 wrong, 1 wrong in a way that would hide a wanted posting", check);
        Assert.Contains("Recruiter [guessed operations, labelled infrastructure]", check);
    }
}
