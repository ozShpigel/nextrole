// Read-only checks for docs/plans/key-migration.md, release 2a.
// Run on the box, in /srv/nextrole:
//   docker run --rm --env-file .env.greenhouse -v "$PWD/check-key-backfill.js:/c.js:ro" mongo:7 \
//     sh -c 'mongosh --quiet "$MongoDB__ConnectionString" /c.js'
// Writes nothing.

const name = process.env.MongoDB__Database || "job-tracker";
const jobs = db.getSiblingDB(name).greenhouse_jobs;

const total = jobs.countDocuments({});
const noKey = jobs.countDocuments({ boardKey: { $exists: false } });
const badId = jobs.countDocuments({ sourceJobId: { $not: /^[0-9]+$/ } });
const distinct = (jobs.aggregate([
  { $group: { _id: { k: "$boardKey", j: "$sourceJobId" } } },
  { $count: "n" },
]).toArray()[0] || { n: 0 }).n;
const index = jobs.getIndexes().find(i => i.name === "uniq_boardkey_job");
const oldIndex = jobs.getIndexes().find(i => i.name === "uniq_board_job");
const idLengths = jobs.aggregate([
  { $group: { _id: { $strLenCP: "$sourceJobId" }, n: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]).toArray().map(r => `${r._id} digits: ${r.n}`).join(", ");

const check = (ok, what) => print(`${ok ? "PASS" : "FAIL"}  ${what}`);

print(`database ${name}, greenhouse_jobs: ${total} row(s)`);
check(noKey === 0, `rows without boardKey: ${noKey}`);
check(badId === 0, `rows whose sourceJobId is not all digits: ${badId}`);
check(distinct === total, `distinct (boardKey, sourceJobId): ${distinct} of ${total}`);
check(!!index && index.unique === true, "uniq_boardkey_job exists and is unique");
check(!!oldIndex, "uniq_board_job still exists (kept until 2c)");
print(`sourceJobId lengths -- ${idLengths}`);
