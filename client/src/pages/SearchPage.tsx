import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { useScoredJobs } from '../lib/queries';
import { useSaveJob, useDismissJob } from '../lib/mutations';
import { useDemoMode, DEMO_DISABLED_TITLE } from '../lib/queries';
import type { DiscoveredJobSummary } from '../lib/types';
import { VERDICT_LABELS } from '../lib/scoring';
import { cityOnly, formatPostedAgo, isNew } from '../lib/format';
import AnalysisCard, { edScoreColor } from '../components/AnalysisCard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ED_BTN = 'rounded-full border px-4 py-[0.55rem] text-[0.7rem] font-semibold uppercase tracking-[0.1em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;

// Source-agnostic (Evaluator-classified) seniority band — replaces the old
// LinkedIn-only jobspy job_level filter, same five-value vocabulary so this
// chip set needed no changes, just a different underlying field.
const JOB_LEVELS = ['entry level', 'associate', 'mid-senior level', 'director', 'executive'];

const VERDICT_ORDER = ['STRONG_YES', 'YES', 'MAYBE', 'NO', 'STRONG_NO'];

// Freshness window over discovered_at (when the job entered the pool, not its
// posting date). 60 = the pool's TTL, i.e. everything ("Any").
const DAYS_PRESETS = [
  { days: 60, label: 'Any' },
  { days: 1, label: '24h' },
  { days: 3, label: '3d' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
];

function edVerdictColor(verdict: string | null | undefined): string {
  switch (verdict) {
    case 'STRONG_YES':
    case 'YES': return 'var(--ed-yes)';
    case 'MAYBE': return 'var(--ed-gold)';
    case 'NO':
    case 'STRONG_NO': return 'var(--ed-no)';
    default: return 'var(--ed-ink-faint)';
  }
}

// Deterministic hue from the company name — used for the colored-initial
// fallback when a job has no scraped logo (or the logo URL 404s/goes stale).
function hashHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function CompanyAvatar({ name, logo }: { name: string; logo?: string | null }) {
  const [logoFailed, setLogoFailed] = useState(false);
  if (logo && !logoFailed) {
    return (
      <img
        src={logo}
        alt=""
        className="w-11 h-11 rounded-full shrink-0 object-contain border border-[var(--ed-rule)] bg-white"
        onError={() => setLogoFailed(true)}
      />
    );
  }
  const hue = hashHue(name || '?');
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <div
      className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-bold text-[0.95rem] border"
      style={{ background: `hsl(${hue} 45% 16%)`, color: `hsl(${hue} 70% 72%)`, borderColor: `hsl(${hue} 45% 32%)` }}
    >
      {initial}
    </div>
  );
}

// Circular score meter — same data AnalysisCard's hero ring shows, just in
// the corner-badge shape a card grid calls for. Hovering it reveals the
// green/red flags + a honest-assessment excerpt as a floating panel.
function MatchRing({ job }: { job: DiscoveredJobSummary }) {
  const score = job.score ?? 0;
  const tone = edScoreColor(job.score, 100);
  const r = 19;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, score)) / 100);

  return (
    <div className="relative w-11 h-11 shrink-0">
      <svg viewBox="0 0 44 44" className="w-11 h-11 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--ed-rule)" strokeWidth="3.5" />
        <circle
          cx="22" cy="22" r={r} fill="none" stroke={tone} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 500ms ease-out' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[0.72rem] font-bold tabular-nums" style={{ color: tone }}>
        {job.score ?? '—'}
      </span>
    </div>
  );
}

interface MatchCardProps {
  job: DiscoveredJobSummary;
  index: number;
  expanded: boolean;
  saved: boolean;
  dismissed: boolean;
  demoMode: boolean;
  demoTitle: string | undefined;
  onToggleExpand: (id: string) => void;
  onSave: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
}

