import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, SlidersHorizontal, Plus, Check, Search } from 'lucide-react';
import { useScoredJobs } from '../lib/queries';
import { useSaveJob, useDismissJob } from '../lib/mutations';
import type { DiscoveredJobSummary } from '../lib/types';
import { VERDICT_LABELS } from '../lib/scoring';
import { cityOnly, formatPostedAgo, isNew, hasRealJobUrl } from '../lib/format';
import AnalysisCard, { edVerdictColor } from '../components/AnalysisCard';
import { CompanyAvatar } from '../components/CompanyAvatar';
import { JobDescriptionText } from '../components/JobDescriptionText';
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

const WORK_SETTING: { value: boolean | undefined; label: string }[] = [
  { value: undefined, label: 'Any' },
  { value: true, label: 'Remote' },
  { value: false, label: 'On-site' },
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
function MatchScore({ job, align = 'end' }: { job: DiscoveredJobSummary; align?: 'start' | 'end' }) {
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
      className={`relative shrink-0 flex flex-col gap-[0.1rem] w-[4.5rem] ${align === 'start' ? 'items-start text-left' : 'items-end text-right'}`}
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
  saved: boolean;
  dismissed: boolean;
  onSelect: (id: string) => void;
  onSave: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
}

// Default browse view — a full card. Clicking one switches the whole page
// into the master-detail (list + JD/analysis panel) view, it doesn't expand
// in place.
function MatchCard({ job, index, saved, dismissed, onSelect, onSave, onDismiss }: MatchCardProps) {
  const clickable = !!job.match_analysis;

  return (
    <article
      className={`ed-rise group border rounded-2xl p-5 flex flex-col gap-3 transition-colors ${dismissed ? 'opacity-40' : ''} border-[var(--ed-rule)] ${
        clickable ? 'cursor-pointer hover:border-[var(--ed-ink-faint)]' : ''
      }`}
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => clickable && onSelect(job.id)}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(job.id);
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <CompanyAvatar name={job.company} logo={job.company_logo} size={36} />
        <MatchScore job={job} />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-x-2 flex-wrap text-[13px] text-[var(--ed-ink-faint)] mb-[0.15rem] tabular-nums">
          <span className="font-medium text-[var(--ed-ink-soft)]">{job.company}</span>
          {cityOnly(job.location) && <span>{cityOnly(job.location)}</span>}
          {job.is_remote && <span>Remote</span>}
        </div>
        <h3 className="text-[16px] font-medium leading-[1.3] text-[var(--ed-ink)] line-clamp-2">
          {job.title}
        </h3>
        {(formatPostedAgo(job.date_posted) || isNew(job.date_posted)) && (
          <div className="flex items-center gap-x-2 flex-wrap text-[13px] text-[var(--ed-ink-faint)] mt-[0.35rem] tabular-nums">
            {formatPostedAgo(job.date_posted) && <span>{formatPostedAgo(job.date_posted)}</span>}
            {isNew(job.date_posted) && (
              <span className="border border-[var(--ed-rule)] text-[var(--ed-ink-faint)] rounded-full px-[0.5rem] py-[0.05rem]">
                New
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-auto flex gap-2 items-center pt-2" onClick={(e) => e.stopPropagation()}>
        {!saved && !dismissed && (
          <button
            type="button"
            title="Dismiss"
            aria-label="Dismiss"
            className="shrink-0 w-8 h-8 rounded-full border border-[var(--ed-rule)] flex items-center justify-center text-[var(--ed-ink-faint)] transition-all hover:border-[var(--ed-no)] hover:text-[var(--ed-no)]"
            onClick={() => onDismiss(job.id)}
          >
            <X className="w-4 h-4" strokeWidth={2.5} />
          </button>
        )}
        {!saved && !dismissed && (
          <button type="button" className={`${ED_BTN} ml-auto border-[var(--ed-accent)] text-[var(--ed-accent)] hover:bg-[var(--ed-accent)] hover:text-[var(--ed-paper)]`} onClick={() => onSave(job.id)}>Add</button>
        )}
        {saved && (
          <span className="ed-confirm ml-auto inline-flex items-center gap-[0.3rem] rounded-full border border-[var(--ed-rule)] px-4 py-[0.5rem] text-[13px] font-medium text-[var(--ed-ink-faint)]">
            <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" /> Added
          </span>
        )}
        {dismissed && <span className="ml-auto rounded-full border border-[var(--ed-rule)] px-4 py-[0.5rem] text-[13px] font-medium text-[var(--ed-ink-faint)]">Dismissed</span>}
      </div>
    </article>
  );
}

// Compact, flat score badge for list rows — same edVerdictColor() mapping as
// the 40px hero MatchScore, just small and border-only (no ring/gradient).
function CompactScoreBadge({ job }: { job: DiscoveredJobSummary }) {
  const tone = edVerdictColor(job.verdict);
  return (
    <span
      className="shrink-0 text-[13px] font-medium tabular-nums rounded-full border px-[0.5rem] py-[0.1rem]"
      style={{ color: tone, borderColor: tone }}
    >
      {job.score ?? '—'}
    </span>
  );
}

interface MatchRowProps {
  job: DiscoveredJobSummary;
  index: number;
  selected: boolean;
  saved: boolean;
  dismissed: boolean;
  onSelect: (id: string) => void;
  onSave: (jobId: string) => void;
}

// Compact row for the master list — avatar, title/company/location, score
// badge, and (per explicit product decision) a one-click Add icon so saving
// doesn't require opening the detail panel first. Dismiss is detail-only:
// it's the rarer action, one extra click there is an acceptable cost for
// keeping the row uncluttered.
function MatchRow({ job, index, selected, saved, dismissed, onSelect, onSave }: MatchRowProps) {
  return (
    <article
      className={`ed-rise flex items-center gap-3 border rounded-2xl px-3 py-[0.65rem] cursor-pointer transition-colors ${dismissed ? 'opacity-40' : ''} ${
        selected ? 'border-[var(--ed-accent)]' : 'border-[var(--ed-rule)] hover:border-[var(--ed-ink-faint)]'
      }`}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
      role="button"
      tabIndex={0}
      aria-selected={selected}
      onClick={() => onSelect(job.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(job.id);
        }
      }}
    >
      <CompanyAvatar name={job.company} logo={job.company_logo} size={28} />
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] font-medium leading-[1.3] text-[var(--ed-ink)] truncate">{job.title}</h3>
        <div className="text-[13px] text-[var(--ed-ink-faint)] truncate">
          {job.company}{cityOnly(job.location) ? ` · ${cityOnly(job.location)}` : ''}{job.is_remote ? ' · Remote' : ''}
        </div>
      </div>
      <CompactScoreBadge job={job} />
      {saved ? (
        <span className="ed-confirm shrink-0 w-7 h-7 rounded-full border border-[var(--ed-rule)] flex items-center justify-center text-[var(--ed-ink-faint)]" title="Added">
          <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
        </span>
      ) : !dismissed && (
        <button
          type="button"
          aria-label="Add"
          className="shrink-0 w-7 h-7 rounded-full border border-[var(--ed-accent)] text-[var(--ed-accent)] flex items-center justify-center transition-all hover:bg-[var(--ed-accent)] hover:text-[var(--ed-paper)]"
          onClick={(e) => { e.stopPropagation(); onSave(job.id); }}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
        </button>
      )}
    </article>
  );
}

interface MatchDetailProps {
  job: DiscoveredJobSummary;
  saved: boolean;
  dismissed: boolean;
  onClose: () => void;
  onSave: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
}

function MatchDetail({ job, saved, dismissed, onClose, onSave, onDismiss }: MatchDetailProps) {
  return (
    <>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--ed-rule)] shrink-0">
        <button
          type="button"
          aria-label="Close"
          className="shrink-0 w-8 h-8 rounded-full border border-[var(--ed-rule)] flex items-center justify-center text-[var(--ed-ink-faint)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)] transition-all"
          onClick={onClose}
        >
          <X className="w-4 h-4" strokeWidth={2.5} />
        </button>
        <div className="min-w-0 flex-1 text-[13px] text-[var(--ed-ink-faint)] truncate">
          <span className="text-[var(--ed-ink)] font-medium">{job.title}</span> · {job.company}
        </div>
        {hasRealJobUrl(job.job_url) && (
          <a href={job.job_url!} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[13px] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)] transition-colors">
            View posting ↗
          </a>
        )}
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Identity + primary actions — a compact card that hugs its own
            content (not stretched to the panel's full height, which just
            left a bordered column running down to empty space), sitting
            above the independently-scrolling description so "Add"/"Dismiss"
            stay reachable behind a long posting (dreamworkhq's
            left-card/right-description split). */}
        <div className="w-[38%] min-w-[320px] max-w-[440px] shrink-0 p-6">
          <div className="border border-[var(--ed-rule)] rounded-xl p-6">
            <CompanyAvatar name={job.company} logo={job.company_logo} size={52} />
            <div className="mt-4">
              <div className="flex items-center gap-x-2 flex-wrap text-[13px] text-[var(--ed-ink-faint)] mb-1">
                <span className="font-medium text-[var(--ed-ink-soft)]">{job.company}</span>
                {cityOnly(job.location) && <span>{cityOnly(job.location)}</span>}
                {job.is_remote && (
                  <span className="border border-[var(--ed-rule)] rounded-full px-[0.5rem] py-[0.05rem]">Remote</span>
                )}
              </div>
              <h2 className="text-[19px] font-medium leading-[1.3] text-[var(--ed-ink)] mb-1">{job.title}</h2>
              {(formatPostedAgo(job.date_posted) || isNew(job.date_posted)) && (
                <div className="flex items-center gap-x-2 flex-wrap text-[13px] text-[var(--ed-ink-faint)] tabular-nums">
                  {formatPostedAgo(job.date_posted) && <span>{formatPostedAgo(job.date_posted)}</span>}
                  {isNew(job.date_posted) && (
                    <span className="border border-[var(--ed-rule)] rounded-full px-[0.5rem] py-[0.05rem]">New</span>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-[var(--ed-rule)]">
              <MatchScore job={job} align="start" />
            </div>

            <div className="flex gap-2 mt-5">
              {!saved && !dismissed && (
                <button type="button" className={`${ED_BTN} flex-1 flex justify-center border-[var(--ed-accent)] text-[var(--ed-accent)] hover:bg-[var(--ed-accent)] hover:text-[var(--ed-paper)]`} onClick={() => onSave(job.id)}>
                  Add
                </button>
              )}
              {!saved && !dismissed && (
                <button
                  type="button"
                  title="Dismiss"
                  aria-label="Dismiss"
                  className="shrink-0 w-9 h-9 rounded-full border border-[var(--ed-rule)] flex items-center justify-center text-[var(--ed-ink-faint)] transition-all hover:border-[var(--ed-no)] hover:text-[var(--ed-no)]"
                  onClick={() => onDismiss(job.id)}
                >
                  <X className="w-4 h-4" strokeWidth={2.5} />
                </button>
              )}
              {saved && (
                <span className="ed-confirm inline-flex items-center gap-[0.3rem] rounded-full border border-[var(--ed-rule)] px-4 py-[0.5rem] text-[13px] font-medium text-[var(--ed-ink-faint)]">
                  <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" /> Added
                </span>
              )}
              {dismissed && <span className="rounded-full border border-[var(--ed-rule)] px-4 py-[0.5rem] text-[13px] font-medium text-[var(--ed-ink-faint)]">Dismissed</span>}
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto ed-scroll p-6">
          {job.description && (
            <div className="mb-9">
              <span className="block text-[13px] text-[var(--ed-ink-faint)] uppercase tracking-[0.1em] font-medium mb-3">Job Description</span>
              <JobDescriptionText text={job.description} />
            </div>
          )}

          {job.match_analysis && (
            <AnalysisCard matchAnalysisJson={job.match_analysis as unknown as Record<string, unknown>} />
          )}
        </div>
      </div>
    </>
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
  isRemote?: boolean;
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
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState(search);
  const [location, setLocation] = useState(persisted?.location ?? '');
  const [locationDebounced, setLocationDebounced] = useState(location);
  const [isRemote, setIsRemote] = useState<boolean | undefined>(persisted?.isRemote);
  const [levels, setLevels] = useState<Set<string>>(() => new Set(persisted?.levels ?? []));
  const [verdicts, setVerdicts] = useState<Set<string>>(() => new Set(persisted?.verdicts ?? []));
  const [minScore, setMinScore] = useState(persisted?.minScore ?? '');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setLocationDebounced(location), 400);
    return () => clearTimeout(t);
  }, [location]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const snapshot: PersistedFilters = {
      daysBack, location, isRemote, levels: [...levels], verdicts: [...verdicts], minScore,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Storage full/unavailable (e.g. private browsing) — not critical.
    }
  }, [daysBack, location, isRemote, levels, verdicts, minScore]);

  const query = useMemo(() => ({
    days_back: daysBack,
    q: searchDebounced.trim() || undefined,
    location: locationDebounced.trim() || undefined,
    is_remote: isRemote,
    actual_job_level: levels.size > 0 ? [...levels].join(',') : undefined,
    verdict: verdicts.size > 0 ? [...verdicts].join(',') : undefined,
    min_score: minScore.trim() ? Number(minScore) : undefined,
    limit: 100,
  }), [daysBack, searchDebounced, locationDebounced, isRemote, levels, verdicts, minScore]);

  const jobsQuery = useScoredJobs(query);
  const jobs = jobsQuery.data?.jobs ?? [];
  const selectedJob = jobs.find((j) => j.id === selectedId) ?? null;

  // A filter change can drop the currently-selected job out of the list —
  // clear the selection rather than leaving the detail panel showing a job
  // with no corresponding highlighted row.
  useEffect(() => {
    if (selectedId && !jobs.some((j) => j.id === selectedId)) setSelectedId(null);
  }, [jobs, selectedId]);

  const saveJob = useSaveJob();
  const dismissJob = useDismissJob();

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
    setIsRemote(undefined);
    setLevels(new Set());
    setVerdicts(new Set());
    setMinScore('');
  }

  const hasActiveFilters =
    daysBack !== 14 || location.trim() !== '' || isRemote !== undefined ||
    levels.size > 0 || verdicts.size > 0 || minScore.trim() !== '';

  const activeFilterCount =
    (daysBack !== 14 ? 1 : 0) + (location.trim() !== '' ? 1 : 0) + (isRemote !== undefined ? 1 : 0) +
    levels.size + verdicts.size + (minScore.trim() !== '' ? 1 : 0);

  const groupLabel ='text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ed-ink-faint)]';
  const pill = (active: boolean) =>
    `capitalize rounded-full border px-[9px] py-[3px] text-[12px] font-medium transition-all cursor-pointer ${
      active
        ? 'border-[var(--ed-accent)] text-[var(--ed-accent)]'
        : 'border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]'
    }`;

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1800px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">

        <header className="mb-3 relative pb-2 border-b border-[var(--ed-rule)] flex items-center justify-between gap-3">
          <h1 className="font-medium text-[24px] leading-[1.2] tracking-[-0.01em] text-[var(--ed-ink)]">
            Matches
          </h1>
          {jobsQuery.data && (
            <span className="text-[13px] font-medium text-[var(--ed-ink-faint)] tabular-nums">{jobsQuery.data.total} match{jobsQuery.data.total === 1 ? '' : 'es'}</span>
          )}
        </header>

        <div className="mb-5 flex items-center gap-3 max-[640px]:flex-col max-[640px]:items-stretch">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ed-ink-faint)]" aria-hidden="true" />
            <Input
              type="text"
              placeholder="Search roles, companies, skills, or keywords"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 rounded-full border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink)] pl-10"
            />
          </div>
          <button
            type="button"
            className={`${ED_GHOST} shrink-0 inline-flex items-center gap-[0.4rem]`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal size={13} aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[11px] font-medium text-[var(--ed-paper)] bg-[var(--ed-accent)] tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex gap-5 items-start max-[900px]:flex-col">

          {/* Filters — toggled by the header button, not a fixed sidebar.
              When open it's a normal flex item that pushes the results over,
              not an overlay: the list stays interactive behind it. */}
          {filtersOpen && (
            <aside className="w-[220px] shrink-0 max-[900px]:w-full border border-[var(--ed-rule)] rounded-2xl p-5">
              <div className="flex flex-col gap-[0.4rem] mb-5">
                <span className={groupLabel}>Discovered</span>
                <div className="flex flex-wrap gap-1">
                  {DAYS_PRESETS.map(({ days, label }) => (
                    <button key={days} type="button" className={pill(daysBack === days)} onClick={() => setDaysBack(days)} aria-pressed={daysBack === days}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-[0.4rem] mb-5">
                <span className={groupLabel}>Work</span>
                <div className="flex flex-wrap gap-1">
                  {WORK_SETTING.map(({ value, label }) => (
                    <button key={label} type="button" className={pill(isRemote === value)} onClick={() => setIsRemote(value)} aria-pressed={isRemote === value}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-[0.4rem] mb-5">
                <span className={groupLabel}>Verdict</span>
                <div className="flex flex-wrap gap-1">
                  {VERDICT_ORDER.map((v) => (
                    <button key={v} type="button" className={pill(verdicts.has(v))} onClick={() => toggleVerdict(v)} aria-pressed={verdicts.has(v)}>
                      {VERDICT_LABELS[v] ?? v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-[0.4rem] mb-5">
                <Label htmlFor="search-location" className={groupLabel}>Location</Label>
                <Input
                  id="search-location"
                  placeholder="e.g. Tel Aviv"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="rounded-lg border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink)]"
                />
              </div>

              <button
                type="button"
                className="text-[13px] font-medium text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)] mb-5 text-left transition-colors"
                onClick={() => setShowMoreFilters((v) => !v)}
                aria-expanded={showMoreFilters}
              >
                {showMoreFilters ? 'Less' : 'More filters'}
              </button>

              {showMoreFilters && (
                <>
                  <div className="flex flex-col gap-[0.4rem] mb-5">
                    <Label htmlFor="min-score" className={groupLabel}>Min score</Label>
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

                  <div className="flex flex-col gap-[0.4rem] mb-5">
                    <span className={groupLabel}>Seniority</span>
                    <div className="flex flex-wrap gap-1">
                      {JOB_LEVELS.map((level) => (
                        <button key={level} type="button" className={pill(levels.has(level))} onClick={() => toggleLevel(level)} aria-pressed={levels.has(level)}>
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {hasActiveFilters && (
                <div className="flex flex-col items-stretch gap-2">
                  <button type="button" className={ED_GHOST} onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              )}
            </aside>
          )}

          {jobsQuery.isError && (
            <div className="w-full mb-2 p-3 bg-[var(--ed-no)]/10 text-[var(--ed-no)] text-[13px] border border-[var(--ed-no)]/30">
              {(jobsQuery.error as Error).message}
            </div>
          )}

          {jobsQuery.isLoading ? (
            <p className="w-full ed-display italic text-center text-[var(--ed-ink-faint)] py-12 text-[16px] border-t border-[var(--ed-rule-strong)]">
              Loading matches…
            </p>
          ) : jobs.length === 0 ? (
            <p className="w-full ed-display italic text-center text-[var(--ed-ink-faint)] py-12 text-[16px] border-t border-[var(--ed-rule-strong)]">
              No matches — widen the date range or relax the filters.
            </p>
          ) : selectedJob ? (
            <>
              {/* A job is selected — master-detail view: compact list + JD/analysis panel. */}
              <div className="w-[360px] shrink-0 flex flex-col gap-2 max-[900px]:w-full">
                {jobs.map((job, idx) => (
                  <MatchRow
                    key={job.id}
                    job={job}
                    index={idx}
                    selected={selectedId === job.id}
                    saved={savedIds.has(job.id) || !!job.saved_to_tracker}
                    dismissed={dismissedIds.has(job.id)}
                    onSelect={setSelectedId}
                    onSave={handleSave}
                  />
                ))}
              </div>

              <section
                className="flex-1 min-w-0 border border-[var(--ed-rule)] rounded-2xl overflow-hidden flex flex-col
                           sticky top-14 max-h-[calc(100vh-3.5rem-2rem)]
                           max-[900px]:static max-[900px]:max-h-none max-[900px]:mt-5 max-[900px]:w-full"
              >
                <MatchDetail
                  job={selectedJob}
                  saved={savedIds.has(selectedJob.id) || !!selectedJob.saved_to_tracker}
                  dismissed={dismissedIds.has(selectedJob.id)}
                  onClose={() => setSelectedId(null)}
                  onSave={handleSave}
                  onDismiss={handleDismiss}
                />
              </section>
            </>
          ) : (
            /* Default browse view — full card grid. */
            <div className={`flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 ${!filtersOpen ? '2xl:grid-cols-5' : ''}`}>
              {jobs.map((job, idx) => (
                <MatchCard
                  key={job.id}
                  job={job}
                  index={idx}
                  saved={savedIds.has(job.id) || !!job.saved_to_tracker}
                  dismissed={dismissedIds.has(job.id)}
                  onSelect={setSelectedId}
                  onSave={handleSave}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
