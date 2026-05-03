import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { discoveryApi, profileApi } from '../../utils/api';
import { VERDICT_LABELS, EVALUATOR_PLACEHOLDERS } from '../../utils/constants';
import SnapshotsModal from '../../components/SnapshotsModal';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function verdictColor(verdict) {
  if (verdict === 'STRONG_YES' || verdict === 'YES') return 'var(--green)';
  if (verdict === 'MAYBE') return 'var(--yellow)';
  if (verdict === 'NO' || verdict === 'STRONG_NO') return 'var(--red)';
  if (verdict === 'MATCH_FAILED') return 'var(--red)';
  return 'var(--muted-foreground)';
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
      alert('Save failed: ' + e.message);
    }
  }

  async function dismissJob(jobId) {
    try {
      await discoveryApi(`/jobs/${jobId}/dismiss`, { method: 'POST' });
      load();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  async function rescoreJob(job) {
    // Already-scored job: warn that the existing result will be overwritten.
    // This path exists primarily for iterating on the Evaluator prompt and
    // re-running the same job to compare.
    if (job.score != null && !confirm('Rescore? The current score will be replaced.')) return;
    setRescoringIds((prev) => new Set(prev).add(job.id));
    try {
      await discoveryApi(`/jobs/${job.id}/rescore`, { method: 'POST' });
      await load();
    } catch (e) {
      alert('Rescoring failed: ' + e.message);
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
    if (!confirm(`Rescore ${failed.length} failed jobs?`)) return;
    setBulkRescoring(true);
    for (const j of failed) {
      try {
        await discoveryApi(`/jobs/${j.id}/rescore`, { method: 'POST' });
      } catch (e) {
        // On the first transport failure we assume the API is still down
        // and stop — no sense pushing the whole list through.
        alert(`Rescoring stopped: ${e.message}`);
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
      setPromptResult({ type: 'error', message: 'Failed to load prompt: ' + e.message });
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
      setPromptResult({ type: 'error', message: 'Save failed: ' + e.message });
    } finally {
      setSavingPrompt(false);
    }
  }

  const missingPlaceholders = EVALUATOR_PLACEHOLDERS.filter((p) => !evaluatorPrompt.includes(p));
  const isPromptDirty = evaluatorPrompt !== originalPrompt;

  async function savePrompt() {
    if (missingPlaceholders.length > 0) {
      const msg = `Missing placeholders: ${missingPlaceholders.join(', ')}. Without them, scoring will break. Save anyway?`;
      if (!confirm(msg)) return;
    }
    await persistPrompt({ evaluator_prompt: evaluatorPrompt }, 'Prompt saved. Run a rescore to see the effect.');
  }

  async function resetPrompt() {
    if (!confirm('Reset the prompt to the service default? Your customization will be removed.')) return;
    await persistPrompt({ evaluator_prompt: '' }, 'Prompt reset to default.');
  }

  if (loading) return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-page-in isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
      {/* Atmospheric glows */}
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 65%)' }} />
      <RunDetailLoadingSkeleton />
    </div>
  );
  if (error) return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-page-in isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 65%)' }} />
      <div className="mt-4 p-3 bg-destructive/10 text-destructive text-[0.88rem] rounded border border-destructive/20">{error}</div>
    </div>
  );
  if (!run) return null;

  const statusMap = { pending: 'Pending', scraping: 'Scraping jobs...', scoring: 'AI scoring...', completed: 'Completed', failed: 'Failed' };
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
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 65%)' }} />

      <Link to="/discovery" className="inline-flex items-center gap-[0.3rem] text-[0.82rem] text-primary mb-5 transition-all tracking-[0.02em] hover:opacity-75 hover:-translate-x-[3px]">&larr; Back to Job Discovery</Link>

      <Card className="p-6 mb-6">
        <h2 className="font-serif text-[1.6rem] font-bold text-foreground mb-3 tracking-[-0.01em]">{run.criteria_name}</h2>
        <div className="flex gap-4 flex-wrap items-center text-[0.85rem] text-muted-foreground">
          <Badge variant="outline" className={`text-[0.7rem] font-medium py-[0.22rem] px-[0.65rem] rounded-full tracking-[0.06em] font-mono shrink-0 ${runStatusBadge}`}>
            {statusMap[run.status] || run.status}
          </Badge>
          <span>Scraped: {run.jobs_scraped}</span>
          <span>Scored: {run.jobs_scored}</span>
          <span>Saved: {run.jobs_saved}</span>
          <span>Duplicates: {run.jobs_skipped_duplicate}</span>
        </div>
        {isActive && <div className="mt-4 p-3 bg-muted text-muted-foreground text-[0.88rem] rounded border border-border">Processing... the page will update automatically</div>}
        {run.error && <div className="mt-4 p-3 bg-destructive/10 text-destructive text-[0.88rem] rounded border border-destructive/20">{run.error}</div>}
        {!isActive && failedCount > 0 && (
          <div className="mt-4 p-[0.85rem_1rem] bg-[rgba(196,84,84,0.04)] border border-[rgba(196,84,84,0.22)] rounded flex items-center justify-between gap-4 text-red text-[0.88rem]">
            <span>{failedCount} jobs failed scoring — you can retry</span>
            <Button
              size="sm"
              onClick={rescoreAllFailed}
              disabled={bulkRescoring}
              className="shrink-0"
            >
              {bulkRescoring ? 'Rescoring...' : 'Rescore All Failed'}
            </Button>
          </div>
        )}
      </Card>

      {/* Eval prompt panel */}
      <Card className="mb-6 p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-4 p-[0.9rem_1.25rem]">
          <button
            type="button"
            className="group inline-flex items-center gap-[0.6rem] bg-transparent border-none p-[0.2rem_0] cursor-pointer font-sans text-[0.9rem] font-semibold text-foreground"
            onClick={togglePromptPanel}
            aria-expanded={promptOpen}
          >
            <span className="text-[0.9rem] text-primary w-[0.9rem] inline-block text-center" aria-hidden="true">{promptOpen ? '▾' : '▸'}</span>
            <span className="font-serif text-[1rem] tracking-[0.01em] transition-colors group-hover:text-primary">Evaluator Prompt</span>
            <span className={`text-[0.66rem] tracking-[0.14em] uppercase font-medium py-[0.2rem] px-[0.55rem] rounded-full border ${promptIsOverride ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted text-muted-foreground border-border'}`}>
              {promptIsOverride ? 'Custom' : 'Default'}
            </span>
          </button>
          {promptLastSaved && (
            <span className="text-[0.72rem] text-muted-foreground tracking-[0.04em]">
              Updated {new Date(promptLastSaved).toLocaleString('en-US')}
            </span>
          )}
        </div>

        {promptOpen && (
          promptLoading ? (
            <div className="p-[1.25rem_1.5rem] text-muted-foreground text-[0.88rem] border-t border-dashed border-border">Loading prompt...</div>
          ) : (
            <div className="p-[1rem_1.5rem_1.25rem] border-t border-dashed border-border flex flex-col gap-3">
              <p className="text-[0.82rem] text-muted-foreground leading-[1.55]">
                Edit the evaluator prompt. Changes affect the next rescore — no need to navigate to settings.
              </p>
              {missingPlaceholders.length > 0 && (
                <div className="text-[0.8rem] p-[0.55rem_0.8rem] bg-[rgba(196,84,84,0.06)] border border-[rgba(196,84,84,0.22)] rounded text-red flex flex-wrap gap-[0.3rem] items-center">
                  Missing placeholders: {missingPlaceholders.map((p) => <code key={p} className="font-code text-[0.78rem] bg-[rgba(196,84,84,0.08)] py-[0.08rem] px-[0.4rem] rounded-[4px]">{p}</code>).reduce((acc, cur, i) => i === 0 ? [cur] : [...acc, ' · ', cur], [])}
                </div>
              )}
              <textarea
                className="min-h-[360px] resize-y p-[0.9rem_1rem] font-code text-[0.82rem] leading-[1.6] text-foreground bg-muted border border-border rounded text-left whitespace-pre-wrap transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20"
                value={evaluatorPrompt}
                onChange={(e) => { setEvaluatorPrompt(e.target.value); setPromptResult(null); }}
                dir="auto"
                spellCheck={false}
              />
              <div className="flex items-center justify-end flex-wrap gap-2 pt-1">
                <span className="mr-auto text-[0.72rem] text-muted-foreground tracking-[0.04em]">
                  {evaluatorPrompt.length.toLocaleString()} chars · ~{Math.ceil(evaluatorPrompt.length / 4).toLocaleString()} tokens
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetPrompt}
                  disabled={savingPrompt}
                  title="Reset the evaluator prompt to the built-in default"
                >
                  Reset to Default
                </Button>
                {isPromptDirty && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setEvaluatorPrompt(originalPrompt); setPromptResult(null); }}
                    disabled={savingPrompt}
                  >
                    Discard Changes
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={savePrompt}
                  disabled={savingPrompt || !isPromptDirty}
                >
                  {savingPrompt ? 'Saving...' : 'Save'}
                </Button>
              </div>
              {promptResult && (
                <div className={`text-[0.82rem] p-[0.55rem_0.85rem] rounded border ${promptResult.type === 'success' ? 'bg-green-bg text-green border-[rgba(45,143,94,0.18)]' : 'bg-red-bg text-red border-[rgba(196,84,84,0.22)]'}`}>
                  {promptResult.message}
                </div>
              )}
            </div>
          )
        )}
      </Card>

      {visibleJobs.length === 0 && !isActive ? (
        <p className="text-center text-muted-foreground py-12 text-[0.95rem]">No jobs found</p>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleJobs.map((j) => (
            <div key={j.id} className="bg-card border border-border rounded-lg p-6 transition-all hover:border-border hover:shadow-lg hover:-translate-y-px">
              <div className="flex justify-between items-start gap-4 mb-3 max-[640px]:flex-col">
                <div>
                  <h3 className="font-serif text-[1.15rem] font-bold text-foreground m-0 tracking-[-0.005em]">{j.title}</h3>
                  <div className="text-[0.88rem] text-muted-foreground mt-[0.15rem]">{j.company}</div>
                  {j.location && <div className="text-[0.78rem] text-muted-foreground mt-[0.1rem] tracking-[0.02em]">{j.location}</div>}
                  {j.glassdoor_data && (
                    <div className="flex items-center gap-[0.35rem] mt-[0.25rem]">
                      <span className="text-[0.75rem] font-medium" style={{ color: j.glassdoor_data.rating >= 4.0 ? 'var(--green)' : j.glassdoor_data.rating >= 3.0 ? 'var(--yellow)' : 'var(--red)' }}>
                        {j.glassdoor_data.rating.toFixed(1)} / 5
                      </span>
                      {j.glassdoor_data.reviewCount && <span className="text-[0.7rem] text-muted-foreground">({j.glassdoor_data.reviewCount.toLocaleString()} reviews)</span>}
                      {j.glassdoor_data.url && <a href={j.glassdoor_data.url} target="_blank" rel="noopener noreferrer" className="text-[0.7rem] text-primary hover:opacity-75">Glassdoor</a>}
                    </div>
                  )}
                </div>
                <div className="text-center shrink-0 py-[0.4rem] px-3 bg-muted border border-border rounded">
                  {j.score != null ? (
                    <>
                      <div className="font-serif text-[1.9rem] font-bold leading-none tracking-[-0.02em]" style={{ color: verdictColor(j.verdict) }}>{j.score}</div>
                      <div className="text-[0.7rem] font-medium mt-1 tracking-[0.06em]" style={{ color: verdictColor(j.verdict) }}>{VERDICT_LABELS[j.verdict] || j.verdict || '-'}</div>
                    </>
                  ) : (
                    <div className="text-[0.7rem] font-medium mt-1 tracking-[0.06em]" style={{ color: 'var(--muted-foreground)' }}>{VERDICT_LABELS[j.verdict] || j.verdict || '-'}</div>
                  )}
                </div>
              </div>

              {j.key_strengths?.length > 0 && (
                <div className="flex flex-wrap gap-[0.4rem] mb-2">
                  {j.key_strengths.map((s, i) => <Badge key={i} variant="outline" className="bg-green-bg text-green border-[rgba(45,143,94,0.18)] text-[0.75rem]">{s}</Badge>)}
                </div>
              )}
              {j.key_concerns?.length > 0 && (
                <div className="flex flex-wrap gap-[0.4rem] mb-2">
                  {j.key_concerns.map((c, i) => <Badge key={i} variant="outline" className="bg-red-bg text-red border-[rgba(196,84,84,0.18)] text-[0.75rem]">{c}</Badge>)}
                </div>
              )}

              {j.company_news?.length > 0 && (
                <details className="my-2">
                  <summary className="text-[0.78rem] font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                    Company News ({j.company_news.length})
                  </summary>
                  <ul className="mt-1 pl-4 list-disc">
                    {j.company_news.map((n, i) => (
                      <li key={i} className="text-[0.78rem] text-muted-foreground leading-[1.6] mb-[0.2rem]">
                        {n.title}{n.source && <span className="text-muted-foreground/60"> — {n.source}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {j.honest_assessment && (
                <div dir="rtl" className="text-[0.85rem] text-muted-foreground leading-[1.7] my-3 p-[0.9rem_1.1rem] bg-muted/50 border border-dashed border-border rounded text-right">{j.honest_assessment}</div>
              )}

              <div className="flex gap-2 items-center mt-3">
                {j.job_url && <Button variant="outline" size="sm" asChild><a href={j.job_url} target="_blank" rel="noopener noreferrer">View Job</a></Button>}
                {isRescorable(j) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => rescoreJob(j)}
                    disabled={rescoringIds.has(j.id) || bulkRescoring}
                  >
                    {rescoringIds.has(j.id) ? 'Scoring...' : 'Rescore'}
                  </Button>
                )}
                {(j.evaluator_snapshot_input || j.analyst_snapshot_input) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSnapshotsJob(j)}
                  >
                    Claude Calls
                  </Button>
                )}
                {!j.saved_to_tracker && j.score != null && (
                  <Button size="sm" onClick={() => saveJob(j.id)}>Save to Tracker</Button>
                )}
                {j.saved_to_tracker && <span className="text-[0.72rem] text-green font-medium py-1 px-[0.7rem] bg-green-bg border border-[rgba(45,143,94,0.18)] rounded-full tracking-[0.06em]">Saved</span>}
                <Button variant="destructive" size="sm" onClick={() => dismissJob(j.id)}>Dismiss</Button>
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
    <div className="animate-page-in-fast relative pt-2" role="status" aria-live="polite" aria-label="Loading run details">
      <div className="skeleton w-[120px] h-[14px] rounded-[4px] mb-6" aria-hidden="true" />

      <div className="p-[1.5rem_1.5rem_1.8rem] bg-card border border-border rounded-lg shadow-sm mb-8 relative overflow-hidden" aria-hidden="true">
        <div className="skeleton w-[48%] h-7 rounded-[4px]" />
        <div className="flex flex-wrap gap-3 mt-4">
          <span className="skeleton w-[90px] h-[22px] rounded-full" />
          <span className="skeleton inline-block w-[82px] h-[18px] rounded-full" />
          <span className="skeleton inline-block w-[82px] h-[18px] rounded-full" />
          <span className="skeleton inline-block w-[82px] h-[18px] rounded-full" />
          <span className="skeleton inline-block w-[82px] h-[18px] rounded-full" />
        </div>
        <div className="mt-[1.6rem] h-px relative overflow-hidden" style={{ background: 'linear-gradient(to left, transparent, rgba(161,161,170,0.18) 50%, transparent)' }}>
          <span
            className="absolute top-[-1px] bottom-[-1px] w-[28%] blur-[0.5px] shadow-[0_0_6px_rgba(161,161,170,0.3)] animate-track-sweep"
            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(161,161,170,0.55) 50%, transparent 100%)' }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="p-[1.3rem_1.35rem_1.1rem] bg-card border border-border rounded-lg shadow-sm flex flex-col gap-[0.85rem] animate-[cardRise_0.6s_cubic-bezier(0.22,1,0.36,1)_both]"
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
      <div className="mt-10 pt-[1.4rem] border-t border-dashed border-border flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-muted-foreground italic tracking-[-0.005em] relative">
        <span className="absolute -top-px left-0 w-9 h-px bg-primary opacity-50" />
        <span className="font-serif text-[1.15rem] text-primary opacity-75 not-italic" aria-hidden="true">§</span>
        <span className="relative inline-block h-[1.4em] min-w-[22ch]" aria-hidden="true">
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '0s' }}>Fetching the run</span>
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '2s' }}>Loading scored jobs</span>
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '4s' }}>Sorting by score</span>
        </span>
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}
