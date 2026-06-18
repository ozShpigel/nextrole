import { useNavigate } from 'react-router-dom';
import { statusClass, statusDotColors, statusBadgeColors, STATUS_LABEL, type DiscoveryStatus, type StatusClass } from '../lib/discovery';

interface DiscoveryRun {
  id: string;
  status: DiscoveryStatus;
  criteria_name: string;
  jobs_scraped: number;
  jobs_scored: number;
  jobs_saved: number;
  jobs_skipped_duplicate: number;
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
  const isActive = run.status === 'scraping' || run.status === 'scoring' || run.status === 'pending';
  const num = String(index + 1).padStart(2, '0');

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
        <span className={`text-[0.62rem] font-medium py-[0.18rem] px-[0.55rem] rounded-full border tracking-[0.08em] uppercase shrink-0 ${statusBadgeColors[sCls] || ''}`}>{STATUS_LABEL[run.status] || run.status}</span>
        {isActive && (
          <button
            type="button"
            className="bg-transparent border border-[var(--ed-rule)] text-[var(--ed-ink-faint)] w-[1.5rem] h-[1.5rem] rounded-full text-[0.75rem] leading-none cursor-pointer inline-flex items-center justify-center transition-all shrink-0 hover:text-[var(--ed-no)] hover:border-[var(--ed-no)]/50"
            onClick={(e) => onAbort(run.id, e)}
            title="Abort search"
            aria-label="Abort search"
          >
            ✕
          </button>
        )}
      </div>
      <div className="flex items-center gap-[1.1rem] text-[0.78rem] pl-[calc(1.05rem+0.75rem)] flex-wrap max-[640px]:gap-3 max-[640px]:pl-0">
        <Figure value={run.jobs_scraped} label="scraped" />
        <Figure value={run.jobs_scored} label="scored" />
        <Figure value={run.jobs_saved} label="saved" />
        <Figure value={run.jobs_skipped_duplicate} label="duplicates" />
        <span className="ml-auto text-[0.7rem] text-[var(--ed-ink-faint)] tabular-nums max-[640px]:ml-0">
          {new Date(run.started_at).toLocaleString('en-US')}
        </span>
      </div>
    </div>
  );
}

interface RunsTimelineProps {
  runs: DiscoveryRun[];
  onAbort: (id: string, e: React.MouseEvent) => void;
}

export function RunsTimeline({ runs, onAbort }: RunsTimelineProps) {
  return (
    <section className="mb-[3.25rem] relative">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="ed-display italic font-semibold text-[1.5rem] tracking-[-0.01em] text-[var(--ed-ink)]">Search History</span>
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">Section 02</span>
      </div>
      <div className="border-t border-[var(--ed-rule-strong)] mb-1" />

      {runs.length === 0 ? (
        <div className="border border-dashed border-[var(--ed-rule)] mt-6 p-[2.75rem_1.5rem] text-center">
          <div className="ed-display text-[2rem] font-black text-[var(--ed-accent)] mb-2">↻</div>
          <div className="ed-display text-[1.15rem] font-semibold text-[var(--ed-ink)] mb-[0.3rem]">No searches yet</div>
          <div className="text-[var(--ed-ink-soft)] text-[0.85rem] leading-[1.6] max-w-[360px] mx-auto">
            Run your first criteria to start collecting jobs.
          </div>
        </div>
      ) : (
        <div>
          {runs.map((r, i) => (
            <DiscoveryDetail key={r.id} run={r} index={i} onAbort={onAbort} />
          ))}
        </div>
      )}
    </section>
  );
}