function MatchCard({ job, index, expanded, saved, dismissed, demoMode, demoTitle, onToggleExpand, onSave, onDismiss }: MatchCardProps) {
  const tone = edVerdictColor(job.verdict);

  const clickable = !!job.match_analysis;

  function handleCardActivate(): void {
    if (clickable) onToggleExpand(job.id);
  }

  return (
    <article
      className={`ed-rise flex flex-col border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 p-5 transition-colors hover:border-[var(--ed-ink-faint)] ${expanded ? 'col-span-full' : ''} ${dismissed ? 'opacity-40' : ''} ${clickable ? 'cursor-pointer' : ''}`}
      style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-expanded={clickable ? expanded : undefined}
      onClick={handleCardActivate}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleCardActivate();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <CompanyAvatar name={job.company} logo={job.company_logo} />
          {isNew(job.date_posted) && (
            <span className="text-[0.58rem] font-bold uppercase tracking-[0.1em] text-[var(--ed-accent)] border border-[var(--ed-accent)]/40 bg-[var(--ed-accent)]/10 rounded-full px-[0.55rem] py-[0.2rem] shrink-0">
              New
            </span>
          )}
        </div>
        <div className="flex flex-col items-center gap-1 shrink-0">
          <MatchRing job={job} />
          <span className="text-[0.56rem] font-bold uppercase tracking-[0.14em]" style={{ color: tone }}>
            {VERDICT_LABELS[job.verdict ?? ''] ?? job.verdict ?? '—'}
          </span>
        </div>
      </div>

      <span className="text-[0.78rem] font-bold text-[var(--ed-accent)] mb-1 truncate">{job.company}</span>
      <div className="flex items-center gap-x-2 flex-wrap text-[0.7rem] text-[var(--ed-ink-faint)] mb-2">
        {cityOnly(job.location) && <span>{cityOnly(job.location)}</span>}
        {job.is_remote && <><span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-rule)]" /><span>Remote</span></>}
        {formatPostedAgo(job.date_posted) && <><span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-rule)]" /><span>{formatPostedAgo(job.date_posted)}</span></>}
      </div>

      <h3 className="ed-display font-semibold text-[1.05rem] leading-[1.3] tracking-[-0.01em] text-[var(--ed-ink)] mb-4 line-clamp-2 min-h-[2.6em]">
        {job.title}
      </h3>

      <div className="mt-auto flex gap-2 items-center flex-wrap" onClick={(e) => e.stopPropagation()}>
        {!saved && !dismissed && (
          <button type="button" disabled={demoMode} title={demoTitle} className={`${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)] text-[0.64rem] px-3 py-[0.45rem] disabled:cursor-not-allowed`} onClick={() => onSave(job.id)}>Add</button>
        )}
        {!saved && !dismissed && (
          <button
            type="button"
            disabled={demoMode}
            title={demoTitle ?? 'Dismiss'}
            aria-label="Dismiss"
            className="shrink-0 w-9 h-9 rounded-full border border-[var(--ed-rule)] flex items-center justify-center text-[var(--ed-no)] transition-all hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10 disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed"
            onClick={() => onDismiss(job.id)}
          >
            <X className="w-4 h-4" strokeWidth={2.5} />
          </button>
        )}
        {saved && <span className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-yes)] py-[0.35rem] px-[0.6rem] border border-[var(--ed-yes)]/40">Added</span>}
        {dismissed && <span className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-no)] py-[0.35rem] px-[0.6rem] border border-[var(--ed-no)]/40">Dismissed</span>}
      </div>

      {expanded && job.match_analysis && (
        <div className="mt-6 pt-6 border-t border-[var(--ed-rule)] max-w-[720px]" onClick={(e) => e.stopPropagation()}>
          <AnalysisCard matchAnalysisJson={job.match_analysis as unknown as Record<string, unknown>} />
        </div>
      )}
    </article>
  );
}

// Filters drive the query reactively (no "Search" button/query-time compute —
// every job is already scored, this just filters/sorts what's there). Saved/
// dismissed state is tracked locally too so a card's buttons update instantly
// without waiting on a refetch.
const STORAGE_KEY = 'nextrole:matches-filters';

interface PersistedFilters {
  daysBack: number;
  location: string;
  workSetting: 'remote' | 'hybrid' | 'onsite' | null;
  levels: string[];
  verdicts: string[];
  minScore: string;
}

function loadPersistedFilters(): PersistedFilters | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedFilters) : null;
  } catch {
    return null;
  }
}

