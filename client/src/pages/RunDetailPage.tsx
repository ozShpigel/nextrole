import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useRunDetail, useRunJobs, useProfile } from '../lib/queries';
import { useSaveJob, useDismissJob, useRescoreJob, useSaveProfile } from '../lib/mutations';
import type { ProfileResponse } from '../lib/types';
import { VERDICT_LABELS, EVALUATOR_PLACEHOLDERS } from '../lib/scoring';
import { SnapshotsModal } from '../components/Snapshots';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface GlassdoorData {
  rating: number;
  reviewCount?: number;
  url?: string;
}

interface NewsItem {
  title: string;
  source?: string;
}

interface MatchAnalysis {
  honestAssessment?: string;
  recommendation?: {
    greenFlags?: string[];
    redFlags?: string[];
  };
}

interface DiscoveredJob {
  id: string;
  title: string;
  company: string;
  location?: string;
  description?: string;
  score: number | null;
  verdict: string | null;
  match_analysis?: MatchAnalysis;
  company_news?: NewsItem[];
  glassdoor_data?: GlassdoorData;
  job_url?: string;
  saved_to_tracker: boolean;
  dismissed: boolean;
  is_duplicate: boolean;
  evaluator_snapshot_input?: string;
  evaluator_snapshot_output?: string;
  analyst_snapshot_input?: string;
  analyst_snapshot_output?: string;
}

interface Run {
  id: string;
  criteria_name: string;
  status: string;
  jobs_scraped: number;
  jobs_scored: number;
  jobs_saved: number;
  jobs_skipped_duplicate: number;
  error?: string;
}

interface PromptResult {
  type: 'success' | 'error';
  message: string;
}

function verdictColor(verdict: string | null): string {
  if (verdict === 'STRONG_YES' || verdict === 'YES') return '#059669';
  if (verdict === 'MAYBE') return '#d97706';
  if (verdict === 'NO' || verdict === 'STRONG_NO') return '#ef4444';
  if (verdict === 'MATCH_FAILED') return '#ef4444';
  return 'var(--muted-foreground)';
}

