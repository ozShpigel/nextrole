import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { X, SlidersHorizontal, Plus, Check, Search } from 'lucide-react';
import { useScoredJobs, usePoolScan, usePoolBand, useScoreJobs } from '../lib/queries';
import { matchesBandFilters } from '../lib/bandFilters';
import { stableOrder } from '../lib/boardOrder';
import { useDwell } from '../lib/useDwell';
import { isCvUploadInProgress, isScoringHeld, useCvUpload } from '../lib/cvUpload';
import { useSaveJob, useDismissJob, useMarkViewed } from '../lib/mutations';
import type { DiscoveredJobSummary } from '../lib/types';
import { VERDICT_LABELS } from '../lib/scoring';
import { cityCountry, formatPostedAgo, isNew, hasRealJobUrl } from '../lib/format';
import AnalysisCard, { edVerdictColor } from '../components/AnalysisCard';
import { CompanyAvatar } from '../components/CompanyAvatar';
import { JobDescriptionText } from '../components/JobDescriptionText';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ED_BTN = 'rounded-full border px-4 py-[0.5rem] text-[13px] font-medium transition-all disabled:opacity-50 disabled:pointer-events-none';

// How many unscored cards one scroll-driven request asks for. Matches the
// server's scoring batch size, so a request is exactly one Analyst + Evaluator
// pair (~$0.05 measured) rather than a part-filled batch paying the same two
// calls for fewer jobs.
const PREFETCH_BATCH = 5;

// Scoring requests allowed in flight at once. The server bounds each request
// and the day, but without a client-side limit a reader working steadily down
// a long band opens a new request every dwell and the board's spend rate is
// set by how fast they scroll rather than by how much they read.
const MAX_IN_FLIGHT_BATCHES = 2;
// Shared by every reason the board can be empty, so they read as one voice.
const EMPTY_STATE = 'w-full ed-display italic text-center text-[var(--ed-ink-faint)] py-12 text-[16px] border-t border-[var(--ed-rule-strong)]';
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
function MatchScore({ job, align = 'end', pulse = true }: { job: DiscoveredJobSummary; align?: 'start' | 'end'; pulse?: boolean }) {
  const tone = edVerdictColor(job.verdict);

  // Not scored yet: a quiet block the size of the number, never a number.
  // Retrieval similarity is the only figure available here for free, and it
  // orders the field, not the leaderboard (+0.65 against real scores overall,
  // -0.15 within the top ten) — shown as a score it would reshuffle the moment
  // the real one arrived. The card otherwise looks exactly like a scored one,
  // so scoring happens without the board announcing it.
  if (job.score === null || job.score === undefined) {
    return (
      <div className={`relative shrink-0 flex w-[4.5rem] ${align === 'start' ? 'justify-start' : 'justify-end'}`}>
        <span
          aria-hidden="true"
          data-testid="score-placeholder"
          className={`block w-[3.25rem] h-[40px] rounded-lg ${pulse ? 'ed-shimmer' : 'bg-[var(--ed-rule)]'}`}
        />
        <span className="sr-only">Not scored yet</span>
      </div>
    );
  }

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
      <span className="text-[40px] font-medium leading-none tabular-nums animate-in fade-in duration-500" style={{ color: tone }}>
        {job.score}
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
  /** Unscored cards only: called once the card has dwelled in view, to score it. */
  onVisible?: (jobId: string) => void;
  /** False once today's scoring budget is used up: the placeholder stops pulsing. */
  pulse?: boolean;
}

