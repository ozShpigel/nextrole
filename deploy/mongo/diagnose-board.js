// Read-only: why a board's postings do or do not reach a profile's Matches.
// Run on the box, in /srv/nextrole:  sh mongosh.sh diagnose-board.js
// Writes nothing. Edit the four values below for another board or profile.
//
// It mirrors the band (PoolBrowseService.BandAsync -> FindCandidatesAsync):
// the 400 postings nearest the profile by vector, then location, seniority and
// kind of work, then the top 40. The vector rank needs the profile's embedding
// and is not computed here -- so "passes the filters" means "is eligible", and
// the pool-wide count below is how many eligible postings compete for 40 slots.

const BOARD = "workday:kla";
const COUNTRY = "Israel";                       // the profile's location term (its last comma part)
const ACCEPTED = ["software_engineering", "infrastructure",   // the profile's own kinds of work...
  "data_engineering", "qa", "security"];                       // ...and their neighbours (JobFunctions.AcceptedFor)
const MAX_AGE_DAYS = 90;                        // "Any"

const name = process.env.MongoDB__Database || "job-tracker";
const jobs = db.getSiblingDB(name).greenhouse_jobs;
const since = new Date(Date.now() - MAX_AGE_DAYS * 86400000);

const fnsOf = j => (j.extracted && Array.isArray(j.extracted.functions)) ? j.extracted.functions : [];
const locOf = j => (j.extracted && j.extracted.location) || j.location || "";
const postedOf = j => j.firstPublishedAt || j.boardUpdatedAt || null;
const passFn = j => fnsOf(j).length === 0 || fnsOf(j).some(f => ACCEPTED.includes(f));   // unread passes
const passLoc = j => !locOf(j) || locOf(j).toLowerCase().includes(COUNTRY.toLowerCase());  // unstated passes
const passAge = j => !postedOf(j) || postedOf(j) >= since;                                 // undated passes

const rows = jobs.find({ boardKey: BOARD, closedAt: null }).toArray();
print(`${BOARD}: ${rows.length} open posting(s) in ${name}`);
if (rows.length === 0) quit();

const pending = rows.filter(j => j.ai_pending_facts).length;
const unread = rows.filter(j => !(j.extracted && j.extracted.functions)).length;
print(`  facts still pending: ${pending}, never read: ${unread}`);

const tally = {};
rows.forEach(j => fnsOf(j).forEach(f => tally[f] = (tally[f] || 0) + 1));
print(`  kinds of work: ${JSON.stringify(tally)}`);

const eligible = rows.filter(j => passFn(j) && passLoc(j) && passAge(j));
print(`  pass kind of work: ${rows.filter(passFn).length}, location: ${rows.filter(passLoc).length}, ` +
      `age <= ${MAX_AGE_DAYS}d: ${rows.filter(passAge).length} -> all three: ${eligible.length}`);
print("");
print("  eligible (seniority shown -- the band keeps the profile's own band and one either side):");
eligible
  .sort((a, b) => (postedOf(b) || 0) - (postedOf(a) || 0))
  .forEach(j => print(`    ${(postedOf(j) || new Date(0)).toISOString().slice(0, 10)}  ` +
    `${(j.extracted && j.extracted.seniority) || "-"}  | ${fnsOf(j).join("+") || "-"} | ${j.title}`));

// The competition: every open posting, any board, that passes the same three filters.
const all = jobs.find({ closedAt: null }, { extracted: 1, location: 1, firstPublishedAt: 1, boardUpdatedAt: 1, boardKey: 1 }).toArray();
const competing = all.filter(j => passFn(j) && passLoc(j) && passAge(j));
const byBoard = {};
competing.forEach(j => byBoard[j.boardKey] = (byBoard[j.boardKey] || 0) + 1);
print("");
print(`pool-wide: ${competing.length} of ${all.length} open posting(s) pass the same filters, competing for 40 band slots`);
print(`  by board: ${JSON.stringify(Object.entries(byBoard).sort((a, b) => b[1] - a[1]))}`);
