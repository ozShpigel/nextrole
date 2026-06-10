namespace ApplicationTracker.Core.AI;

// Thrown when Claude fails to return JSON that can be parsed/deserialized after
// the retry. Carries the raw model output and the serialized request input so a
// dry-run test can surface exactly what came back; the live /api/match path
// still treats it as a 500.
public sealed class ClaudeJsonException : Exception
{
    public string RawOutput { get; }
    public string Input { get; }

    public ClaudeJsonException(string message, string rawOutput, string input)
        : base(message)
    {
        RawOutput = rawOutput;
        Input = input;
    }
}