// Default browse view — a full card. Clicking one switches the whole page
// into the master-detail (list + JD/analysis panel) view, it doesn't expand
// in place.
function MatchCard({ job, index, saved, dismissed, onSelect, onSave, onDismiss, onVisible, pulse }: MatchCardProps) {
  const clickable = !!job.match_analysis;

  // An unscored card asks to be scored when the reader reaches it. Not once it
  // is scored, added (the save scores it) or dismissed (× skips the call).
  const ref = useRef<HTMLElement>(null);
  const unscored = job.score === null || job.score === undefined;
  useDwell(ref, job.id, unscored && !saved && !dismissed ? onVisible : undefined);

  return (
    <article
      ref={ref}
      data-job-id={job.id}
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
        <MatchScore job={job} pulse={pulse} />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-x-2 flex-wrap text-[13px] text-[var(--ed-ink-faint)] mb-[0.15rem] tabular-nums">
          <span className="font-medium text-[var(--ed-ink-soft)]">{job.company}</span>
          {cityCountry(job.location) && <span>{cityCountry(job.location)}</span>}
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

// The card before there is anything to put on it: the upload is still being
// read, or the first retrieval has not come back. Same frame and proportions
// as MatchCard so the real cards replace these without the grid shifting.
// Every block shares one shine sweeping across the grid (.ed-shimmer), the
// same one the score slot of a card still being scored uses.
function MatchCardSkeleton({ index }: { index: number }) {
  const block = 'block ed-shimmer';
  return (
    <div
      aria-hidden="true"
      data-testid="match-card-skeleton"
      className="border border-[var(--ed-rule)] rounded-2xl p-5 flex flex-col gap-3"
      data-index={index}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`${block} w-9 h-9 rounded-full`} />
        <span className={`${block} w-[3.25rem] h-[40px] rounded-lg`} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <span className={`${block} h-[13px] w-[35%] rounded-full`} />
          <span className={`${block} h-[13px] w-[30%] rounded-full`} />
        </div>
        <span className={`${block} h-[16px] w-[85%] rounded-full`} />
        <span className={`${block} h-[16px] w-[55%] rounded-full`} />
      </div>
      <div className="mt-auto flex items-center pt-2">
        <span className={`${block} w-8 h-8 rounded-full`} />
        <span className={`${block} ml-auto w-[4.5rem] h-[34px] rounded-full`} />
      </div>
    </div>
  );
}

const SKELETON_CARDS = 10;

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
          {job.company}{cityCountry(job.location) ? ` · ${cityCountry(job.location)}` : ''}{job.is_remote ? ' · Remote' : ''}
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
            stay reachable behind a long posting (a left-card/
            right-description split). */}
        <div className="w-[38%] min-w-[320px] max-w-[440px] shrink-0 p-6">
          <div className="border border-[var(--ed-rule)] rounded-xl p-6">
            <CompanyAvatar name={job.company} logo={job.company_logo} size={52} />
            <div className="mt-4">
              <div className="flex items-center gap-x-2 flex-wrap text-[13px] text-[var(--ed-ink-faint)] mb-1">
                <span className="font-medium text-[var(--ed-ink-soft)]">{job.company}</span>
                {cityCountry(job.location) && <span>{cityCountry(job.location)}</span>}
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

  const qc = useQueryClient();
  const jobsQuery = useScoredJobs(query);
  const jobs = jobsQuery.data?.jobs ?? [];

  // Nothing is scored at ingest any more, so opening this tab is what causes
  // scoring to happen at all: narrow the shared pool against this profile,
  // score whatever has never been scored for this user, persist it.
  //
  // Once per mount, not on every filter change: a scan costs Claude calls,
  // and the filters above are a view over what has already been scored.
  // Held while a résumé upload is in flight (cvUpload.ts). Scoring waits for
  // the FULL profile, not just the essentials the board fills from: the
  // Evaluator and ClaimGrounding check claims against the whole of it.
  const upload = useCvUpload();
  const uploading = isCvUploadInProgress(upload);
  const scoringHeld = isScoringHeld(upload);
  const poolScan = usePoolScan(!scoringHeld);
  const scan = poolScan.data;
  const scanning = poolScan.isFetching;

  // Only when something was actually scored: a no-op scan (everything already
  // done) should not make the board flicker.
  const scoredCount = scan?.scored ?? 0;
  useEffect(() => {
    if (scoredCount > 0) qc.invalidateQueries({ queryKey: ['discovery', 'jobs'] });
  }, [scoredCount, qc]);
  // A capped scan means there are genuinely more candidates waiting (the
  // server only sets the flag when a further page exists). Continuing is an
  // explicit action rather than an automatic loop: the cap is a spend bound,
  // and draining it silently would defeat the point of having one.
  const moreToScore = !!scan?.capped;

  // ── The band, and scoring into it as the reader scrolls ──────────────────
  //
  // The band is the cheap half of matching (one embedding + a vector search,
  // no Claude call), so the board can show every relevant posting immediately
  // instead of only the handful the eager scan paid for. Unscored postings
  // render as quiet cards and are scored in batches of five when the reader
  // actually reaches them — which is what keeps spend proportional to how much
  // of the board someone reads, rather than to how many postings exist.
  const bandQuery = usePoolBand(!uploading);
  const scoreJobs = useScoreJobs();

  // Ids we have already sent. Not derived from the band: the band refetches
  // after each batch lands, and a card whose score has not been written yet
  // would otherwise be requested again.
  const requestedRef = useRef<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // Ids seen by the observer but not yet sent, waiting for a full batch.
  const queuedRef = useRef<string[]>([]);
  const inFlightRef = useRef(0);
  // Today's budget is gone: stop asking rather than leaving cards that look
  // like they are still loading.
  const [budgetGone, setBudgetGone] = useState(false);

  const scoredIds = useMemo(() => new Set(jobs.map((j) => j.id)), [jobs]);

  // Everything retrieved that this user has no score for, in retrieval order.
  // Cards already on the scored board are excluded rather than duplicated.
  const unscoredBand = useMemo(
    () => (bandQuery.data?.jobs ?? []).filter(
      (j) => j.score === null || j.score === undefined,
    ).filter((j) => !scoredIds.has(j.id))
      // The panel's filters, which the band otherwise arrives without.
      .filter((j) => matchesBandFilters(j, {
        levels, isRemote, location: locationDebounced, text: searchDebounced,
      })),
    [bandQuery.data, scoredIds, levels, isRemote, locationDebounced, searchDebounced],
  );

  // One board, scored and unscored together, each card staying where it was
  // first shown (boardOrder.ts). A fresh memory per query, so a filter or a
  // search re-sorts; the same one otherwise, so a score landing moves nothing.
  // Positions are only handed out once both halves have arrived: the band is
  // cheap and usually first, and remembering it before the scored jobs would
  // push every scored card below it.
  const positions = useMemo(() => new Map<string, number>(), [query]);
  const bothLoaded = !!jobsQuery.data && !!bandQuery.data;
  const board = useMemo(
    () => (bothLoaded ? stableOrder([...jobs, ...unscoredBand], positions) : [...jobs, ...unscoredBand]),
    [bothLoaded, jobs, unscoredBand, positions],
  );

  function flushQueue(): void {
    // Cards seen while the full profile is still being read stay queued, and
    // are sent by the effect below once it is saved.
    if (scoringHeld) return;
    if (inFlightRef.current >= MAX_IN_FLIGHT_BATCHES) return;

    const batch = queuedRef.current.splice(0, PREFETCH_BATCH);
    if (batch.length === 0) return;

    inFlightRef.current += 1;

    setPendingIds((prev) => new Set([...prev, ...batch]));
    scoreJobs.mutate(batch, {
      onSuccess: (result) => {
        if (result.budgetExhausted) setBudgetGone(true);
      },
      onSettled: () => {
        inFlightRef.current -= 1;
        setPendingIds((prev) => {
          const next = new Set(prev);
          for (const id of batch) next.delete(id);
          return next;
        });
      },
    });
  }

  function handleCardVisible(jobId: string): void {
    if (budgetGone) return;
    if (requestedRef.current.has(jobId)) return;
    requestedRef.current.add(jobId);
    queuedRef.current.push(jobId);

    // Send as soon as a whole batch is waiting. A part-filled batch costs the
    // same two Claude calls as a full one, so it is worth waiting for five —
    // but not forever: the tail of the band is flushed below.
    if (queuedRef.current.length >= PREFETCH_BATCH) flushQueue();
  }

  // The tail. When the reader stops somewhere that leaves fewer than a full
  // batch queued, those cards would otherwise sit unscored indefinitely.
  // The tail, and anything the concurrency limit held back. Without this, a
  // queue left under a full batch — or blocked while two requests were out —
  // would sit unscored until the reader scrolled again.
  useEffect(() => {
    if (queuedRef.current.length === 0 || budgetGone) return;
    const timer = setTimeout(() => flushQueue(), 1200);
    return () => clearTimeout(timer);
  }, [pendingIds, unscoredBand.length, budgetGone, scoringHeld]);
  const selectedJob = jobs.find((j) => j.id === selectedId) ?? null;

  // A filter change can drop the currently-selected job out of the list —
  // clear the selection rather than leaving the detail panel showing a job
  // with no corresponding highlighted row.
  useEffect(() => {
    if (selectedId && !jobs.some((j) => j.id === selectedId)) setSelectedId(null);
  }, [jobs, selectedId]);

  const saveJob = useSaveJob();
  const dismissJob = useDismissJob();
  const markViewed = useMarkViewed();

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

  // Shown as added at once. A card without a score is scored by the save
  // before it lands in Active (ScoreBeforeSave on the server), which takes
  // seconds — waiting on it here would make Add the one place the scoring
  // shows. Rolled back if the save fails.
  async function handleSave(jobId: string): Promise<void> {
    setSavedIds((prev) => new Set(prev).add(jobId));
    try {
      await saveJob.mutateAsync(jobId);
    } catch (e) {
      setSavedIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
      alert('Save failed: ' + (e as Error).message);
    }
  }

  // Opening a job's detail panel is what we count as a "view" — not the job
  // appearing in a response, and not scrolling past it. "Was it in the
  // results" is a number we already have; the one worth a field is whether a
  // score anyone paid for was ever looked at.
  //
  // Fire-and-forget, and deliberately unguarded. The server keeps only the
  // FIRST timestamp ($ifNull, not $set), so re-selecting the same job cannot
  // rewrite it and a duplicate call is a no-op — which also makes this safe
  // under StrictMode without the ref guard a mutation would normally need
  // here. A failure is swallowed: losing a view record must never interrupt
  // someone reading a job.
  function handleSelect(jobId: string | null): void {
    setSelectedId(jobId);
    if (jobId) void markViewed.mutateAsync(jobId).catch(() => {});
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

  const filtering = hasActiveFilters || searchDebounced.trim() !== '';

  const activeFilterCount =
    (daysBack !== 14 ? 1 : 0) + (location.trim() !== '' ? 1 : 0) + (isRemote !== undefined ? 1 : 0) +
    levels.size + verdicts.size + (minScore.trim() !== '' ? 1 : 0);

  const groupLabel ='text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ed-ink-faint)]';
  const pill = (active: boolean) =>
    `capitalize rounded-full border px-[9px] py-[3px] text-[12px] font-medium transition-all cursor-pointer ${
      active
        ? 'border-[var(--ed-accent)] bg-[var(--ed-accent)]/10 text-[var(--ed-accent)]'
        : 'border-[var(--ed-rule)] text-[var(--ed-ink-faint)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]'
    }`;

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1800px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">

        <header className="mb-3 relative pb-2 border-b border-[var(--ed-rule)] flex items-center justify-between gap-3">
          <h1 className="font-medium text-[24px] leading-[1.2] tracking-[-0.01em] text-[var(--ed-ink)]">
            Matches
          </h1>
          <div className="flex items-center gap-3">
            {moreToScore && !scanning && (
              <button
                type="button"
                className={`${ED_BTN} border-[var(--ed-accent)] text-[var(--ed-accent)] hover:bg-[var(--ed-accent)] hover:text-[var(--ed-paper)]`}
                onClick={() => poolScan.refetch()}
              >
                Score more
              </button>
            )}
            {filtering && bothLoaded && (
              /* Only while filtering, and one total. A scored/unscored split
                 described the machinery, not the result -- scored and unscored
                 cards now look alike on purpose. With no filter the grid is the
                 answer and a count adds nothing; with one, the count is what
                 says the filter did something. */
              <span className="text-[13px] font-medium text-[var(--ed-ink-faint)] tabular-nums">
                {board.length} result{board.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
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
              <span className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full border border-[var(--ed-rule)] bg-[var(--ed-panel)] text-[11px] font-medium text-[var(--ed-ink-faint)] tabular-nums">
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

          {upload?.phase === 'error' ? (
            <p className={EMPTY_STATE}>
              Couldn’t read your résumé: {upload.error}{' '}
              <Link to="/" className="underline underline-offset-4 hover:text-[var(--ed-ink)]">Try another file</Link>
            </p>
          ) : uploading || jobsQuery.isLoading || (board.length === 0 && (scanning || bandQuery.isLoading)) ? (
            /* Skeleton cards while there is nothing real to show: the résumé
               is being read, or the first retrieval and scores are on their
               way. They are replaced in place by real cards, whose own score
               slots then fill in as each is scored. */
            <div className="flex-1 min-w-0 flex flex-col gap-3">
              {uploading && (
                <p className="text-[13px] text-[var(--ed-ink-faint)]" role="status" aria-live="polite">
                  {upload?.phase === 'reading' ? 'Reading your résumé…' : 'Finding your matches…'}
                </p>
              )}
              <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 ${!filtersOpen ? '2xl:grid-cols-5' : ''}`}>
                {Array.from({ length: SKELETON_CARDS }, (_, i) => <MatchCardSkeleton key={i} index={i} />)}
              </div>
            </div>
          ) : board.length === 0 ? (
            /* Four different reasons the board can be empty, and they need
               different answers. Telling someone to "relax the filters" when
               they have not uploaded a CV, or when scoring is still running,
               reads as broken.
               The band is part of this test: nothing scored yet but forty
               postings retrieved is a board, not an empty state, and saying
               "no matches" there would be false. */
            scan?.profileMissing ? (
              <p className={EMPTY_STATE}>
                Upload your CV in Settings to start matching — nothing is scored until we know what you do.
              </p>
            ) : scanning ? (
              <p className={EMPTY_STATE}>
                Scoring the job pool against your profile…
              </p>
            ) : poolScan.isError ? (
              <p className={EMPTY_STATE}>
                Couldn’t score the job pool: {(poolScan.error as Error).message}
              </p>
            ) : scan?.scanInProgress ? (
              /* A scan for this user is already running (another tab, or a
                 refresh part-way through one). Without this branch the zero
                 counts fall through to "nothing lines up with your profile",
                 which tells someone their profile matches nothing while it is
                 actively being scored. */
              <p className={EMPTY_STATE}>
                Already scoring the job pool in another tab — matches will appear here as they land.
              </p>
            ) : scan && scan.alreadyScored + scan.scored === 0 ? (
              <p className={EMPTY_STATE}>
                No matches yet — nothing in the pool of {scan.poolSize} open role{scan.poolSize === 1 ? '' : 's'} lines up with your profile.
              </p>
            ) : (
              <p className={EMPTY_STATE}>
                No matches — widen the date range or relax the filters.
              </p>
            )
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
                    onSelect={handleSelect}
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
              {/* Scored and unscored in one grid, identical but for the score
                  slot. The unscored ones are the rest of the band — retrieved,
                  relevant, not yet judged — shown because retrieval is nearly
                  free and the board would otherwise look five jobs long. Each
                  scores itself when the reader reaches it. */}
              {board.map((job, idx) => (
                <MatchCard
                  key={job.id}
                  job={job}
                  index={idx}
                  saved={savedIds.has(job.id) || !!job.saved_to_tracker}
                  dismissed={dismissedIds.has(job.id)}
                  onSelect={handleSelect}
                  onSave={handleSave}
                  onDismiss={handleDismiss}
                  onVisible={handleCardVisible}
                  pulse={!budgetGone}
                />
              ))}
            </div>
          )}

        </div>

        {/* Outside the filters/grid flex row on purpose: as a sibling of the
            grid it became a flex item and squeezed the cards into one
            overlapping column. Said once, under everything. */}
        {/* Said only when it changes what the reader sees: past the daily
            budget, blank score slots stay blank until tomorrow, and without
            this they would look like scores that never arrived. */}
        {!selectedJob && budgetGone && unscoredBand.length > 0 && (
          <p className="pt-5 text-[13px] text-[var(--ed-ink-faint)] text-center">
            Today's scoring limit is reached — the {unscoredBand.length} role{unscoredBand.length === 1 ? '' : 's'} without a score get one tomorrow.
          </p>
        )}
      </div>
    </div>
  );
}
