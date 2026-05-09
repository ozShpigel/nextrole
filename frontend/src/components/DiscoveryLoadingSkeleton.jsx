import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export default function DiscoveryLoadingSkeleton() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 relative" role="status" aria-live="polite" aria-label="Loading job discovery page">
      {/* Hero preview */}
      <header className="relative mb-10 pb-[1.6rem]">
        <Skeleton className="w-[180px] h-6 rounded-full mb-[1.3rem]" aria-hidden="true" />
        <h1 className="font-serif text-[clamp(2rem,4vw,2.7rem)] font-bold text-foreground leading-[1.1] mb-[0.85rem] tracking-[-0.01em] animate-in fade-in duration-300" aria-hidden="true">
          Job Discovery
        </h1>
        <Skeleton className="h-3 rounded-[4px] mt-[0.55rem] w-[70%]" aria-hidden="true" />
        <Skeleton className="h-3 rounded-[4px] mt-[0.55rem] w-[45%]" aria-hidden="true" />
        <div className="mt-[1.6rem] h-px bg-border" aria-hidden="true" />
      </header>

      {/* Stat-strip skeleton */}
      <div className="grid grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden mb-[2.75rem] max-[640px]:grid-cols-1" aria-hidden="true">
        <div className="bg-card p-[1rem_1.25rem] flex flex-col">
          <Skeleton className="w-[58px] h-7 rounded-[4px]" />
          <Skeleton className="w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
        <div className="bg-card p-[1rem_1.25rem] flex flex-col">
          <Skeleton className="w-[58px] h-7 rounded-[4px]" />
          <Skeleton className="w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
        <div className="bg-card p-[1rem_1.25rem] flex flex-col">
          <Skeleton className="w-[58px] h-7 rounded-[4px]" />
          <Skeleton className="w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
      </div>

      {/* Section heading + card grid skeleton */}
      <div className="mb-8">
        <div className="flex items-baseline gap-[0.85rem] mb-[1.1rem]" aria-hidden="true">
          <Badge variant="outline" className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] tabular-nums border-border bg-muted/50">01</Badge>
          <Skeleton className="inline-block w-[11ch] h-[22px] rounded-[4px] align-middle" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 max-[640px]:grid-cols-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="p-[1.4rem_1.35rem_1.25rem] bg-card border border-border rounded-lg shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300"
              style={{ animationDelay: `${i * 70 + 320}ms` }}
              aria-hidden="true"
            >
              <div className="absolute top-0 left-0 w-[38px] h-[2px] opacity-35" style={{ background: 'linear-gradient(90deg, var(--primary), transparent)' }} />
              <div className="flex justify-between items-center gap-4">
                <Skeleton className="w-[55%] h-5 rounded-[4px]" />
                <Skeleton className="w-[72px] h-6 rounded-full" />
              </div>
              <div className="flex flex-wrap gap-[0.4rem] mt-[0.2rem]">
                <Skeleton className="inline-block w-[90px] h-[22px] rounded-full" />
                <Skeleton className="inline-block w-[58px] h-[22px] rounded-full" />
                <Skeleton className="inline-block w-[90px] h-[22px] rounded-full" />
              </div>
              <Skeleton className="w-full h-3 rounded-[4px]" />
            </div>
          ))}
        </div>
      </div>

      {/* Cycling subtitle */}
      <div className="mt-10 pt-[1.4rem] border-t border-dashed border-border flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-muted-foreground italic tracking-[-0.005em] relative max-[640px]:text-[0.85rem]">
        <span className="absolute -top-px left-0 w-9 h-px bg-primary opacity-50" />
        <span className="font-serif text-[1.15rem] text-primary opacity-75 not-italic" aria-hidden="true">§</span>
        <span aria-hidden="true">Loading...</span>
        <span className="sr-only">Loading page</span>
      </div>
    </div>
  );
}
