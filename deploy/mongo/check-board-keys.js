// Read-only checks for docs/plans/board-config.md (phase 3), after a publish.
// Run on the box, in /srv/nextrole:  sh mongosh.sh check-board-keys.js
// Writes nothing.

const name = process.env.MongoDB__Database || "job-tracker";
const d = db.getSiblingDB(name);
const runs = d.greenhouse_runs;
const today = new Date().toISOString().slice(0, 10);

const check = (ok, what) => print(`${ok ? "PASS" : "FAIL"}  ${what}`);

const rows = runs.find({ day: today }).toArray();
const byStatus = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
print(`database ${name}, run ledger for ${today}: ${rows.length} row(s) -- ${JSON.stringify(byStatus)}`);

check(runs.countDocuments({ boardKey: { $exists: false } }) === 0, "every ledger row, any day, has a boardKey");
check(rows.every(r => typeof r.boardKey === "string" && r.boardKey.includes(":")), "today's rows are keyed source:token");
check(new Set(rows.map(r => r.boardKey)).size === rows.length, "one row per board today");
check((byStatus.pending || 0) === 0, "nothing pending today (run the check again if a run is still in progress)");
const idx = runs.getIndexes().find(i => i.name === "uniq_day_boardkey");
check(!!idx && idx.unique === true && !!idx.partialFilterExpression, "uniq_day_boardkey exists, unique and partial");

const failed = rows.filter(r => r.status === "failed");
if (failed.length) print(`failed today: ${failed.map(r => `${r.boardKey} (${r.error})`).join("; ")}`);

const open = d.greenhouse_jobs.aggregate([
  { $match: { closedAt: null } },
  { $group: { _id: "$boardKey", n: { $sum: 1 } } },
]).toArray();
print(`open postings on ${open.length} board(s); none closed as removed unless boards.json dropped one`);
