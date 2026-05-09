import { Card } from '@/components/ui/card';
import { relativeTime } from '../utils/format';

export function StatCard({ value, label }) {
  return (
    <Card className="group py-6 px-5 text-center relative overflow-hidden transition-all hover:border-border hover:-translate-y-[3px] hover:shadow-md">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-ring opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="font-sans text-[2rem] font-bold text-foreground tracking-[-0.02em]">{value}</div>
      <div className="text-[0.78rem] text-muted-foreground mt-[0.3rem] uppercase tracking-[0.06em] font-medium">{label}</div>
    </Card>
  );
}

export function StatStrip({ criteriaCount, runsCount, lastRun }) {
  return (
    <div className="grid grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden mb-10 backdrop-blur-[8px] max-[640px]:grid-cols-1">
      <div className="bg-card p-[1rem_1.25rem] flex flex-col gap-1 transition-colors hover:bg-background">
        <span className="font-serif text-[1.55rem] font-bold text-foreground tabular-nums leading-[1.1] tracking-[-0.01em]">{criteriaCount}</span>
        <span className="text-[0.7rem] text-muted-foreground tracking-[0.12em] uppercase font-medium">Active Criteria</span>
      </div>
      <div className="bg-card p-[1rem_1.25rem] flex flex-col gap-1 transition-colors hover:bg-background">
        <span className="font-serif text-[1.55rem] font-bold text-foreground tabular-nums leading-[1.1] tracking-[-0.01em]">{runsCount}</span>
        <span className="text-[0.7rem] text-muted-foreground tracking-[0.12em] uppercase font-medium">Search History</span>
      </div>
      <div className="bg-card p-[1rem_1.25rem] flex flex-col gap-1 transition-colors hover:bg-background">
        <span className={`font-serif font-bold tabular-nums leading-[1.1] tracking-[-0.01em] ${!lastRun ? 'text-muted-foreground text-[1.1rem] font-medium' : 'text-[1.55rem] text-foreground'}`}>
          {lastRun ? relativeTime(lastRun) : '—'}
        </span>
        <span className="text-[0.7rem] text-muted-foreground tracking-[0.12em] uppercase font-medium">Last Search</span>
      </div>
    </div>
  );
}
