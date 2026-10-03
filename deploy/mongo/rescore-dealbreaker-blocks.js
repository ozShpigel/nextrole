// Drop the stored scores a candidate_dealbreaker hard blocker forced to STRONG_NO
// (removed 2026-10-03, HardBlockerScope). A jobScores row is the "already scored"
// bookkeeping, so deleting it makes the next Matches visit score that job again
// under the current rules -- one Claude call per row, only for jobs actually viewed.
// Dry run by default: prints the rows. APPLY=1 deletes them.
// DB name resolved as the API does: MongoDB:DatabaseName ?? "job-tracker" (MongoExtensions).
//
// Matches on the parsed hardBlockers entry, not the text: the old prompt sent
// UNKNOWN dealbreakers to mustClarify, so "candidate_dealbreaker" appears in
// rows that were never blocked (a substring match selected 95 rows, most YES/MAYBE).
const MAIN_DB = process.env.MongoDB__DatabaseName || "job-tracker";
const APPLY = process.env.APPLY === "1";
const scores = db.getSiblingDB(MAIN_DB).jobScores;

const blockedByDealbreaker = s => {
  let a;
  try { a = JSON.parse(s.MatchAnalysis); } catch { return false; }
  const blockers = a?.hardBlockers ?? a?.HardBlockers ?? [];
  return blockers.some(b => /^candidate_dealbreaker$/i.test(b?.filter ?? b?.Filter ?? ""));
};

const ids = [];
scores.find({ Verdict: "STRONG_NO", MatchAnalysis: /candidate_dealbreaker/ },
            { UserId: 1, JobId: 1, Score: 1, Verdict: 1, MatchAnalysis: 1 })
  .forEach(s => {
    if (!blockedByDealbreaker(s)) return;
    ids.push(s._id);
    print(`  ${s.UserId}  job ${s.JobId}  ${s.Score} ${s.Verdict}`);
  });
print(`${ids.length} row(s) in ${MAIN_DB}.jobScores blocked by a dealbreaker`);

if (APPLY) print(`deleted ${scores.deleteMany({ _id: { $in: ids } }).deletedCount}`);
else print("dry run -- rerun with APPLY=1 to delete");
