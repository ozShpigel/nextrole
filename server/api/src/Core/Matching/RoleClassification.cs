namespace ApplicationTracker.Core.Matching;

// Which role in the shared pool's daily search this candidate's work belongs
// under. One cheap call per profile save, never per scan.
//
// The point is canonicalisation, not description: raw titles fragment
// ("Senior Backend Engineer", "Backend Developer", "Sr. Backend Dev" are one
// search), and a fragmented list makes the role cap meaningless — it would fill
// up with synonyms. The model is therefore asked to reuse an existing role
// whenever one genuinely fits, and to invent one only when none does.
public sealed record RoleClassificationRequest
{
    // The roles the daily run already searches. The model prefers these.
    public List<string> ExistingRoles { get; init; } = [];
    // Recent job titles from the candidate's own profile, newest first.
    public List<string> Titles { get; init; } = [];
    public string? Summary { get; init; }
    public List<string> Skills { get; init; } = [];
}

public sealed record RoleClassificationResponse
{
    // The canonical role this candidate searches under, or null when the
    // profile says too little to place them. Null is a real answer: it leaves
    // the role list alone rather than adding a guess to a capped resource.
    public string? Role { get; init; }
    // True when Role is one of ExistingRoles — the common case, and the one
    // that costs the pool nothing.
    public bool Existing { get; init; }
}
