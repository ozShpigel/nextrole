import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useRunDetail, useRunJobs } from '../lib/queries';
import { useSaveJob, useDismissJob, useRescoreJob } from '../lib/mutations';
import { VERDICT_LABELS } from '../lib/scoring';
import { SnapshotsModal } from '../components/Snapshots';
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

interface ScoreComponent {
  name: string;
  score: number | null;
  maxScore: number;
  reason?: string;
}

interface DimensionData {
  score: number;
  maxScore: number;
  components?: ScoreComponent[];
  [key: string]: unknown;
}

interface MatchAnalysis {
  honestAssessment?: string;
  recommendation?: {
    greenFlags?: string[];
    redFlags?: string[];
  };
  breakdown?: Record<string, DimensionData>;
}

interface BreakdownDim {
  key: string;
  label: string;
  posKey: string;
  negKey: string;
}

const BREAKDOWN_DIMS: BreakdownDim[] = [
  { key: 'technicalFit', label: 'Technical Fit', posKey: 'strengths', negKey: 'gaps' },
  { key: 'engineeringExecutionFit', label: 'Engineering Execution Fit', posKey: 'strengths', negKey: 'concerns' },
  { key: 'sustainabilityPaceFit', label: 'Sustainability & Pace Fit', posKey: 'positiveSignals', negKey: 'concerns' },
];

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

function verdictColor(verdict: string | null): string {
  if (verdict === 'STRONG_YES' || verdict === 'YES') return 'var(--ed-yes)';
  if (verdict === 'MAYBE') return 'var(--ed-gold)';
  if (verdict === 'NO' || verdict === 'STRONG_NO') return 'var(--ed-no)';
  if (verdict === 'MATCH_FAILED') return 'var(--ed-no)';
  return 'var(--ed-ink-faint)';
}

// Editorial score tint (replaces the emerald/amber/red of lib/format.scoreColor)
function edScoreColor(score: number | null | undefined, max?: number | null): string {
  if (score == null) return 'var(--ed-ink-faint)';
  const pct = max != null && max > 0 ? score / max : score / 100;
  if (pct >= 0.6) return 'var(--ed-yes)';
  if (pct >= 0.4) return 'var(--ed-gold)';
  return 'var(--ed-no)';
}

// The three scoring dimensions, in display order, for the at-a-glance meters.
const DIMENSION_METERS: { key: string; label: string }[] = [
  { key: 'technicalFit', label: 'Technical' },
  { key: 'engineeringExecutionFit', label: 'Execution' },
  { key: 'sustainabilityPaceFit', label: 'Sustainability' },
];

