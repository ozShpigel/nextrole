using System.Net;
using System.Text;
using Mailbot.Models;
using Mailbot.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace MailbotTests;

/// <summary>
/// "This email is not job-related" and "the API could not be asked" must not be
/// the same answer.
/// </summary>
/// <remarks>
/// HttpEmailParser returned null for a 204, for any non-success status, and for
/// any exception. ProcessEmailsAsync treats null as "skip", so a parse endpoint
/// failing for days produced runs reporting Success with no errors —
/// indistinguishable from a quiet week. Nothing else caught it: a failed email
/// is never persisted, so it never enters the known-ids skip list and is
/// re-fetched next run, which works right up until it ages out of the
/// Gmail:LookbackDays window. After that a real interview invitation is gone
/// and nothing says so.
///
/// These are the mailbot's first automated tests.
/// </remarks>
public class HttpEmailParserTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _respond;
        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) => _respond = respond;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(_respond(request));
    }

    private static HttpEmailParser ParserFor(Func<HttpRequestMessage, HttpResponseMessage> respond)
    {
        var http = new HttpClient(new StubHandler(respond))
        {
            BaseAddress = new Uri("http://tracker.test"),
        };
        return new HttpEmailParser(http, NullLogger<HttpEmailParser>.Instance);
    }

    private static HttpEmailParser ThrowingParser(Exception ex)
    {
        var http = new HttpClient(new StubHandler(_ => throw ex))
        {
            BaseAddress = new Uri("http://tracker.test"),
        };
        return new HttpEmailParser(http, NullLogger<HttpEmailParser>.Instance);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static readonly EmailMessage Email = new()
    {
        GmailMessageId = "gmail-1",
        Subject = "Interview invitation",
        From = "recruiter@acme.test",
        Body = "We would like to schedule a call.",
        ReceivedAt = new DateTime(2026, 9, 14, 9, 0, 0, DateTimeKind.Utc),
    };

    private static readonly List<string> Companies = new() { "Acme" };

    [Fact]
    public async Task A_204_means_not_job_related_and_returns_null()
    {
        var parser = ParserFor(_ => new HttpResponseMessage(HttpStatusCode.NoContent));

        Assert.Null(await parser.ParseEmailAsync(Email, Companies));
    }

    [Fact]
    public async Task A_parsed_email_comes_back_as_an_update()
    {
        var parser = ParserFor(_ => Json(HttpStatusCode.OK,
            """{"company":"Acme","jobTitle":"Backend Engineer","updateType":"InterviewScheduled"}"""));

        var update = await parser.ParseEmailAsync(Email, Companies);

        Assert.NotNull(update);
        Assert.Equal("Acme", update!.Company);
        Assert.Equal("InterviewScheduled", update.UpdateType);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.BadGateway)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Unauthorized)]
    public async Task A_failing_status_throws_rather_than_reading_as_not_relevant(HttpStatusCode status)
    {
        // The whole point. Returning null here is what made a broken endpoint
        // look like a quiet mailbox.
        var parser = ParserFor(_ => new HttpResponseMessage(status));

        var ex = await Assert.ThrowsAsync<EmailParseException>(
            () => parser.ParseEmailAsync(Email, Companies));
        Assert.Contains(((int)status).ToString(), ex.Message);
        Assert.Contains(Email.Subject, ex.Message);
    }

    [Fact]
    public async Task An_unreachable_api_throws()
    {
        var parser = ThrowingParser(new HttpRequestException("connection refused"));

        var ex = await Assert.ThrowsAsync<EmailParseException>(
            () => parser.ParseEmailAsync(Email, Companies));
        Assert.IsType<HttpRequestException>(ex.InnerException);
    }

    [Fact]
    public async Task A_success_status_with_no_body_throws()
    {
        // "Not relevant" is 204 by contract (EmailParseEndpoints returns
        // NoContent for it), so an empty 200 is a fault, not an answer.
        var parser = ParserFor(_ => Json(HttpStatusCode.OK, "null"));

        await Assert.ThrowsAsync<EmailParseException>(
            () => parser.ParseEmailAsync(Email, Companies));
    }

    [Fact]
    public async Task A_success_status_with_an_unreadable_body_throws()
    {
        var parser = ParserFor(_ => Json(HttpStatusCode.OK, "{not json"));

        await Assert.ThrowsAsync<EmailParseException>(
            () => parser.ParseEmailAsync(Email, Companies));
    }

    [Fact]
    public async Task Cancellation_is_not_reported_as_a_parse_failure()
    {
        // A cancelled run must not be recorded as an error against this email.
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var parser = ThrowingParser(new OperationCanceledException());

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => parser.ParseEmailAsync(Email, Companies, null, cts.Token));
    }

    [Fact]
    public async Task The_reference_date_override_is_what_gets_sent()
    {
        // One fixed reference date per run is what makes the system prompt
        // byte-identical across emails so the prompt cache actually reuses.
        string? sent = null;
        var parser = ParserFor(req =>
        {
            sent = req.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(HttpStatusCode.NoContent);
        });
        var reference = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);

        await parser.ParseEmailAsync(Email, Companies, reference);

        Assert.NotNull(sent);
        Assert.Contains("2026-01-02", sent!);
    }
}