export default function RunDetail() {
  const { runId } = useParams<{ runId: string }>();

  // --- React Query hooks ---
  const runQuery = useRunDetail(runId!);
  const run = runQuery.data as Run | undefined;
  const isActive = run?.status === 'pending' || run?.status === 'scraping' || run?.status === 'scoring';

  const jobsQuery = useRunJobs(runId!, isActive ?? false);
  const jobs = (jobsQuery.data as DiscoveredJob[] | undefined) ?? [];

  const profileQuery = useProfile();

  // --- Mutation hooks ---
  const saveJobMutation = useSaveJob();
  const dismissJobMutation = useDismissJob();
  const rescoreJobMutation = useRescoreJob();
  const saveProfileMutation = useSaveProfile();

  // --- UI state ---
  const [rescoringIds, setRescoringIds] = useState<Set<string>>(() => new Set());
  const [bulkRescoring, setBulkRescoring] = useState<boolean>(false);
  const [snapshotsJob, setSnapshotsJob] = useState<DiscoveredJob | null>(null);

  // Inline Evaluator-prompt editor state — lazy-loaded from /api/match/profile
  // the first time the panel opens. Saving writes through to the same Mongo
  // override the Settings page uses, so the next rescore picks it up with no
  // navigation.
  const [promptOpen, setPromptOpen] = useState<boolean>(false);
  const [evaluatorPrompt, setEvaluatorPrompt] = useState<string>('');
  const [originalPrompt, setOriginalPrompt] = useState<string>('');
  const [promptIsOverride, setPromptIsOverride] = useState<boolean>(false);
  const [promptLastSaved, setPromptLastSaved] = useState<string | null>(null);
  const [promptResult, setPromptResult] = useState<PromptResult | null>(null);
  const [promptLoaded, setPromptLoaded] = useState<boolean>(false);

  // Initialize local prompt state from profile data when panel first opens
  useEffect(() => {
    if (promptOpen && !promptLoaded && profileQuery.data) {
      const data = profileQuery.data;
      const p = data?.evaluator_prompt || '';
      setEvaluatorPrompt(p);
      setOriginalPrompt(p);
      setPromptIsOverride(!!data?.evaluator_prompt_is_override);
      setPromptLastSaved(data?.updated_at ?? null);
      setPromptLoaded(true);
    }
  }, [promptOpen, promptLoaded, profileQuery.data]);

  // --- Derived state ---
  const loading = runQuery.isLoading || jobsQuery.isLoading;
  const error = runQuery.error?.message ?? jobsQuery.error?.message ?? null;

  // --- Actions ---

  async function saveJob(jobId: string): Promise<void> {
    try {
      await saveJobMutation.mutateAsync(jobId);
    } catch (e) {
      alert('Save failed: ' + (e as Error).message);
    }
  }

  async function dismissJob(jobId: string): Promise<void> {
    try {
      await dismissJobMutation.mutateAsync(jobId);
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    }
  }

  async function rescoreJob(job: DiscoveredJob): Promise<void> {
    if (job.score != null && !confirm('Rescore? The current score will be replaced.')) return;
    setRescoringIds((prev) => new Set(prev).add(job.id));
    try {
      await rescoreJobMutation.mutateAsync(job.id);
    } catch (e) {
      alert('Rescoring failed: ' + (e as Error).message);
    } finally {
      setRescoringIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  }

  async function rescoreAllFailed(): Promise<void> {
    const failed = visibleJobs.filter(isFailed);
    if (failed.length === 0) return;
    if (!confirm(`Rescore ${failed.length} failed jobs?`)) return;
    setBulkRescoring(true);
    for (const j of failed) {
      try {
        await rescoreJobMutation.mutateAsync(j.id);
      } catch (e) {
        alert(`Rescoring stopped: ${(e as Error).message}`);
        break;
      }
    }
    setBulkRescoring(false);
  }

  function togglePromptPanel(): void {
    setPromptOpen((prev) => !prev);
  }

  function persistPrompt(body: Record<string, unknown>, successMsg: string): void {
    setPromptResult(null);
    saveProfileMutation.mutate(body, {
      onSuccess: (data) => {
        const profile = data as ProfileResponse;
        const p = profile?.evaluator_prompt || '';
        setEvaluatorPrompt(p);
        setOriginalPrompt(p);
        setPromptIsOverride(!!profile?.evaluator_prompt_is_override);
        setPromptLastSaved(profile?.updated_at ?? null);
        setPromptResult({ type: 'success', message: successMsg });
      },
      onError: (e) => {
        setPromptResult({ type: 'error', message: 'Save failed: ' + (e as Error).message });
      },
    });
  }

  const savingPrompt = saveProfileMutation.isPending;
  const promptLoading = promptOpen && !promptLoaded && profileQuery.isLoading;
  const missingPlaceholders = EVALUATOR_PLACEHOLDERS.filter((p: string) => !evaluatorPrompt.includes(p));
  const isPromptDirty = evaluatorPrompt !== originalPrompt;

  function savePrompt(): void {
    if (missingPlaceholders.length > 0) {
      const msg = `Missing placeholders: ${missingPlaceholders.join(', ')}. Without them, scoring will break. Save anyway?`;
      if (!confirm(msg)) return;
    }
    persistPrompt({ evaluator_prompt: evaluatorPrompt }, 'Prompt saved. Run a rescore to see the effect.');
  }

  function resetPrompt(): void {
    if (!confirm('Reset the prompt to the service default? Your customization will be removed.')) return;
    persistPrompt({ evaluator_prompt: '' }, 'Prompt reset to default.');
  }

  if (loading) return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
      {/* Atmospheric glows */}
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 65%)' }} />
      <RunDetailLoadingSkeleton />
    </div>
  );
  if (error) return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 65%)' }} />
      <div className="mt-4 p-3 bg-destructive/10 text-destructive text-[0.88rem] rounded border border-destructive/20">{error}</div>
    </div>
  );
  if (!run) return null;

  const statusMap: Record<string, string> = { pending: 'Pending', scraping: 'Scraping jobs...', scoring: 'AI scoring...', completed: 'Completed', failed: 'Failed' };
  const visibleJobs = jobs.filter((j) => !j.dismissed && !j.is_duplicate);
  const isRescorable = (j: DiscoveredJob): boolean => (j.description?.length || 0) >= 50;
  const isFailed = (j: DiscoveredJob): boolean =>
    j.score == null && (
      j.verdict === 'MATCH_FAILED' ||
      (j.verdict === 'INSUFFICIENT_DATA' && (j.description?.length || 0) >= 50)
    );
  const failedCount = visibleJobs.filter(isFailed).length;

  const runStatusBadge = run.status === 'completed'
    ? 'bg-emerald-50 text-emerald-600 border-emerald-600/18'
    : run.status === 'failed'
      ? 'bg-red-50 text-red-500 border-red-500/18'
      : 'bg-amber-50 text-amber-600 border-amber-600/18';

  return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
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
          <div className="mt-4 p-[0.85rem_1rem] bg-red-500/[0.04] border border-red-500/[0.22] rounded flex items-center justify-between gap-4 text-red-500 text-[0.88rem]">
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
                <div className="text-[0.8rem] p-[0.55rem_0.8rem] bg-red-500/[0.06] border border-red-500/[0.22] rounded text-red-500 flex flex-wrap gap-[0.3rem] items-center">
                  Missing placeholders: {missingPlaceholders.map((p: string) => <code key={p} className="font-code text-[0.78rem] bg-red-500/[0.08] py-[0.08rem] px-[0.4rem] rounded-[4px]">{p}</code>).reduce<React.ReactNode[]>((acc, cur, i) => i === 0 ? [cur] : [...acc, ' · ', cur], [])}
                </div>
              )}
              <textarea
                className="min-h-[360px] resize-y p-[0.9rem_1rem] font-code text-[0.82rem] leading-[1.6] text-foreground bg-muted border border-border rounded text-left whitespace-pre-wrap transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20"
                value={evaluatorPrompt}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setEvaluatorPrompt(e.target.value); setPromptResult(null); }}
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
                <div className={`text-[0.82rem] p-[0.55rem_0.85rem] rounded border ${promptResult.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-600/18' : 'bg-red-50 text-red-500 border-red-500/[0.22]'}`}>
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
                      <span className="text-[0.75rem] font-medium" style={{ color: j.glassdoor_data.rating >= 4.0 ? '#059669' : j.glassdoor_data.rating >= 3.0 ? '#d97706' : '#ef4444' }}>
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
                      <div className="text-[0.7rem] font-medium mt-1 tracking-[0.06em]" style={{ color: verdictColor(j.verdict) }}>{VERDICT_LABELS[j.verdict as keyof typeof VERDICT_LABELS] || j.verdict || '-'}</div>
                    </>
                  ) : (
                    <div className="text-[0.7rem] font-medium mt-1 tracking-[0.06em]" style={{ color: 'var(--muted-foreground)' }}>{VERDICT_LABELS[j.verdict as keyof typeof VERDICT_LABELS] || j.verdict || '-'}</div>
                  )}
                </div>
              </div>

              {j.match_analysis?.recommendation?.greenFlags && j.match_analysis.recommendation.greenFlags.length > 0 && (
                <div className="flex flex-wrap gap-[0.4rem] mb-2">
                  {j.match_analysis.recommendation.greenFlags.map((s, i) => <Badge key={i} variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-600/18 text-[0.75rem]">{s}</Badge>)}
                </div>
              )}
              {j.match_analysis?.recommendation?.redFlags && j.match_analysis.recommendation.redFlags.length > 0 && (
                <div className="flex flex-wrap gap-[0.4rem] mb-2">
                  {j.match_analysis.recommendation.redFlags.map((c, i) => <Badge key={i} variant="outline" className="bg-red-50 text-red-500 border-red-500/18 text-[0.75rem]">{c}</Badge>)}
                </div>
              )}

              {j.company_news && j.company_news.length > 0 && (
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

              {j.match_analysis?.honestAssessment && (
                <div dir="rtl" className="text-[0.85rem] text-muted-foreground leading-[1.7] my-3 p-[0.9rem_1.1rem] bg-muted/50 border border-dashed border-border rounded text-right">{j.match_analysis.honestAssessment}</div>
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
                {j.saved_to_tracker && <span className="text-[0.72rem] text-emerald-600 font-medium py-1 px-[0.7rem] bg-emerald-50 border border-emerald-600/18 rounded-full tracking-[0.06em]">Saved</span>}
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
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 relative pt-2" role="status" aria-live="polite" aria-label="Loading run details">
      <Skeleton className="w-[120px] h-[14px] rounded-[4px] mb-6" aria-hidden="true" />

      <div className="p-[1.5rem_1.5rem_1.8rem] bg-card border border-border rounded-lg shadow-sm mb-8 relative overflow-hidden" aria-hidden="true">
        <Skeleton className="w-[48%] h-7 rounded-[4px]" />
        <div className="flex flex-wrap gap-3 mt-4">
          <Skeleton className="w-[90px] h-[22px] rounded-full" />
          <Skeleton className="inline-block w-[82px] h-[18px] rounded-full" />
          <Skeleton className="inline-block w-[82px] h-[18px] rounded-full" />
          <Skeleton className="inline-block w-[82px] h-[18px] rounded-full" />
          <Skeleton className="inline-block w-[82px] h-[18px] rounded-full" />
        </div>
        <div className="mt-[1.6rem] h-px" style={{ background: 'linear-gradient(to left, transparent, rgba(161,161,170,0.18) 50%, transparent)' }} />

      </div>

      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="p-[1.3rem_1.35rem_1.1rem] bg-card border border-border rounded-lg shadow-sm flex flex-col gap-[0.85rem] animate-in fade-in slide-in-from-bottom-2 duration-300"
            style={{ animationDelay: `${i * 80 + 200}ms` }}
            aria-hidden="true"
          >
            <div className="flex justify-between items-start gap-5">
              <div className="flex flex-col gap-[0.3rem] flex-1 min-w-0">
                <Skeleton className="w-[65%] h-[18px] rounded-[4px]" />
                <Skeleton className="w-[40%] h-[14px] rounded-[4px] mt-[0.45rem]" />
                <Skeleton className="w-[28%] h-3 rounded-[4px] mt-[0.4rem]" />
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Skeleton className="w-12 h-8 rounded-[6px]" />
                <Skeleton className="w-[72px] h-3 rounded-[4px] mt-[0.4rem]" />
              </div>
            </div>
            <div className="flex flex-wrap gap-[0.4rem]">
              <Skeleton className="inline-block w-[90px] h-[22px] rounded-full" />
              <Skeleton className="inline-block w-[58px] h-[22px] rounded-full" />
              <Skeleton className="inline-block w-[90px] h-[22px] rounded-full" />
            </div>
            <Skeleton className="w-full h-3 rounded-[4px]" />
            <Skeleton className="w-[70%] h-3 rounded-[4px]" />
          </div>
        ))}
      </div>

      {/* Cycling subtitle */}
      <div className="mt-10 pt-[1.4rem] border-t border-dashed border-border flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-muted-foreground italic tracking-[-0.005em] relative">
        <span className="absolute -top-px left-0 w-9 h-px bg-primary opacity-50" />
        <span className="font-serif text-[1.15rem] text-primary opacity-75 not-italic" aria-hidden="true">§</span>
        <span aria-hidden="true">Loading...</span>
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}