export default function SearchPage() {
  const [persisted] = useState(loadPersistedFilters);

  const [daysBack, setDaysBack] = useState(persisted?.daysBack ?? 14);
  const [location, setLocation] = useState(persisted?.location ?? '');
  const [locationDebounced, setLocationDebounced] = useState(location);
  // jobspy only carries a remote boolean — no hybrid signal exists in our data,
  // so "Hybrid" and "On-site" both filter to is_remote=false; "Remote" is the
  // only value with a real positive signal. null = no work-setting filter.
  const [workSetting, setWorkSetting] = useState<'remote' | 'hybrid' | 'onsite' | null>(persisted?.workSetting ?? null);
  const [levels, setLevels] = useState<Set<string>>(() => new Set(persisted?.levels ?? []));
  const [verdicts, setVerdicts] = useState<Set<string>>(() => new Set(persisted?.verdicts ?? []));
  const [minScore, setMinScore] = useState(persisted?.minScore ?? '');
  const [showMoreFilters, setShowMoreFilters] = useState(
    () => (persisted?.levels.length ?? 0) > 0 || (persisted?.verdicts.length ?? 0) > 0 || !!persisted?.minScore,
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setLocationDebounced(location), 400);
    return () => clearTimeout(t);
  }, [location]);

  useEffect(() => {
    const snapshot: PersistedFilters = {
      daysBack, location, workSetting, levels: [...levels], verdicts: [...verdicts], minScore,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Storage full/unavailable (e.g. private browsing) — not critical.
    }
  }, [daysBack, location, workSetting, levels, verdicts, minScore]);

  const query = useMemo(() => ({
    days_back: daysBack,
    location: locationDebounced.trim() || undefined,
    is_remote: workSetting === null ? undefined : workSetting === 'remote',
    actual_job_level: levels.size > 0 ? [...levels].join(',') : undefined,
    verdict: verdicts.size > 0 ? [...verdicts].join(',') : undefined,
    min_score: minScore.trim() ? Number(minScore) : undefined,
    limit: 100,
  }), [daysBack, locationDebounced, workSetting, levels, verdicts, minScore]);

  const jobsQuery = useScoredJobs(query);
  const jobs = jobsQuery.data?.jobs ?? [];

  const saveJob = useSaveJob();
  const dismissJob = useDismissJob();
  const demoMode = useDemoMode();
  const demoTitle = demoMode ? DEMO_DISABLED_TITLE : undefined;

  function toggleLevel(level: string): void {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function toggleVerdict(v: string): void {
    setVerdicts((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function toggleExpand(id: string): void {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function handleSave(jobId: string): Promise<void> {
    try {
      await saveJob.mutateAsync(jobId);
      setSavedIds((prev) => new Set(prev).add(jobId));
    } catch (e) {
      alert('Save failed: ' + (e as Error).message);
    }
  }

  async function handleDismiss(jobId: string): Promise<void> {
    try {
      await dismissJob.mutateAsync(jobId);
      setDismissedIds((prev) => new Set(prev).add(jobId));
    } catch (e) {
      alert('Dismiss failed: ' + (e as Error).message);
    }
  }

  function clearFilters(): void {
    setDaysBack(14);
    setLocation('');
    setWorkSetting(null);
    setLevels(new Set());
    setVerdicts(new Set());
    setMinScore('');
  }

  const fieldLabel = 'text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--ed-ink-faint)]';
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-[0.35rem] text-[0.68rem] font-semibold uppercase tracking-[0.06em] transition-all cursor-pointer ${
      active
        ? 'border-[var(--ed-accent)] bg-[var(--ed-accent)]/10 text-[var(--ed-accent)]'
        : 'border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]'
    }`;

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1280px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">

        <header className="mb-9 relative">
          <div className="pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
            <span>Matches</span>
          </div>
          <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)] pt-4">
            Your <span className="italic font-medium text-[var(--ed-accent)]">Matches</span>
          </h1>
          <p className="mt-3 text-[var(--ed-ink-soft)] text-[0.95rem] max-w-[620px] leading-[1.6]">
            Every discovered job, scored against your profile as it's found.
          </p>
        </header>

        <div className="grid grid-cols-5 gap-8 items-start max-[900px]:grid-cols-1">

          {/* Filters — 1 of 5 columns, sticky below the global nav (h-14).
              min-w-0 matters here: without it, a grid item's default
              min-width:auto lets its widest unbreakable child (a long chip
              label) force the column past its 1/5 share, pushing the whole
              page into horizontal scroll. */}
          <aside className="ed-scroll col-span-1 min-w-0 sticky top-[4.5rem] border-t-[3px] border-double border-[var(--ed-rule-strong)] pt-6 max-h-[calc(100vh-5.5rem)] overflow-y-auto max-[900px]:static max-[900px]:max-h-none max-[900px]:overflow-visible">
            <div className="flex items-baseline justify-between gap-3 mb-5">
              <span className="ed-display italic font-semibold text-[1.15rem] tracking-[-0.01em] text-[var(--ed-ink)]">Filters</span>
              {jobsQuery.data && (
                <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--ed-ink-faint)] tabular-nums">{jobsQuery.data.total} match{jobsQuery.data.total === 1 ? '' : 'es'}</span>
              )}
            </div>

            <div className="flex flex-col gap-[0.45rem] mb-5">
              <Label htmlFor="search-location" className={fieldLabel}>Location</Label>
              <Input
                id="search-location"
                placeholder="e.g. Tel Aviv"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="rounded-lg border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink)]"
              />
            </div>

            <div className="flex flex-col gap-[0.45rem] mb-5">
              <span className={fieldLabel}>Work arrangement</span>
              <div className="flex flex-wrap gap-2">
                {(['remote', 'hybrid', 'onsite'] as const).map((setting) => (
                  <button
                    key={setting}
                    type="button"
                    className={chip(workSetting === setting)}
                    onClick={() => setWorkSetting((v) => (v === setting ? null : setting))}
                    aria-pressed={workSetting === setting}
                  >
                    {setting === 'onsite' ? 'On-site' : setting}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-[0.45rem] mb-5 pt-5 border-t border-[var(--ed-rule)]">
              <span className={fieldLabel}>Posted</span>
              <span className="text-[0.72rem] text-[var(--ed-ink-faint)] leading-[1.5] -mt-1">How far back jobs entered your pool, not their posting date.</span>
              <div className="flex flex-wrap gap-2">
                {DAYS_PRESETS.map(({ days, label }) => (
                  <button key={days} type="button" className={chip(daysBack === days)} onClick={() => setDaysBack(days)} aria-pressed={daysBack === days}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)] mb-5 pt-5 border-t border-[var(--ed-rule)] text-left transition-colors"
              onClick={() => setShowMoreFilters((v) => !v)}
              aria-expanded={showMoreFilters}
            >
              {showMoreFilters ? '− Fewer filters' : '+ More filters'}
            </button>

            {showMoreFilters && (
              <>
                <div className="flex flex-col gap-[0.45rem] mb-5">
                  <Label htmlFor="min-score" className={fieldLabel}>Min score</Label>
                  <Input
                    id="min-score"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="e.g. 70"
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                    className="rounded-lg border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink)]"
                  />
                </div>

                <div className="flex flex-col gap-[0.45rem] mb-5">
                  <span className={fieldLabel}>Verdict</span>
                  <div className="flex flex-wrap gap-2">
                    {VERDICT_ORDER.map((v) => (
                      <button key={v} type="button" className={chip(verdicts.has(v))} onClick={() => toggleVerdict(v)} aria-pressed={verdicts.has(v)}>
                        {VERDICT_LABELS[v] ?? v}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-[0.45rem] mb-6">
                  <span className={fieldLabel}>Seniority</span>
                  <div className="flex flex-wrap gap-2">
                    {JOB_LEVELS.map((level) => (
                      <button key={level} type="button" className={chip(levels.has(level))} onClick={() => toggleLevel(level)} aria-pressed={levels.has(level)}>
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="flex flex-col items-stretch gap-2 pt-5 border-t border-[var(--ed-rule-strong)]">
              <button type="button" className={ED_GHOST} onClick={clearFilters}>
                Clear filters
              </button>
            </div>
            {jobsQuery.isError && (
              <div className="mt-4 p-3 bg-[var(--ed-no)]/10 text-[var(--ed-no)] text-[0.88rem] border border-[var(--ed-no)]/30">
                {(jobsQuery.error as Error).message}
              </div>
            )}
          </aside>

          {/* Results — 4 of 5 columns. */}
          <div className="col-span-4 min-w-0 max-[900px]:col-span-1">
            <section>
              {jobsQuery.isLoading ? (
                <p className="text-center text-[var(--ed-ink-faint)] py-12 text-[0.95rem] border-t border-[var(--ed-rule-strong)]">
                  Loading matches…
                </p>
              ) : jobs.length === 0 ? (
                <p className="text-center text-[var(--ed-ink-faint)] py-12 text-[0.95rem] border-t border-[var(--ed-rule-strong)]">
                  No matches — widen the date range or relax the filters.
                </p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span className="ed-display italic font-semibold text-[1.5rem] tracking-[-0.01em] text-[var(--ed-ink)]">Matches</span>
                    <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">Best first</span>
                  </div>

                  <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
                    {jobs.map((job, idx) => (
                      <MatchCard
                        key={job.id}
                        job={job}
                        index={idx}
                        expanded={expandedId === job.id}
                        saved={savedIds.has(job.id) || !!job.saved_to_tracker}
                        dismissed={dismissedIds.has(job.id)}
                        demoMode={demoMode}
                        demoTitle={demoTitle}
                        onToggleExpand={toggleExpand}
                        onSave={handleSave}
                        onDismiss={handleDismiss}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

        </div>
      </div>
    </div>
  );
}
