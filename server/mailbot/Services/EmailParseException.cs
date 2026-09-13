namespace Mailbot.Services;

/// <summary>
/// The parse API could not answer for this email — a non-success status, an
/// unreadable body, or a transport failure.
/// </summary>
/// <remarks>
/// This type exists so that "the API said this email is not job-related" and
/// "the API could not be asked" stop being the same value. HttpEmailParser used
/// to return null for both, plus for any exception, and ProcessEmailsAsync
/// treats null as "skip, nothing to do". A parse endpoint returning 500 for
/// several days therefore produced runs that logged Success: true with an empty
/// Errors list, indistinguishable from a quiet week with no mail.
///
/// That mattered because nothing else caught it. A failed email is never
/// persisted, so it never enters the known-ids skip list and is re-fetched on
/// the next run -- which is the recovery path, and it works, right up until the
/// email ages out of the Gmail:LookbackDays window. After that a real interview
/// invitation or rejection is simply gone, with nothing anywhere saying so.
/// </remarks>
public sealed class EmailParseException : Exception
{
    public EmailParseException(string message) : base(message) { }

    public EmailParseException(string message, Exception innerException)
        : base(message, innerException) { }
}
