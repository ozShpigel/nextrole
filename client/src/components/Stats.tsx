import { relativeTime } from '../lib/format';

interface StatCardProps {
  value: string | number;
  label: string;
}

export function StatCard({ value, label }: StatCardProps) {
  return (
    <div className="group border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 py-6 px-5 relative overflow-hidden transition-all hover:border-[var(--ed-ink)] hover:-translate-y-[2px]">
      <span className="absolute top-0 inset-x-0 h-[2px] bg-[var(--ed-accent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="ed-display text-[2.4rem] font-black leading-none text-[var(--ed-ink)] tracking-[-0.02em] tabular-nums">{value}</div>
      <div className="text-[0.62rem] text-[var(--ed-ink-faint)] mt-[0.45rem] uppercase tracking-[0.18em] font-semibold">{label}</div>
    </div>
  );
}

interface StatStripProps {
  criteriaCount: number;
  runsCount: number;
  lastRun: string | null | undefined;
}

function StatFigure({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex flex-col gap-[0.3rem] px-6 py-1 first:pl-0 last:pr-0">
      <span className="ed-display font-black text-[2rem] leading-none tracking-[-0.02em] tabular-nums text-[var(--ed-ink)]">{value}</span>
      <span className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">{label}</span>
    </div>
  );
}

export function StatStrip({ criteriaCount, runsCount, lastRun }: StatStripProps) {
  return (
    <div className="flex items-stretch mb-11 divide-x divide-[var(--ed-rule)] max-[640px]:flex-col max-[640px]:divide-x-0 max-[640px]:divide-y max-[640px]:gap-0">
      <StatFigure value={criteriaCount} label="Active Criteria" />
      <StatFigure value={runsCount} label="Search History" />
      <StatFigure value={lastRun ? relativeTime(lastRun) : '—'} label="Last Search" />
    </div>
  );
}
