import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { statusClass, statusDotColors, statusBadgeColors, STATUS_LABEL } from '../constants/discovery';

function DiscoveryDetail({ run, index, onAbort }) {
  const navigate = useNavigate();
  const sCls = statusClass(run.status);
  const isActive = run.status === 'scraping' || run.status === 'scoring' || run.status === 'pending';

  return (
    <div className="relative mb-[0.85rem] animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: `${index * 50}ms` }}>
      <span className={`absolute top-[18px] -left-7 -ml-1 w-[11px] h-[11px] rounded-full border-2 border-background shadow-[0_0_0_1px_rgba(0,0,0,0.08)] z-[1] ${statusDotColors[sCls] || 'bg-muted-foreground'}`} />
      <Card
        className="p-[1rem_1.25rem] transition-all cursor-pointer hover:border-border hover:translate-x-[3px] hover:shadow-md hover:bg-background"
        onClick={() => navigate(`/discovery/${run.id}`)}
      >
        <div className="flex justify-between items-center gap-2 mb-2">
          <span className="font-serif font-bold text-foreground text-[1rem] tracking-[-0.005em] flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{run.criteria_name}</span>
          <span className={`text-[0.7rem] font-medium py-[0.22rem] px-[0.65rem] rounded-full border tracking-[0.06em] font-mono shrink-0 ${statusBadgeColors[sCls] || ''}`}>{STATUS_LABEL[run.status] || run.status}</span>
          {isActive && (
            <button
              type="button"
              className="bg-transparent border border-border text-muted-foreground w-[1.55rem] h-[1.55rem] rounded-full text-[0.8rem] leading-none cursor-pointer inline-flex items-center justify-center transition-all shrink-0 hover:text-red-500 hover:border-red-500/40 hover:bg-red-500/[0.06]"
              onClick={(e) => onAbort(run.id, e)}
              title="Abort search"
              aria-label="Abort search"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex gap-[1.1rem] text-[0.78rem] text-muted-foreground pt-[0.55rem] border-t border-dashed border-border flex-wrap max-[640px]:gap-2">
          <span className="inline-flex items-baseline gap-[0.35rem]">
            <span className="font-serif font-bold text-foreground tabular-nums">{run.jobs_scraped}</span>
            <span>scraped</span>
          </span>
          <span className="inline-flex items-baseline gap-[0.35rem]">
            <span className="font-serif font-bold text-foreground tabular-nums">{run.jobs_scored}</span>
            <span>scored</span>
          </span>
          <span className="inline-flex items-baseline gap-[0.35rem]">
            <span className="font-serif font-bold text-foreground tabular-nums">{run.jobs_saved}</span>
            <span>saved</span>
          </span>
          <span className="inline-flex items-baseline gap-[0.35rem]">
            <span className="font-serif font-bold text-foreground tabular-nums">{run.jobs_skipped_duplicate}</span>
            <span>duplicates</span>
          </span>
        </div>
        <div className="text-[0.72rem] text-muted-foreground mt-[0.4rem] tracking-[0.02em] tabular-nums">
          {new Date(run.started_at).toLocaleString('en-US')}
        </div>
      </Card>
    </div>
  );
}

export function RunsTimeline({ runs, onAbort }) {
  return (
    <section className="mb-[3.25rem] relative">
      <div className="flex items-baseline gap-[0.85rem] mb-[1.3rem] flex-wrap">
        <Badge variant="outline" className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] tabular-nums border-border bg-muted/50">02</Badge>
        <span className="font-serif text-[1.35rem] font-bold text-foreground tracking-[-0.005em]">Search History</span>
      </div>

      {runs.length === 0 ? (
        <Card className="border-[1.5px] border-dashed p-[2.75rem_1.5rem] text-center shadow-none">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted border border-border text-primary font-serif text-[1.5rem] font-bold mb-[0.85rem]">↻</div>
          <div className="font-serif text-[1.05rem] font-semibold text-foreground mb-[0.3rem]">No searches yet</div>
          <div className="text-muted-foreground text-[0.85rem] leading-[1.6] mb-[1.1rem] max-w-[360px] mx-auto">
            Run your first criteria to start collecting jobs.
          </div>
        </Card>
      ) : (
        <div className="relative pl-7">
          <div
            className="absolute top-2 bottom-2 left-[7px] w-px pointer-events-none"
            style={{ background: 'linear-gradient(180deg, transparent, var(--border) 10%, var(--border) 90%, transparent)' }}
          />
          {runs.map((r, i) => (
            <DiscoveryDetail key={r.id} run={r} index={i} onAbort={onAbort} />
          ))}
        </div>
      )}
    </section>
  );
}