export default function RunDetail() {
  const { runId } = useParams<{ runId: string }>();

  // --- React Query hooks ---
  const runQuery = useRunDetail(runId!);
  const run = runQuery.data as Run | undefined;
  const isActive = run?.status === 'pending' || run?.status === 'scraping' || run?.status === 'scoring';

  const jobsQuery = useRunJobs(runId!, isActive ?? false);
  const jobs = (jobsQuery.data as DiscoveredJob[] | undefined) ?? [];

  // --- Mutation hooks ---
  const saveJobMutation = useSaveJob();
  const dismissJobMutation = useDismissJob();
  const rescoreJobMutation = useRescoreJob();

  // --- UI state ---
  const [rescoringIds, setRescoringIds] = useState<Set<string>>(() => new Set());
  const [bulkRescoring, setBulkRescoring] = useState<boolean>(false);
  const [snapshotsJob, setSnapshotsJob] = useState<DiscoveredJob | null>(null);
  const [openBreakdownIds, setOpenBreakdownIds] = useState<Set<string>>(() => new Set());

  function toggleBreakdown(id: string): void {
    setOpenBreakdownIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  if (loading) return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1040px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">
        <RunDetailLoadingSkeleton />
      </div>
    </div>
  );
  if (error) return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1040px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">
        <div className="mt-4 p-3 bg-[var(--ed-no)]/10 text-[var(--ed-no)] text-[0.88rem] border border-[var(--ed-no)]/30">{error}</div>
      </div>
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

  const statusTint = run.status === 'completed' ? 'var(--ed-yes)'
    : run.status === 'failed' ? 'var(--ed-no)'
    : 'var(--ed-gold)';

  const actionBtn = 'rounded-none border px-3 py-[0.4rem] text-[0.68rem] font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-50 disabled:pointer-events-none';
  const ghostBtn = `${actionBtn} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1040px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">

      <Link to="/discovery" className="inline-flex items-center gap-[0.3rem] text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--ed-accent)] mb-7 transition-all hover:-translate-x-[3px]">&larr; Back to Job Discovery</Link>

      {/* Run dossier masthead */}
      <header className="mb-9">
        <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
          <span style={{ color: statusTint }}>{statusMap[run.status] || run.status}</span>
          <span className="hidden sm:block">Run Dossier</span>
        </div>
        <h2 className="ed-display font-black text-[clamp(2rem,5vw,3.4rem)] leading-[0.95] tracking-[-0.02em] text-[var(--ed-ink)] pt-4 mb-4">{run.criteria_name}</h2>
        <div className="flex gap-7 flex-wrap items-baseline text-[0.8rem] font-medium text-[var(--ed-ink-soft)] tabular-nums border-t border-[var(--ed-rule-strong)] pt-3">
          <span>Scraped: {run.jobs_scraped}</span>
          <span>Scored: {run.jobs_scored}</span>
          <span>Saved: {run.jobs_saved}</span>
          <span>Duplicates: {run.jobs_skipped_duplicate}</span>
        </div>
        {isActive && <div className="mt-4 p-3 bg-[var(--ed-panel)] text-[var(--ed-ink-soft)] text-[0.88rem] border border-[var(--ed-rule)]">Processing... the page will update automatically</div>}
        {run.error && <div className="mt-4 p-3 bg-[var(--ed-no)]/10 text-[var(--ed-no)] text-[0.88rem] border border-[var(--ed-no)]/30">{run.error}</div>}
        {!isActive && failedCount > 0 && (
          <div className="mt-4 p-[0.85rem_1rem] bg-[var(--ed-no)]/[0.06] border border-[var(--ed-no)]/30 flex items-center justify-between gap-4 text-[var(--ed-no)] text-[0.88rem]">
            <span>{failedCount} jobs failed scoring — you can retry</span>
            <button
              type="button"
              onClick={rescoreAllFailed}
              disabled={bulkRescoring}
              className="shrink-0 rounded-none border border-[var(--ed-no)] px-3 py-[0.4rem] text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-no)] transition-all hover:bg-[var(--ed-no)] hover:text-[var(--ed-paper)] disabled:opacity-50"
            >
              {bulkRescoring ? 'Rescoring...' : 'Rescore All Failed'}
            </button>
          </div>
        )}
      </header>

      {/* Feed header */}
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="ed-display italic font-semibold text-[1.5rem] tracking-[-0.01em] text-[var(--ed-ink)]">Scored roles</span>
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">Analyst + Evaluator</span>
      </div>

      {visibleJobs.length === 0 && !isActive ? (
        <p className="text-center text-[var(--ed-ink-faint)] py-12 text-[0.95rem] border-t border-[var(--ed-rule-strong)]">No jobs found</p>
      ) : (
        <div>
          {visibleJobs.map((j, idx) => {
            const num = String(idx + 1).padStart(2, '0');
            const breakdown = j.match_analysis?.breakdown;
            const verdictLabel = VERDICT_LABELS[j.verdict as keyof typeof VERDICT_LABELS] || j.verdict || '-';
            return (
            <article key={j.id} className="ed-rise border-t border-[var(--ed-rule-strong)] pt-7 pb-8" style={{ animationDelay: `${idx * 80}ms` }}>
              <div className="grid grid-cols-[3rem_1fr_220px] gap-x-8 max-[820px]:grid-cols-1 max-[820px]:gap-x-0 max-[820px]:gap-y-5">
                {/* index */}
                <div className="ed-display text-[1.5rem] leading-none pt-1 tabular-nums text-[var(--ed-ink-faint)] max-[820px]:hidden">{num}</div>

                {/* main column */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--ed-ink-faint)] mb-2">
                    <span className="text-[var(--ed-accent)] font-bold normal-case tracking-[0.02em] text-[0.74rem]">{j.company}</span>
                    {j.location && <><span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-rule)]" /><span>{j.location}</span></>}
                    {j.glassdoor_data && (
                      <>
                        <span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-rule)]" />
                        <span className="inline-flex items-center gap-[0.35rem] normal-case tracking-normal text-[0.72rem]">
                          <span className="font-semibold" style={{ color: edScoreColor(j.glassdoor_data.rating, 5) }}>{j.glassdoor_data.rating.toFixed(1)} / 5</span>
                          {j.glassdoor_data.reviewCount && <span className="text-[var(--ed-ink-faint)]">({j.glassdoor_data.reviewCount.toLocaleString()} reviews)</span>}
                          {j.glassdoor_data.url && <a href={j.glassdoor_data.url} target="_blank" rel="noopener noreferrer" className="text-[var(--ed-accent)] hover:opacity-75">Glassdoor</a>}
                        </span>
                      </>
                    )}
                  </div>

                  <h3 className="ed-display font-semibold text-[clamp(1.45rem,2.6vw,2.05rem)] leading-[1.04] tracking-[-0.018em] text-[var(--ed-ink)] mb-3">{j.title}</h3>

                  {j.company_news && j.company_news.length > 0 && (
                    <details className="my-2">
                      <summary className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-ink-faint)] cursor-pointer hover:text-[var(--ed-ink)] transition-colors">
                        Company News ({j.company_news.length})
                      </summary>
                      <ul className="mt-2 pl-4 list-disc marker:text-[var(--ed-rule)]">
                        {j.company_news.map((n, i) => (
                          <li key={i} className="text-[0.78rem] text-[var(--ed-ink-soft)] leading-[1.6] mb-[0.2rem]">
                            {n.title}{n.source && <span className="text-[var(--ed-ink-faint)]"> — {n.source}</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {j.match_analysis?.honestAssessment && (
                    <div dir="rtl" className="text-[0.9rem] text-[var(--ed-ink-soft)] leading-[1.75] my-3 pr-4 border-r-2 border-[var(--ed-accent)] text-right">{j.match_analysis.honestAssessment}</div>
                  )}

                  <div className="flex gap-2 items-center mt-4 flex-wrap">
                    {j.job_url && <a href={j.job_url} target="_blank" rel="noopener noreferrer" className={ghostBtn}>View Job</a>}
                    {isRescorable(j) && (
                      <button type="button" className={ghostBtn} onClick={() => rescoreJob(j)} disabled={rescoringIds.has(j.id) || bulkRescoring}>
                        {rescoringIds.has(j.id) ? 'Scoring...' : 'Rescore'}
                      </button>
                    )}
                    {breakdown && (
                      <button type="button" className={ghostBtn} onClick={() => toggleBreakdown(j.id)}>
                        {openBreakdownIds.has(j.id) ? 'Hide Breakdown' : 'Score Breakdown'}
                      </button>
                    )}
                    {(j.evaluator_snapshot_input || j.analyst_snapshot_input) && (
                      <button type="button" className={ghostBtn} onClick={() => setSnapshotsJob(j)}>Claude Calls</button>
                    )}
                    {!j.saved_to_tracker && j.verdict && j.verdict !== 'MATCH_FAILED' && j.verdict !== 'INSUFFICIENT_DATA' && (
                      <button type="button" className={`${actionBtn} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`} onClick={() => saveJob(j.id)}>Save to Tracker</button>
                    )}
                    {j.saved_to_tracker && <span className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-yes)] py-[0.35rem] px-[0.7rem] border border-[var(--ed-yes)]/40">Saved</span>}
                    <button type="button" className={`${actionBtn} border-[var(--ed-rule)] text-[var(--ed-no)] hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10`} onClick={() => dismissJob(j.id)}>Dismiss</button>
                  </div>
                </div>

                {/* score column */}
                <aside className="border-l border-[var(--ed-rule)] pl-6 max-[820px]:border-l-0 max-[820px]:border-t max-[820px]:border-[var(--ed-rule)] max-[820px]:pl-0 max-[820px]:pt-5">
                  <div className="text-[0.58rem] font-bold uppercase tracking-[0.2em] inline-flex items-center gap-[0.45rem] mb-2" style={{ color: verdictColor(j.verdict) }}>
                    <span className="w-[7px] h-[7px] rounded-full" style={{ background: verdictColor(j.verdict) }} />
                    {verdictLabel}
                  </div>
                  {j.score != null && (
                    <div className="ed-display font-black text-[3.6rem] leading-[0.8] tracking-[-0.03em] tabular-nums flex items-baseline gap-1 text-[var(--ed-ink)]">
                      {j.score}<span className="text-[0.95rem] font-normal text-[var(--ed-ink-faint)]">/100</span>
                    </div>
                  )}
                  {breakdown && (
                    <div className="mt-5 flex flex-col gap-[0.7rem] pt-4 border-t border-[var(--ed-rule)]">
                      {DIMENSION_METERS.map((dim) => {
                        const d = breakdown[dim.key];
                        if (!d) return null;
                        const p = d.maxScore > 0 ? d.score / d.maxScore : 0;
                        return (
                          <div key={dim.key}>
                            <div className="flex justify-between items-baseline mb-[0.3rem]">
                              <span className="text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-soft)]">{dim.label}</span>
                              <span className="ed-display text-[0.78rem] tabular-nums text-[var(--ed-ink)]">{d.score} / {d.maxScore}</span>
                            </div>
                            <span className="relative block h-[3px] bg-[var(--ed-rule)] overflow-hidden">
                              <span className="ed-fill bg-[var(--ed-ink)]" style={{ ['--p' as string]: p }} />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </aside>
              </div>

              {openBreakdownIds.has(j.id) && breakdown && (
                <div className="mt-5 p-[1.25rem_1.4rem] bg-[var(--ed-panel)] border border-[var(--ed-rule)] animate-in fade-in slide-in-from-top-1 duration-200 flex flex-col gap-[1.25rem]">
                  {(() => {
                    const green = j.match_analysis?.recommendation?.greenFlags ?? [];
                    const red = j.match_analysis?.recommendation?.redFlags ?? [];
                    if (green.length === 0 && red.length === 0) return null;
                    return (
                      <div className="pb-[0.7rem] border-b border-[var(--ed-rule)]">
                        <span className="block text-[0.62rem] uppercase tracking-[0.16em] text-[var(--ed-ink-faint)] font-semibold mb-[0.6rem]">Signals</span>
                        <div className="flex flex-col gap-[0.45rem]" dir="rtl">
                          {green.map((s, i) => (
                            <div key={`g${i}`} className="flex items-start gap-[0.55rem]">
                              <span className="ed-display text-[0.95rem] font-bold leading-[1.2] text-[var(--ed-yes)] shrink-0">+</span>
                              <span className="text-[0.82rem] text-[var(--ed-ink)] leading-[1.5] text-right" dir="rtl">{s}</span>
                            </div>
                          ))}
                          {red.map((s, i) => (
                            <div key={`r${i}`} className="flex items-start gap-[0.55rem]">
                              <span className="ed-display text-[0.95rem] font-bold leading-[1.2] text-[var(--ed-no)] shrink-0">–</span>
                              <span className="text-[0.82rem] text-[var(--ed-ink)] leading-[1.5] text-right" dir="rtl">{s}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {BREAKDOWN_DIMS.map((dim) => {
                    const d = j.match_analysis!.breakdown![dim.key];
                    if (!d) return null;
                    const components = d.components ?? [];
                    const pos = (d[dim.posKey] as string[] | undefined) ?? [];
                    const neg = (d[dim.negKey] as string[] | undefined) ?? [];
                    return (
                      <div key={dim.key}>
                        <div className="flex items-baseline justify-between gap-3 mb-[0.5rem] pb-[0.4rem] border-b border-[var(--ed-rule)]">
                          <span className="text-[0.84rem] font-semibold text-[var(--ed-ink)]">{dim.label}</span>
                          <span className="ed-display text-[0.95rem] font-semibold shrink-0 tabular-nums" style={{ color: edScoreColor(d.score, d.maxScore) }}>
                            {d.score} <span className="text-[var(--ed-ink-faint)] font-normal text-[0.78rem]">/ {d.maxScore}</span>
                          </span>
                        </div>
                        {components.length > 0 ? (
                          <div className="flex flex-col gap-[0.55rem]">
                            {components.map((c, i) => (
                              <div key={i} className="flex flex-col gap-[0.12rem]">
                                <div className="flex items-baseline justify-between gap-3">
                                  <span className="text-[0.8rem] font-medium text-[var(--ed-ink)]">{c.name}</span>
                                  <span className="shrink-0 ed-display text-[0.78rem] font-semibold tabular-nums" style={{ color: edScoreColor(c.score, c.maxScore) }}>{c.score}/{c.maxScore}</span>
                                </div>
                                {c.reason && <span className="text-[0.76rem] text-[var(--ed-ink-soft)] leading-[1.5] text-right" dir="rtl">{c.reason}</span>}
                              </div>
                            ))}
                          </div>
                        ) : (pos.length > 0 || neg.length > 0) ? (
                          <div className="flex flex-wrap gap-[0.35rem]" dir="rtl">
                            {pos.map((s, i) => (
                              <span key={`p${i}`} className="text-[0.74rem] py-[0.15rem] px-[0.5rem] bg-[var(--ed-yes)]/10 text-[var(--ed-yes)] border border-[var(--ed-yes)]/25">{s}</span>
                            ))}
                            {neg.map((s, i) => (
                              <span key={`n${i}`} className="text-[0.74rem] py-[0.15rem] px-[0.5rem] bg-[var(--ed-no)]/10 text-[var(--ed-no)] border border-[var(--ed-no)]/25">{s}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[0.76rem] text-[var(--ed-ink-faint)] italic">No detailed reasons provided</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
            );
          })}
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
