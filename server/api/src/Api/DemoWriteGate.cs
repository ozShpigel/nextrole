using System.Text.Json;
using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Api;

/// <summary>
/// The read-only demo's write gate: the parts of the decision that are pure
/// logic over one request, extracted so they can be tested without a host or a
/// database.
/// </summary>
/// <remarks>
/// This lives outside Program.cs because the bug it exists to prevent was a
/// parsing mistake, not a middleware mistake. The Withdrawn exception used to
/// be a substring search over the entire request body:
/// <code>body.Contains("\"Withdrawn\"")</code>. StatusUpdateRequest.Note is
/// free text, so <c>{"newStatus":"OfferReceived","note":"Withdrawn"}</c>
/// satisfied it and a demo visitor could drive ANY transition — including the
/// ones that land in InterviewingStatuses and fire EnrichOnInterviewingAsync's
/// three fire-and-forget Claude calls, which run in-process and are therefore
/// seen by no rate limiter.
///
/// Middleware that reads a raw body is awkward to test; a string-to-bool
/// function is not. DemoWriteGateTests covers it, including the exact payload
/// that used to get through.
/// </remarks>
public static class DemoWriteGate
{
    /// <summary>
    /// Is this <c>PUT /api/applications/{id}/status</c> body a transition to
    /// Withdrawn — the one status change the demo allows, backing the Active
    /// board's "Remove"?
    /// </summary>
    /// <remarks>
    /// Fails closed, and is deliberately stricter than the model binder.
    /// Malformed JSON, a non-object root, a missing or non-string
    /// <c>newStatus</c>, the numeric enum form (<c>{"newStatus":9}</c>) and an
    /// unexpected property casing all return false, even though the binder
    /// would accept several of them. Refusing what cannot be positively read as
    /// Withdrawn is the safe direction: a false negative costs a demo visitor
    /// one blocked click, a false positive hands them the whole endpoint.
    /// </remarks>
    public static bool IsWithdrawnTransition(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return false;

        try
        {
            using var parsed = JsonDocument.Parse(body);
            return parsed.RootElement.ValueKind == JsonValueKind.Object
                && parsed.RootElement.TryGetProperty("newStatus", out var newStatus)
                && newStatus.ValueKind == JsonValueKind.String
                && string.Equals(
                    newStatus.GetString(),
                    nameof(ApplicationStatus.Withdrawn),
                    StringComparison.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
