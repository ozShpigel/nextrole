// Drop the stored scores a candidate_dealbreaker hard blocker forced to STRONG_NO
// (removed 2026-10-03, HardBlockerScope). A jobScores row is the "already scored"
// bookkeeping, so deleting it makes the next Matches visit score that job again
// under the current rules -- one Claude call per row, only for jobs actually viewed.
// Dry run by default: prints the rows. APPLY=1 deletes them.
// DB name resolved as the API does: MongoDB:DatabaseName ?? "job-tracker" (MongoExtensions).
const MAIN_DB = process.env.MongoDB__DatabaseName || "job-tracker";
const APPLY = process.env.APPLY === "1";
const scores = db.getSiblingDB(MAIN_DB).jobScores;
const filter = { MatchAnalysis: /candidate_dealbreaker/ };

scores.find(filter, { UserId: 1, JobId: 1, Score: 1, Verdict: 1 })
  .forEach(s => print(`  ${s.UserId}  job ${s.JobId}  ${s.Score} ${s.Verdict}`));
print(`${scores.countDocuments(filter)} row(s) in ${MAIN_DB}.jobScores`);

if (APPLY) print(`deleted ${scores.deleteMany(filter).deletedCount}`);
else print("dry run -- rerun with APPLY=1 to delete");
