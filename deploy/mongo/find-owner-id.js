// Read-only: the owner's production userId, for Features:AllowedUsers
// (docs/plans/feature-gating.md).
// Run on the box, in /srv/nextrole:  sh mongosh.sh find-owner-id.js .env.api
// Writes nothing.
//
// The owner's account is the one the one-shot claim created (docs/auth.md):
// its googleIdentity link carries ViaClaim: true, and a second claim is
// impossible, so there is exactly one. No email needed to find it.

const name = process.env.MongoDB__Database || "job-tracker";
const identities = db.getSiblingDB(name).googleIdentity;

const claimed = identities.find({ ViaClaim: true }, { _id: 1, LinkedAt: 1 }).toArray();
print(`${name}: ${identities.countDocuments({})} Google-linked account(s), ${claimed.length} from the claim`);
claimed.forEach(c => print(`  owner userId: ${c._id}   (linked ${c.LinkedAt && c.LinkedAt.toISOString()})`));
if (claimed.length !== 1) print("  Expected exactly one -- do not use this output; look at docs/auth.md.");
