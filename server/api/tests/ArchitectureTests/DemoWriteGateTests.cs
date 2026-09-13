using ApplicationTracker.Api;

namespace ArchitectureTests;

/// <summary>
/// The read-only demo allows exactly one status transition — Withdrawn, backing
/// the Active board's "Remove". Everything else must 403.
/// </summary>
/// <remarks>
/// This suite exists because that exception shipped as a substring search over
/// the whole request body, and StatusUpdateRequest.Note is free text. The first
/// test below is the payload that got through: it drove any transition the
/// caller liked, and the ones in InterviewingStatuses fire
/// EnrichOnInterviewingAsync's three fire-and-forget Claude calls, which run
/// in-process and so are seen by no rate limiter — a read-only-demo bypass and
/// an unmetered spend vector on a shared key.
/// </remarks>
public class DemoWriteGateTests
{
    [Fact]
    public void A_note_mentioning_Withdrawn_does_not_authorise_a_different_transition()
    {
        // The exact exploit. Guard this one above all the others.
        Assert.False(DemoWriteGate.IsWithdrawnTransition(
            """{"newStatus":"OfferReceived","note":"Withdrawn"}"""));
    }

    [Theory]
    [InlineData("Applied")]
    [InlineData("PhoneScreen")]
    [InlineData("TechnicalInterview")]
    [InlineData("FinalRound")]
    [InlineData("OfferReceived")]
    [InlineData("Accepted")]
    [InlineData("Rejected")]
    public void No_other_status_is_allowed_however_the_note_is_worded(string status)
    {
        Assert.False(DemoWriteGate.IsWithdrawnTransition(
            $$"""{"newStatus":"{{status}}","note":"Withdrawn from the process"}"""));
    }

    [Fact]
    public void A_real_withdrawal_is_allowed()
    {
        Assert.True(DemoWriteGate.IsWithdrawnTransition("""{"newStatus":"Withdrawn"}"""));
    }

    [Fact]
    public void A_real_withdrawal_with_a_note_is_allowed()
    {
        Assert.True(DemoWriteGate.IsWithdrawnTransition(
            """{"newStatus":"Withdrawn","note":"Removed from the board"}"""));
    }

    [Theory]
    [InlineData("withdrawn")]
    [InlineData("WITHDRAWN")]
    [InlineData("WithDrawn")]
    public void The_status_value_is_matched_case_insensitively(string spelling)
    {
        // Mirrors the model binder, which is case-insensitive on enum values.
        Assert.True(DemoWriteGate.IsWithdrawnTransition($$"""{"newStatus":"{{spelling}}"}"""));
    }

    [Fact]
    public void Field_order_does_not_matter()
    {
        Assert.True(DemoWriteGate.IsWithdrawnTransition(
            """{"note":"OfferReceived","newStatus":"Withdrawn"}"""));
        Assert.False(DemoWriteGate.IsWithdrawnTransition(
            """{"note":"Withdrawn","newStatus":"Accepted"}"""));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("not json at all")]
    [InlineData("{\"newStatus\":\"Withdrawn\"")]   // truncated
    [InlineData("{}")]
    [InlineData("""{"note":"Withdrawn"}""")]       // no newStatus at all
    [InlineData("\"Withdrawn\"")]                  // bare JSON string, not an object
    [InlineData("""["Withdrawn"]""")]              // array root
    [InlineData("""{"newStatus":null}""")]
    public void Anything_not_positively_readable_as_Withdrawn_is_refused(string? body)
    {
        Assert.False(DemoWriteGate.IsWithdrawnTransition(body));
    }

    [Fact]
    public void The_numeric_enum_form_is_refused_even_though_the_binder_accepts_it()
    {
        // Withdrawn is ordinal 9 and JsonStringEnumConverter would bind this.
        // Deliberately stricter than the binder: the client sends strings, and
        // failing closed costs one blocked click, not the endpoint.
        Assert.False(DemoWriteGate.IsWithdrawnTransition("""{"newStatus":9}"""));
    }

    [Fact]
    public void An_unexpected_property_casing_is_refused()
    {
        // Same reasoning: the binder is case-insensitive on property names, this
        // is not. Documented here so the asymmetry is a decision, not a surprise.
        Assert.False(DemoWriteGate.IsWithdrawnTransition("""{"NewStatus":"Withdrawn"}"""));
    }

    [Fact]
    public void The_middleware_does_not_decide_this_with_a_substring_search()
    {
        // A rule with no code check behind it is not a rule (AGENTS.md). The
        // fix above is only durable if nobody reintroduces the shape it
        // replaced, so scan the real source rather than trusting the comment.
        var program = File.ReadAllText(
            Path.Combine(RepoSources.Root, "server", "api", "src", "Api", "Program.cs"));

        Assert.DoesNotContain("body.Contains(", program, StringComparison.Ordinal);
        Assert.Contains("DemoWriteGate.IsWithdrawnTransition(body)", program, StringComparison.Ordinal);
    }
}
