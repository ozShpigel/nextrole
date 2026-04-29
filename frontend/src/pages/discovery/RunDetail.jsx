import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { discoveryApi, profileApi } from '../../utils/api';
import { VERDICT_HE } from '../../utils/constants';
import SnapshotsModal from '../../components/SnapshotsModal';

const EVALUATOR_PLACEHOLDERS = ['{{USER_PROFILE}}', '{{PARSED_JOB}}'];

function verdictColor(verdict) {
  if (verdict === 'STRONG_YES' || verdict === 'YES') return 'var(--green)';
  if (verdict === 'MAYBE') return 'var(--yellow)';
  if (verdict === 'NO' || verdict === 'STRONG_NO') return 'var(--red)';
  if (verdict === 'MATCH_FAILED') return 'var(--red)';
  return 'var(--text-dim)';
}

export default function RunDetail() {
  const { runId } = useParams();
  const [run, setRun] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rescoringIds, setRescoringIds] = useState(() => new Set());
  const [bulkRescoring, setBulkRescoring] = useState(false);
  const [snapshotsJob, setSnapshotsJob] = useState(null);

  // Inline Evaluator-prompt editor state — lazy-loaded from /api/match/profile
  // the first time the panel opens. Saving writes through to the same Mongo
  // override the Settings page uses, so the next rescore picks it up with no
  // navigation.
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptLoading, setPromptLoading] = useState(false);
  const [evaluatorPrompt, setEvaluatorPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [promptIsOverride, setPromptIsOverride] = useState(false);
  const [promptLastSaved, setPromptLastSaved] = useState(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptResult, setPromptResult] = useState(null);
  const [promptLoaded, setPromptLoaded] = useState(false);

  const pollRef = useRef(null);

  async function load() {
    try {
      const r = await discoveryApi(`/runs/${runId}`);
      setRun(r);
      const j = await discoveryApi(`/runs/${runId}/jobs`);
      setJobs(j);
      setLoading(false);
      return r.status;
    } catch (e) {
      setError(e.message);
      setLoading(false);
      return 'error';
    }
  }

  useEffect(() => {
    load().then((status) => {
      if (status === 'pending' || status === 'scraping' || status === 'scoring') {
        pollRef.current = setInterval(async () => {
          const s = await load();
          if (s === 'completed' || s === 'failed' || s === 'error') {
            clearInterval(pollRef.current);
          }
        }, 5000);
      }
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [runId]);

  async function saveJob(jobId) {
    try {
      await discoveryApi(`/jobs/${jobId}/save`, { method: 'POST' });
      load();
    } catch (e) {
      alert('שמירה נכשלה: ' + e.message);
    }
  }

  async function dismissJob(jobId) {
    try {
      await discoveryApi(`/jobs/${jobId}/dismiss`, { method: 'POST' });
      load();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  async function rescoreJob(job) {
    // Already-scored job: warn that the existing result will be overwritten.
    // This path exists primarily for iterating on the Evaluator prompt and
    // re-running the same job to compare.
    if (job.score != null && !confirm('לדרג מחדש? הציון הנוכחי יימחק ויוחלף.')) return;
    setRescoringIds((prev) => new Set(prev).add(job.id));
    try {
      await discoveryApi(`/jobs/${job.id}/rescore`, { method: 'POST' });
      await load();
    } catch (e) {
      alert('דירוג מחדש נכשל: ' + e.message);
    } finally {
      setRescoringIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  }

  async function rescoreAllFailed() {
    // Sequential, not parallel — the API is the bottleneck and the whole
    // reason we're here is that it was struggling. Firing 12 requests at
    // once would just re-trigger the rate-limit cascade.
    const failed = visibleJobs.filter(isFailed);
    if (failed.length === 0) return;
    if (!confirm(`לדרג מחדש ${failed.length} משרות שנכשלו?`)) return;
    setBulkRescoring(true);
    for (const j of failed) {
      try {
        await discoveryApi(`/jobs/${j.id}/rescore`, { method: 'POST' });
      } catch (e) {
        // On the first transport failure we assume the API is still down
        // and stop — no sense pushing the whole list through.
        alert(`דירוג מחדש נעצר: ${e.message}`);
        break;
      }
    }
    setBulkRescoring(false);
    load();
  }

  async function togglePromptPanel() {
    const next = !promptOpen;
    setPromptOpen(next);
    if (!next || promptLoaded) return;
    setPromptLoading(true);
    try {
      const data = await profileApi('/profile');
      const p = data?.evaluator_prompt || '';
      setEvaluatorPrompt(p);
      setOriginalPrompt(p);
      setPromptIsOverride(!!data?.evaluator_prompt_is_override);
      setPromptLastSaved(data?.updated_at);
      setPromptLoaded(true);
    } catch (e) {
      setPromptResult({ type: 'error', message: 'טעינת הפרומפט נכשלה: ' + e.message });
    } finally {
      setPromptLoading(false);
    }
  }

  async function persistPrompt(body, successMsg) {
    setSavingPrompt(true);
    setPromptResult(null);
    try {
      const data = await profileApi('/profile', { method: 'PUT', body: JSON.stringify(body) });
      const p = data?.evaluator_prompt || '';
      setEvaluatorPrompt(p);
      setOriginalPrompt(p);
      setPromptIsOverride(!!data?.evaluator_prompt_is_override);
      setPromptLastSaved(data?.updated_at);
      setPromptResult({ type: 'success', message: successMsg });
    } catch (e) {
      setPromptResult({ type: 'error', message: 'שמירה נכשלה: ' + e.message });
    } finally {
      setSavingPrompt(false);
    }
  }

  const missingPlaceholders = EVALUATOR_PLACEHOLDERS.filter((p) => !evaluatorPrompt.includes(p));
  const isPromptDirty = evaluatorPrompt !== originalPrompt;

  async function savePrompt() {
    if (missingPlaceholders.length > 0) {
      const msg = `חסרים פלייסהולדרים: ${missingPlaceholders.join(', ')}. ללא פלייסהולדרים הניתוח ישבר. לשמור בכל זאת?`;
      if (!confirm(msg)) return;
    }
    await persistPrompt({ evaluator_prompt: evaluatorPrompt }, 'הפרומפט נשמר. רצה דירוג מחדש כדי לראות את ההשפעה.');
  }

  async function resetPrompt() {
    if (!confirm('לאפס את הפרומפט לברירת המחדל של השירות? ההתאמה האישית תימחק.')) return;
    await persistPrompt({ evaluator_prompt: '' }, 'הפרומפט אופס לברירת המחדל.');
  }

  if (loading) return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-page-in isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
      {/* Atmospheric glows */}
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(168,130,86,0.06) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(61,155,133,0.045) 0%, transparent 65%)' }} />
      <RunDetailLoadingSkeleton />
    </div>
  );
  if (error) return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-page-in isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(168,130,86,0.06) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(61,155,133,0.045) 0%, transparent 65%)' }} />
      <div className="match-error">{error}</div>
    </div>
  );
  if (!run) return null;

  const statusMap = { pending: 'ממתין', scraping: 'סורק משרות...', scoring: 'מדרג עם AI...', completed: 'הושלם', failed: 'נכשל' };
  const isActive = run.status === 'pending' || run.status === 'scraping' || run.status === 'scoring';
  const visibleJobs = jobs.filter((j) => !j.dismissed && !j.is_duplicate);
  // Any job with a non-trivial description can be re-scored — the button
  // doubles as a prompt-iteration tool. The 50-char floor mirrors
  // match_client's own guard.
  const isRescorable = (j) => (j.description?.length || 0) >= 50;
  // The "rescore all failed" bulk banner only targets jobs that actually
  // failed — we don't want to nuke real scores en masse.
  const isFailed = (j) =>
    j.score == null && (
      j.verdict === 'MATCH_FAILED' ||
      (j.verdict === 'INSUFFICIENT_DATA' && (j.description?.length || 0) >= 50)
    );
  const failedCount = visibleJobs.filter(isFailed).length;

  const runStatusBadge = run.status === 'completed'
    ? 'bg-green-bg text-green border-[rgba(45,143,94,0.18)]'
    : run.status === 'failed'
      ? 'bg-red-bg text-red border-[rgba(196,84,84,0.18)]'
      : 'bg-yellow-bg text-yellow border-[rgba(166,139,43,0.18)]';

  return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-page-in isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
      {/* Atmospheric glows */}
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(168,130,86,0.06) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(61,155,133,0.045) 0%, transparent 65%)' }} />

      <Link to="/discovery" className="inline-flex items-center gap-[0.3rem] text-[0.82rem] text-accent mb-5 transition-all tracking-[0.02em] hover:opacity-75 hover:translate-x-[3px]">&larr; חזרה לגילוי משרות</Link>

      <div className="card mb-6">
        <h2 className="font-serif text-[1.6rem] font-bold text-text-bright mb-3 tracking-[-0.01em]">{run.criteria_name}</h2>
        <div className="flex gap-4 flex-wrap items-center text-[0.85rem] text-text-secondary">
          <span className={`text-[0.7rem] font-medium py-[0.22rem] px-[0.65rem] rounded-full border tracking-[0.06em] font-mono shrink-0 ${runStatusBadge}`}>
            {statusMap[run.status] || run.status}
          </span>
          <span>נסרקו: {run.jobs_scraped}</span>
          <span>דורגו: {run.jobs_scored}</span>
          <span>נשמרו: {run.jobs_saved}</span>
          <span>כפילויות: {run.jobs_skipped_duplicate}</span>
        </div>
        {isActive && <div className="match-loading">מעבד... הדף יתעדכן אוטומטית</div>}
        {run.error && <div className="match-error">{run.error}</div>}
        {!isActive && failedCount > 0 && (
          <div className="mt-4 p-[0.85rem_1rem] bg-[rgba(196,84,84,0.04)] border border-[rgba(196,84,84,0.22)] rounded flex items-center justify-between gap-4 text-red text-[0.88rem]">
            <span>{failedCount} משרות לא דורגו — ניתן לנסות שוב</span>
            <button
              className="btn btn-sm btn-primary shrink-0"
              onClick={rescoreAllFailed}
              disabled={bulkRescoring}
            >
              {bulkRescoring ? 'מדרג מחדש...' : 'דרג הכל מחדש'}
            </button>
          </div>
        )}
      </div>

      {/* Eval prompt panel */}
      <div className="card mb-6 !p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-4 p-[0.9rem_1.25rem]">
          <button
            type="button"
            className="group inline-flex items-center gap-[0.6rem] bg-transparent border-none p-[0.2rem_0] cursor-pointer font-sans text-[0.9rem] font-semibold text-text-bright"
            onClick={togglePromptPanel}
            aria-expanded={promptOpen}
          >
            <span className="text-[0.9rem] text-accent w-[0.9rem] inline-block text-center" aria-hidden="true">{promptOpen ? '▾' : '◂'}</span>
            <span className="font-serif text-[1rem] tracking-[0.01em] transition-colors group-hover:text-accent">פרומפט הערכה</span>
            <span className={`text-[0.66rem] tracking-[0.14em] uppercase font-medium py-[0.2rem] px-[0.55rem] rounded-full border ${promptIsOverride ? 'bg-accent-muted text-accent border-[rgba(168,130,86,0.2)]' : 'bg-bg-elevated text-text-dim border-border'}`}>
              {promptIsOverride ? 'מותאם אישית' : 'ברירת מחדל'}
            </span>
          </button>
          {promptLastSaved && (
            <span className="text-[0.72rem] text-text-dim tracking-[0.04em]">
              עודכן {new Date(promptLastSaved).toLocaleString('he-IL')}
            </span>
          )}
        </div>

        {promptOpen && (
          promptLoading ? (
            <div className="p-[1.25rem_1.5rem] text-text-dim text-[0.88rem] border-t border-dashed border-border">טוען פרומפט…</div>
          ) : (
            <div className="p-[1rem_1.5rem_1.25rem] border-t border-dashed border-border flex flex-col gap-3">
              <p className="text-[0.82rem] text-text-secondary leading-[1.55]">
                ערוך את פרומפט ההערכה. השינויים משפיעים על כל דירוג מחדש הבא — אין צורך לנווט להגדרות.
              </p>
              {missingPlaceholders.length > 0 && (
                <div className="text-[0.8rem] p-[0.55rem_0.8rem] bg-[rgba(196,84,84,0.06)] border border-[rgba(196,84,84,0.22)] rounded text-red flex flex-wrap gap-[0.3rem] items-center">
                  חסרים פלייסהולדרים: {missingPlaceholders.map((p) => <code key={p} className="font-code text-[0.78rem] bg-[rgba(196,84,84,0.08)] py-[0.08rem] px-[0.4rem] rounded-[4px]">{p}</code>).reduce((acc, cur, i) => i === 0 ? [cur] : [...acc, ' · ', cur], [])}
                </div>
              )}
              <textarea
                className="min-h-[360px] resize-y p-[0.9rem_1rem] font-code text-[0.82rem] leading-[1.6] text-text-primary bg-bg-elevated border border-border-strong rounded text-left whitespace-pre-wrap transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow"
                style={{ direction: 'ltr' }}
                value={evaluatorPrompt}
                onChange={(e) => { setEvaluatorPrompt(e.target.value); setPromptResult(null); }}
                dir="auto"
                spellCheck={false}
              />
              <div className="flex items-center justify-end flex-wrap gap-2 pt-1">
                <span className="me-auto text-[0.72rem] text-text-dim tracking-[0.04em]">
                  {evaluatorPrompt.length.toLocaleString()} תווים · ≈{Math.ceil(evaluatorPrompt.length / 4).toLocaleString()} tokens
                </span>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={resetPrompt}
                  disabled={savingPrompt}
                  title="החזר את פרומפט ההערכה לברירת המחדל המובנית"
                >
                  אפס לברירת מחדל
                </button>
                {isPromptDirty && (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => { setEvaluatorPrompt(originalPrompt); setPromptResult(null); }}
                    disabled={savingPrompt}
                  >
                    ביטול שינויים
                  </button>
                )}
                <button
                  className="btn btn-sm btn-primary"
                  onClick={savePrompt}
                  disabled={savingPrompt || !isPromptDirty}
                >
                  {savingPrompt ? 'שומר…' : 'שמור'}
                </button>
              </div>
              {promptResult && (
                <div className={`text-[0.82rem] p-[0.55rem_0.85rem] rounded border ${promptResult.type === 'success' ? 'bg-green-bg text-green border-[rgba(45,143,94,0.18)]' : 'bg-red-bg text-red border-[rgba(196,84,84,0.22)]'}`}>
                  {promptResult.message}
                </div>
              )}
            </div>
          )
        )}
      </div>

      {visibleJobs.length === 0 && !isActive ? (
        <p className="empty-state">לא נמצאו משרות</p>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleJobs.map((j) => (
            <div key={j.id} className="bg-warm border border-border rounded-lg p-6 transition-all hover:border-[rgba(168,130,86,0.2)] hover:shadow-[0_8px_24px_rgba(80,60,30,0.05)] hover:-translate-y-px">
              <div className="flex justify-between items-start gap-4 mb-3 max-[640px]:flex-col">
                <div>
                  <h3 className="font-serif text-[1.15rem] font-bold text-text-bright m-0 tracking-[-0.005em]">{j.title}</h3>
                  <div className="text-[0.88rem] text-text-secondary mt-[0.15rem]">{j.company}</div>
                  {j.location && <div className="text-[0.78rem] text-text-dim mt-[0.1rem] tracking-[0.02em]">{j.location}</div>}
                </div>
                <div className="text-center shrink-0 py-[0.4rem] px-3 bg-accent-muted border border-[rgba(168,130,86,0.16)] rounded">
                  {j.score != null ? (
                    <>
                      <div className="font-serif text-[1.9rem] font-bold leading-none tracking-[-0.02em]" style={{ color: verdictColor(j.verdict) }}>{j.score}</div>
                      <div className="text-[0.7rem] font-medium mt-1 tracking-[0.06em]" style={{ color: verdictColor(j.verdict) }}>{VERDICT_HE[j.verdict] || j.verdict || '-'}</div>
                    </>
                  ) : (
                    <div className="text-[0.7rem] font-medium mt-1 tracking-[0.06em]" style={{ color: 'var(--text-dim)' }}>{VERDICT_HE[j.verdict] || j.verdict || '-'}</div>
                  )}
                </div>
              </div>

              {j.key_strengths?.length > 0 && (
                <div className="flex flex-wrap gap-[0.4rem] mb-2">
                  {j.key_strengths.map((s, i) => <span key={i} className="match-flag green">{s}</span>)}
                </div>
              )}
              {j.key_concerns?.length > 0 && (
                <div className="flex flex-wrap gap-[0.4rem] mb-2">
                  {j.key_concerns.map((c, i) => <span key={i} className="match-flag red">{c}</span>)}
                </div>
              )}

              {j.honest_assessment && (
                <div className="text-[0.85rem] text-text-secondary leading-[1.7] my-3 p-[0.9rem_1.1rem] bg-[rgba(255,253,249,0.6)] border border-dashed border-[rgba(120,100,70,0.14)] rounded">{j.honest_assessment}</div>
              )}

              <div className="flex gap-2 items-center mt-3">
                {j.job_url && <a href={j.job_url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-secondary">צפה במשרה</a>}
                {isRescorable(j) && (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => rescoreJob(j)}
                    disabled={rescoringIds.has(j.id) || bulkRescoring}
                  >
                    {rescoringIds.has(j.id) ? 'מדרג...' : 'דרג מחדש'}
                  </button>
                )}
                {(j.evaluator_snapshot_input || j.analyst_snapshot_input) && (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setSnapshotsJob(j)}
                  >
                    קריאות Claude
                  </button>
                )}
                {!j.saved_to_tracker && j.score != null && (
                  <button className="btn btn-sm btn-primary" onClick={() => saveJob(j.id)}>שמור למעקב</button>
                )}
                {j.saved_to_tracker && <span className="text-[0.72rem] text-green font-medium py-1 px-[0.7rem] bg-green-bg border border-[rgba(45,143,94,0.18)] rounded-full tracking-[0.06em]">נשמר</span>}
                <button className="btn btn-sm btn-danger" onClick={() => dismissJob(j.id)}>הסתר</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {snapshotsJob && (
        <SnapshotsModal
          title={`${snapshotsJob.title} · ${snapshotsJob.company}`}
          snapshots={{
            analystInput:    snapshotsJob.analyst_snapshot_input,
            analystOutput:   snapshotsJob.analyst_snapshot_output,
            evaluatorInput:  snapshotsJob.evaluator_snapshot_input,
            evaluatorOutput: snapshotsJob.evaluator_snapshot_output,
          }}
          onClose={() => setSnapshotsJob(null)}
        />
      )}
    </div>
  );
}

function RunDetailLoadingSkeleton() {
  return (
    <div className="animate-page-in-fast relative pt-2" role="status" aria-live="polite" aria-label="טוען פרטי ריצה">
      <div className="skeleton w-[120px] h-[14px] rounded-[4px] mb-6" aria-hidden="true" />

      <div className="p-[1.5rem_1.5rem_1.8rem] bg-bg-card border border-border rounded-lg shadow-sm mb-8 relative overflow-hidden" aria-hidden="true">
        <div className="skeleton w-[48%] h-7 rounded-[4px]" />
        <div className="flex flex-wrap gap-3 mt-4">
          <span className="skeleton w-[90px] h-[22px] rounded-full" />
          <span className="skeleton inline-block w-[82px] h-[18px] rounded-full" />
          <span className="skeleton inline-block w-[82px] h-[18px] rounded-full" />
          <span className="skeleton inline-block w-[82px] h-[18px] rounded-full" />
          <span className="skeleton inline-block w-[82px] h-[18px] rounded-full" />
        </div>
        <div className="mt-[1.6rem] h-px relative overflow-hidden" style={{ background: 'linear-gradient(to left, transparent, rgba(168,130,86,0.18) 50%, transparent)' }}>
          <span
            className="absolute top-[-1px] bottom-[-1px] w-[28%] blur-[0.5px] shadow-[0_0_6px_rgba(168,130,86,0.3)] animate-track-sweep"
            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(168,130,86,0.55) 50%, transparent 100%)' }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="p-[1.3rem_1.35rem_1.1rem] bg-bg-card border border-border rounded-lg shadow-sm flex flex-col gap-[0.85rem] animate-[cardRise_0.6s_cubic-bezier(0.22,1,0.36,1)_both]"
            style={{ animationDelay: `${i * 80 + 200}ms` }}
            aria-hidden="true"
          >
            <div className="flex justify-between items-start gap-5">
              <div className="flex flex-col gap-[0.3rem] flex-1 min-w-0">
                <div className="skeleton w-[65%] h-[18px] rounded-[4px]" />
                <div className="skeleton w-[40%] h-[14px] rounded-[4px] mt-[0.45rem]" />
                <div className="skeleton w-[28%] h-3 rounded-[4px] mt-[0.4rem]" />
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="skeleton w-12 h-8 rounded-[6px]" />
                <div className="skeleton w-[72px] h-3 rounded-[4px] mt-[0.4rem]" />
              </div>
            </div>
            <div className="flex flex-wrap gap-[0.4rem]">
              <span className="skeleton inline-block w-[90px] h-[22px] rounded-full" />
              <span className="skeleton inline-block w-[58px] h-[22px] rounded-full" />
              <span className="skeleton inline-block w-[90px] h-[22px] rounded-full" />
            </div>
            <div className="skeleton w-full h-3 rounded-[4px]" />
            <div className="skeleton w-[70%] h-3 rounded-[4px]" />
          </div>
        ))}
      </div>

      {/* Cycling subtitle */}
      <div className="mt-10 pt-[1.4rem] border-t border-dashed border-[rgba(120,100,70,0.14)] flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-text-secondary italic tracking-[-0.005em] relative">
        <span className="absolute -top-px start-0 w-9 h-px bg-accent opacity-50" />
        <span className="font-serif text-[1.15rem] text-accent opacity-75 not-italic" aria-hidden="true">§</span>
        <span className="relative inline-block h-[1.4em] min-w-[22ch]" aria-hidden="true">
          <span className="absolute inset-0 start-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '0s' }}>מאחזר את הריצה</span>
          <span className="absolute inset-0 start-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '2s' }}>טוען משרות מדורגות</span>
          <span className="absolute inset-0 start-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '4s' }}>ממיין לפי ציון</span>
        </span>
        <span className="sr-only">טוען</span>
      </div>
    </div>
  );
}
