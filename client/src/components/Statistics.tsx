import { useStats } from '../lib/queries';
import { STATUS_LABELS } from '../lib/tracker';
import { StatCard } from './Stats';
import { STATUS_TONE } from './Status';
import { Skeleton } from '@/components/ui/skeleton';

export default function Statistics() {
  const { data: stats, isLoading } = useStats();

  if (isLoading || !stats) return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-2 gap-3 mb-6">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="border border-[var(--ed-rule)] py-6 px-5">
          <Skeleton className="w-12 h-8 rounded mb-2" />
          <Skeleton className="w-20 h-3 rounded" />
        </div>
      ))}
    </div>
  );

  const breakdown: Record<string, number> = stats.statusBreakdown || {};
  const max = Math.max(...Object.values(breakdown), 1);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-2 gap-3 mb-9">
        <StatCard value={stats.total} label="Total Applications" />
        <StatCard value={stats.applied} label="Applied" />
        <StatCard value={stats.avgScore || '-'} label="Average Score" />
        <StatCard value={`${stats.responseRate}%`} label="Response Rate" />
      </div>

      <section className="mb-4">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="ed-display italic font-semibold text-[1.4rem] tracking-[-0.01em] text-[var(--ed-ink)]">Status Breakdown</span>
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">By stage</span>
        </div>
        <div className="border-t border-[var(--ed-rule-strong)] mb-4" />
        <div>
          {Object.entries(STATUS_LABELS).map(([key, label]) => {
            const count = breakdown[key] || 0;
            const pct = (count / max * 100).toFixed(0);
            const color = STATUS_TONE[key] || 'var(--ed-ink-faint)';
            return (
              <div key={key} className="flex items-center gap-3 py-[0.45rem] border-b border-[var(--ed-rule)] last:border-b-0">
                <span className="min-w-[130px] text-[0.78rem] text-[var(--ed-ink-soft)] uppercase tracking-[0.06em] font-medium">{label}</span>
                <div className="flex-1 h-[18px] bg-[var(--ed-rule)]/40 overflow-hidden">
                  <div className="h-full transition-all duration-[800ms] flex items-center justify-end pr-2 text-[0.68rem] font-semibold text-[var(--ed-paper)]" style={{ width: `${pct}%`, background: color }}>
                    {count > 0 ? count : ''}
                  </div>
                </div>
                <span className="min-w-[26px] text-left ed-display text-[0.85rem] text-[var(--ed-ink)] tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
