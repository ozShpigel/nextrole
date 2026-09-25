namespace ApplicationTracker.Core.Profile;

/// <summary>
/// The short first read of an uploaded résumé: only what retrieval needs.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why it exists.</b> The full read returns every achievement of every role
/// word for word -- thousands of output tokens, and output is where the wait
/// after an upload goes. Retrieval needs a fraction of that: where, how senior,
/// what kind of work, which skills, which titles. So an upload runs this short
/// read and the full one in parallel; the board fills from this one, and
/// scoring waits for the full one, because the Evaluator and ClaimGrounding
/// check claims against the whole profile.
/// </para>
/// <para>
/// <see cref="Keep"/> is the code check behind the prompt's ESSENTIALS MODE
/// addendum (AGENTS.md: a prompt rule with no check is not a rule). Whatever
/// the model returned outside the essentials is cleared, so the client can
/// trust that an empty field here means "not part of this read".
/// </para>
/// </remarks>
public static class NormalizedProfileEssentials
{
    public static NormalizedProfile Keep(NormalizedProfile read) => read with
    {
        FullName = null,
        Email = null,
        Phone = null,
        LinkedIn = null,
        Experience = [.. read.Experience.Select(e => e with { Highlights = [] })],
        Education = [],
        MilitaryService = [],
        SideProjects = [],
        SpokenLanguages = [],
    };
}
