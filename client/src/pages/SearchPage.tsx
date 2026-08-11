import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useScoredJobs } from '../lib/queries';
import { useSaveJob, useDismissJob } from '../lib/mutations';
import { useDemoMode, DEMO_DISABLED_TITLE } from '../lib/queries';
import type { DiscoveredJobSummary } from '../lib/types';
import { VERDICT_LABELS } from '../lib/scoring';
import { cityOnly, formatPostedAgo, isNew } from '../lib/format';
import AnalysisCard, { edVerdictColor } from '../components/AnalysisCard';
import { CompanyAvatar } from '../components/CompanyAvatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ED_BTN = 'rounded-full border px-4 py-[0.5rem] text-[13px] font-medium transition-all disabled:opacity-50 disabled:pointer-events-none';
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

const TOOLTIP_WIDTH = 320;
const TOOLTIP_GAP = 8;

// Rendered into document.body via a portal — the row it hangs off sits
// inside a `.ed-rise` list item, and every `.ed-rise` element gets its own
// stacking context from the entry animation (animation-on-transform/opacity
// promotes a box to a stacking context), so a same-DOM-order z-index can't
// win against a later row's score painting over it. Escaping to the body
// sidesteps that entirely, and lets position be computed in real viewport
// coordinates instead of guessing at ancestor overflow.
function RationaleTooltip({ anchorRef, highlights }: { anchorRef: React.RefObject<HTMLElement | null>; highlights: string[] }) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const tip = tooltipRef.current;
    if (!anchor || !tip) return;

    const anchorRect = anchor.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Right-aligned under the anchor by default (the score sits at the row's
    // right edge); flip to the anchor's left edge if hanging left would run
    // off the viewport, then clamp so it never overflows either side.
    let left = anchorRect.right - tipRect.width;
    if (left < TOOLTIP_GAP) left = anchorRect.left;
    left = Math.min(Math.max(left, TOOLTIP_GAP), vw - tipRect.width - TOOLTIP_GAP);

    // Opens below the anchor; flips above it if there isn't room below.
    let top = anchorRect.bottom + TOOLTIP_GAP;
    if (top + tipRect.height > vh - TOOLTIP_GAP) top = anchorRect.top - TOOLTIP_GAP - tipRect.height;
    top = Math.max(TOOLTIP_GAP, top);

    setPos({ top, left });
  }, [anchorRef, highlights]);

  return createPortal(
    <div
      ref={tooltipRef}
      className="fixed z-50 pointer-events-none animate-in fade-in duration-150"
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: TOOLTIP_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
    >
      {/* Neutral shadcn tokens, not --ed-* — this renders in a portal to
          document.body, outside the .editorial subtree where --ed-* resolves
          (docs/design-system.md's portal caveat). --ed-panel there silently
          fell back to transparent, letting the rows underneath show through. */}
      <div className="bg-popover text-popover-foreground border-[0.5px] border-border p-3">
        <span className="block text-[13px] uppercase tracking-[0.14em] font-medium text-muted-foreground mb-2">
          Match Rationale
        </span>
        <ul className="list-disc pl-4 m-0 space-y-1">
          {highlights.map((h, i) => (
            <li key={i} className="text-[13px] leading-[1.5]">{h}</li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

// Hero score — the strongest element per row (40px/500, colored by band).
// Everything else on the row is neutral ink, so this is the one thing that
// pops while scanning. Hovering it reveals the green/red flags + a honest-
// assessment excerpt as a floating panel.
function MatchScore({ job }: { job: DiscoveredJobSummary }) {
  const tone = edVerdictColor(job.verdict);
  // Absent on jobs scored before this field existed — no tooltip for those,
  // rather than showing an empty box on hover.
  const highlights = job.match_analysis?.quickHighlights;
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const hasHighlights = !!highlights && highlights.length > 0;

  return (
    <div
      ref={anchorRef}
      className="relative shrink-0 flex flex-col items-end gap-[0.1rem] w-[4.5rem] text-right"
      onMouseEnter={() => hasHighlights && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="text-[40px] font-medium leading-none tabular-nums" style={{ color: tone }}>
        {job.score ?? '—'}
      </span>
      {open && hasHighlights && <RationaleTooltip anchorRef={anchorRef} highlights={highlights!} />}
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
  const clickable = !!job.match_analysis;

  function handleCardActivate(): void {
    if (clickable) onToggleExpand(job.id);
  }

  return (
    <article
      className={`ed-rise group border-b border-[var(--ed-rule)] transition-colors ${dismissed ? 'opacity-40' : ''} ${clickable ? 'cursor-pointer hover:bg-[var(--ed-panel)]/50' : ''}`}
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
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
      <div className="flex items-center gap-4 py-3 px-1">
        <CompanyAvatar name={job.company} logo={job.company_logo} size={36} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2 flex-wrap text-[13px] text-[var(--ed-ink-faint)] mb-[0.15rem] tabular-nums">
            <span className="font-medium text-[var(--ed-ink-soft)]">{job.company}</span>
            {cityOnly(job.location) && <span>{cityOnly(job.location)}</span>}
            {job.is_remote && <span>Remote</span>}
            {formatPostedAgo(job.date_posted) && <span>{formatPostedAgo(job.date_posted)}</span>}
            {isNew(job.date_posted) && (
              <span className="border border-[var(--ed-rule)] text-[var(--ed-ink-faint)] rounded-full px-[0.5rem] py-[0.05rem]">
                New
              </span>
            )}
          </div>
          <h3 className="text-[16px] font-medium leading-[1.3] text-[var(--ed-ink)] truncate">
            {job.title}
          </h3>
        </div>

        <MatchScore job={job} />

        <div className="shrink-0 flex gap-2 items-center" onClick={(e) => e.stopPropagation()}>
          {!saved && !dismissed && (
            <button type="button" disabled={demoMode} title={demoTitle} className={`${ED_BTN} border-[var(--ed-accent)] text-[var(--ed-accent)] hover:bg-[var(--ed-accent)] hover:text-[var(--ed-paper)] px-3 py-[0.4rem] disabled:cursor-not-allowed`} onClick={() => onSave(job.id)}>Add</button>
          )}
          {!saved && !dismissed && (
            <button
              type="button"
              disabled={demoMode}
              title={demoTitle ?? 'Dismiss'}
              aria-label="Dismiss"
              className="shrink-0 w-8 h-8 rounded-full border border-[var(--ed-rule)] flex items-center justify-center text-[var(--ed-ink-faint)] transition-all opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:border-[var(--ed-no)] hover:text-[var(--ed-no)] disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed"
              onClick={() => onDismiss(job.id)}
            >
              <X className="w-4 h-4" strokeWidth={2.5} />
            </button>
          )}
          {saved && <span className="text-[13px] font-medium text-[var(--ed-ink-faint)] py-[0.35rem] px-[0.6rem] border border-[var(--ed-rule)]">Added</span>}
          {dismissed && <span className="text-[13px] font-medium text-[var(--ed-ink-faint)] py-[0.35rem] px-[0.6rem] border border-[var(--ed-rule)]">Dismissed</span>}
        </div>
      </div>

      {expanded && job.match_analysis && (
        <div className="pb-6 px-1 max-w-[720px]" onClick={(e) => e.stopPropagation()}>
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
      daysBack, location, levels: [...levels], verdicts: [...verdicts], minScore,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Storage full/unavailable (e.g. private browsing) — not critical.
    }
  }, [daysBack, location, levels, verdicts, minScore]);

  const query = useMemo(() => ({
    days_back: daysBack,
    location: locationDebounced.trim() || undefined,
    actual_job_level: levels.size > 0 ? [...levels].join(',') : undefined,
    verdict: verdicts.size > 0 ? [...verdicts].join(',') : undefined,
    min_score: minScore.trim() ? Number(minScore) : undefined,
    limit: 100,
  }), [daysBack, locationDebounced, levels, verdicts, minScore]);

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
    setLevels(new Set());
    setVerdicts(new Set());
    setMinScore('');
  }

  const fieldLabel = 'text-[13px] font-medium text-[var(--ed-ink-faint)]';
  const chip = (active: boolean) =>
    `capitalize rounded-full border px-3 py-[0.35rem] text-[13px] font-medium transition-all cursor-pointer ${
      active
        ? 'border-[var(--ed-accent)] bg-[var(--ed-accent)]/10 text-[var(--ed-accent)]'
        : 'border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]'
    }`;

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1280px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">

        <header className="mb-9 relative pb-6 border-b border-[var(--ed-rule)]">
          <h1 className="font-medium text-[40px] leading-[1.1] tracking-[-0.01em] text-[var(--ed-ink)]">
            Matches
          </h1>
          <p className="mt-3 text-[var(--ed-ink-soft)] text-[16px] max-w-[620px] leading-[1.6]">
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
              <span className="text-[16px] font-medium tracking-[-0.01em] text-[var(--ed-ink)]">Filters</span>
              {jobsQuery.data && (
                <span className="text-[13px] font-medium text-[var(--ed-ink-faint)] tabular-nums">{jobsQuery.data.total} match{jobsQuery.data.total === 1 ? '' : 'es'}</span>
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

            <div className="flex flex-col gap-[0.45rem] mb-5 pt-5 border-t border-[var(--ed-rule)]">
              <span className={fieldLabel}>Discovered</span>
              <span className="text-[13px] text-[var(--ed-ink-faint)] leading-[1.5] -mt-1">How far back jobs entered your pool, not their posting date.</span>
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
              className="text-[13px] font-medium text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)] mb-5 pt-5 border-t border-[var(--ed-rule)] text-left transition-colors"
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
              <div className="mt-4 p-3 bg-[var(--ed-no)]/10 text-[var(--ed-no)] text-[13px] border border-[var(--ed-no)]/30">
                {(jobsQuery.error as Error).message}
              </div>
            )}
          </aside>

          {/* Results — 4 of 5 columns. */}
          <div className="col-span-4 min-w-0 max-[900px]:col-span-1">
            <section>
              {jobsQuery.isLoading ? (
                <p className="ed-display italic text-center text-[var(--ed-ink-faint)] py-12 text-[16px] border-t border-[var(--ed-rule-strong)]">
                  Loading matches…
                </p>
              ) : jobs.length === 0 ? (
                <p className="ed-display italic text-center text-[var(--ed-ink-faint)] py-12 text-[16px] border-t border-[var(--ed-rule-strong)]">
                  No matches — widen the date range or relax the filters.
                </p>
              ) : (
                <>
                  <div className="flex items-baseline justify-end gap-3 mb-1 pb-2 border-b border-[var(--ed-rule-strong)]">
                    <span className="text-[13px] font-medium uppercase tracking-[0.1em] text-[var(--ed-ink-faint)]">Best first</span>
                  </div>

                  <div>
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
