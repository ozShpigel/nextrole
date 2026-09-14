using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// Links a NextRole user to the Google account allowed to sign in as them.
// One per user, so the user's id IS the document id — same shape as
// ResumeFile and InterviewInsight (docs/auth.md).
//
// Deliberately NOT IUserOwned. Like profile/resumeFile the id is the scope,
// which is why RawCollectionAccessTests exempts documents of this shape.
// Unlike those, this collection has exactly ONE legitimate unscoped query —
// FindByGoogleSubAsync — because identity resolution necessarily happens
// *before* we know who the user is. That query is the entire reason the
// document exists and is confined to GoogleIdentityRepository.
public sealed record GoogleIdentity
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; init; }

    // Google's stable subject identifier. Accounts are matched on this and
    // never on the email: a Google email can be changed by its owner and, on
    // Workspace domains, reassigned to a different person entirely. `sub` is
    // immutable and unique forever. Carries a unique index, so two users can
    // never link the same Google account.
    public string GoogleSub { get; init; } = "";

    // Shown back to the user ("signed in as …") and nothing else. Never used
    // to find or match an account.
    public string Email { get; init; } = "";

    public DateTime LinkedAt { get; init; } = DateTime.UtcNow;

    // True when this link was created by the one-shot ClaimUserId migration
    // rather than an ordinary first sign-in. Audit trail only — nothing
    // branches on it. Its presence is what makes a second claim impossible,
    // but that check is on the document existing, not on this flag.
    public bool ViaClaim { get; init; }
}
