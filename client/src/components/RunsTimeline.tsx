import { useNavigate } from 'react-router-dom';
import { statusClass, statusDotColors, statusBadgeColors, STATUS_LABEL, ACTIVE_RUN_STATUSES, type DiscoveryStatus, type StatusClass } from '../lib/discovery';

interface DiscoveryRun {
  id: string;
  status: DiscoveryStatus;
  criteria_name: string;
  jobs_scraped: number;
  jobs_embedded?: number;
  // Historic counters — per-job scoring was retired for the RAG search flow.
  jobs_scored: number;
  jobs_saved: number;
  jobs_skipped_duplicate: number;
  // Per-search outcomes — a blocked/rate-limited run otherwise looks like a
  // quiet job market (jobspy swallows 429s and just returns fewer rows).
  searches_total?: number;
  searches_failed?: number;
  searches_empty?: number;
  started_at: string;
}

interface DiscoveryDetailProps {
  run: DiscoveryRun;
  index: number;
  onAbort: (id: string, e: React.MouseEvent) => void;
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-[0.35rem]">
      <span className="ed-display font-semibold text-[var(--ed-ink)] tabular-nums">{value}</span>
      <span className="text-[var(--ed-ink-faint)]">{label}</span>
    </span>
  );
}

function DiscoveryDetail({ run, index, onAbort }: DiscoveryDetailProps) {
  const navigate = useNavigate();
  const sCls: StatusClass = statusClass(run.status);
  const isActive = ACTIVE_RUN_STATUSES.includes(run.status);
  const num = String(index + 1).padStart(2, '0');
  const total = run.searches_total ?? 0;
  const noResult = (run.searches_failed ?? 0) + (run.searches_empty ?? 0);
  // Failed searches, or every search coming back empty, smell like a
  // rate-limit block rather than a quiet job market.
  const throttleSuspect = !isActive && total > 0
    && ((run.searches_failed ?? 0) > 0 || noResult === total);

  return (
    <div
      className="ed-rise group relative border-t border-[var(--ed-rule)] py-[0.95rem] cursor-pointer transition-colors hover:bg-[var(--ed-panel)]/60"
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={() => navigate(`/discovery/${run.id}`)}
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="ed-display text-[1.05rem] leading-none tabular-nums text-[var(--ed-ink-faint)]">{num}</span>
        <span className={`w-[8px] h-[8px] rounded-full shrink-0 ${statusDotColors[sCls] || 'bg-muted-foreground'}`} />
        <span className="ed-display font-semibold text-[var(--ed-ink)] text-[1.05rem] tracking-[-0.005em] flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap transition-colors group-hover:text-[var(--ed-accent-deep)]">{run.criteria_name}</span>
        <span className={`text-[0.6rem] font-semibold py-[0.2rem] px-[0.6rem] border rounded-full tracking-[0.1em] uppercase shrink-0 ${statusBadgeColors[sCls] || ''}`}>{STATUS_LABEL[run.status] || run.status}</span>
        {isActive && (
          <button
            type="button"
            className="bg-transparent border border-[var(--ed-rule)] text-[var(--ed-ink-faint)] w-[1.5rem] h-[1.5rem] rounded-full text-[0.75rem] leading-none cursor-pointer inline-flex items-center justify-center transition-all shrink-0 hover:text-[var(--ed-no)] hover:border-[var(--ed-no)]/50"
            onClick={(e) => onAbort(run.id, e)}
            title="Abort collection run"
            aria-label="Abort collection run"
          >
            ✕
          </button>
        )}
      </div>
      <div className="flex items-center gap-[1.1rem] text-[0.78rem] pl-[calc(1.05rem+0.75rem)] flex-wrap max-[640px]:gap-3 max-[640px]:pl-0">
        <Figure value={run.jobs_scraped} label="scraped" />
        {run.jobs_embedded != null && <Figure value={run.jobs_embedded} label="embedded" />}
        {run.jobs_scored > 0 && <Figure value={run.jobs_scored} label="scored" />}
        {run.jobs_saved > 0 && <Figure value={run.jobs_saved} label="saved" />}
        <Figure value={run.jobs_skipped_duplicate} label="duplicates" />
        <span className="ml-auto text-[0.7rem] text-[var(--ed-ink-faint)] tabular-nums max-[640px]:ml-0" title={new Date(run.started_at).toLocaleString('en-GB')}>
          {new Date(run.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {throttleSuspect && (
        <div className="mt-1 pl-[calc(1.05rem+0.75rem)] text-[0.74rem] text-[var(--ed-gold)] max-[640px]:pl-0">
          ⚠ {noResult} of {total} board queries returned nothing — possibly rate-limited by the job board
        </div>
      )}
    </div>
  );
}

interface RunsTimelineProps {
  runs: DiscoveryRun[];
  onAbort: (id: string, e: React.MouseEvent) => void;
}

// Most recent day-groups shown expanded; older days fold into "Earlier".
const VISIBLE_DAY_GROUPS = 2;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

type DayGroup = { key: string; label: string; runs: DiscoveryRun[] };

// Group by local calendar day, preserving the incoming newest-first order.
function groupByDay(runs: DiscoveryRun[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const run of runs) {
    const d = new Date(run.started_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.runs.push(run);
    else groups.push({ key, label: dayLabel(run.started_at), runs: [run] });
  }
  return groups;
}

function DayHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-[0.6rem] mt-5 mb-1">
      <span className="text-[0.64rem] uppercase tracking-[0.22em] font-semibold text-[var(--ed-ink-faint)]">{label}</span>
      <span className="text-[0.64rem] text-[var(--ed-ink-faint)]/70 tabular-nums">· {count}</span>
      <span className="flex-1 border-t border-[var(--ed-rule)] self-center" aria-hidden="true" />
    </div>
  );
}

export function RunsTimeline({ runs, onAbort }: RunsTimelineProps) {
  return (
    <section className="mb-[3.25rem] relative">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="ed-display italic font-semibold text-[1.5rem] tracking-[-0.01em] text-[var(--ed-ink)]">Collection Runs</span>
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">Section 02</span>
      </div>
      <div className="border-t border-[var(--ed-rule-strong)] mb-1" />

      {runs.length === 0 ? (
        <div className="border border-dashed border-[var(--ed-rule)] mt-6 p-[2.75rem_1.5rem] text-center">
          <div className="ed-display text-[2rem] font-black text-[var(--ed-accent)] mb-2">↻</div>
          <div className="ed-display text-[1.15rem] font-semibold text-[var(--ed-ink)] mb-[0.3rem]">No collection runs yet</div>
          <div className="text-[var(--ed-ink-soft)] text-[0.85rem] leading-[1.6] max-w-[360px] mx-auto">
            Run your first criteria to start collecting jobs.
          </div>
        </div>
      ) : (
        <RunDayGroups runs={runs} onAbort={onAbort} />
      )}
    </section>
  );
}

function RunDayGroups({ runs, onAbort }: RunsTimelineProps) {
  const groups = groupByDay(runs);
  const visible = groups.slice(0, VISIBLE_DAY_GROUPS);
  const earlier = groups.slice(VISIBLE_DAY_GROUPS);
  const earlierCount = earlier.reduce((n, g) => n + g.runs.length, 0);
  // Row numbering stays continuous across groups (newest = 01).
  let index = 0;

  const renderGroup = (g: DayGroup) => (
    <div key={g.key}>
      <DayHeader label={g.label} count={g.runs.length} />
      {g.runs.map((r) => <DiscoveryDetail key={r.id} run={r} index={index++} onAbort={onAbort} />)}
    </div>
  );

  return (
    <div>
      {visible.map(renderGroup)}
      {earlier.length > 0 && (
        <details className="mt-5 group">
          <summary className="cursor-pointer list-none inline-flex items-baseline gap-[0.6rem] py-[0.5rem] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink-soft)] transition-colors">
            <span aria-hidden="true" className="text-[0.8rem] leading-none transition-transform group-open:rotate-90">▸</span>
            <span className="text-[0.66rem] uppercase tracking-[0.24em] font-semibold">Earlier</span>
            <span className="text-[0.66rem] text-[var(--ed-ink-faint)]/70 tabular-nums">· {earlierCount} runs</span>
          </summary>
          {earlier.map(renderGroup)}
        </details>
      )}
    </div>
  );
}
