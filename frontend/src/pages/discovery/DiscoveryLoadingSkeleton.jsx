import { Badge } from '@/components/ui/badge';

export default function DiscoveryLoadingSkeleton() {
  return (
    <div className="animate-page-in-fast relative" role="status" aria-live="polite" aria-label="Loading job discovery page">
      {/* Hero preview */}
      <header className="relative mb-10 pb-[1.6rem]">
        <div className="skeleton w-[180px] h-6 rounded-full mb-[1.3rem]" aria-hidden="true" />
        <h1 className="font-serif text-[clamp(2rem,4vw,2.7rem)] font-bold text-foreground leading-[1.1] mb-[0.85rem] tracking-[-0.01em] flex flex-wrap items-baseline gap-0" aria-hidden="true">
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(0 * 55ms + 80ms)' }}>J</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(1 * 55ms + 80ms)' }}>o</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(2 * 55ms + 80ms)' }}>b</span>
          <span className="inline-block w-[0.35em]">&nbsp;</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(3 * 55ms + 80ms)' }}>D</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(4 * 55ms + 80ms)' }}>i</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(5 * 55ms + 80ms)' }}>s</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(6 * 55ms + 80ms)' }}>c</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(7 * 55ms + 80ms)' }}>o</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(8 * 55ms + 80ms)' }}>v</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(9 * 55ms + 80ms)' }}>e</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(10 * 55ms + 80ms)' }}>r</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(11 * 55ms + 80ms)' }}>y</span>
        </h1>
        <div className="skeleton h-3 rounded-[4px] mt-[0.55rem] w-[70%]" aria-hidden="true" />
        <div className="skeleton h-3 rounded-[4px] mt-[0.55rem] w-[45%]" aria-hidden="true" />
        <div className="mt-[1.6rem] h-px relative overflow-hidden bg-border" aria-hidden="true">
          <span
            className="absolute top-[-1px] bottom-[-1px] w-[28%] blur-[0.5px] shadow-[0_0_6px_rgba(0,0,0,0.15)] animate-track-sweep"
            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.25) 50%, transparent 100%)' }}
          />
        </div>
      </header>

      {/* Stat-strip skeleton */}
      <div className="grid grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden mb-[2.75rem] max-[640px]:grid-cols-1" aria-hidden="true">
        <div className="bg-card p-[1rem_1.25rem] flex flex-col">
          <div className="skeleton w-[58px] h-7 rounded-[4px]" />
          <div className="skeleton w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
        <div className="bg-card p-[1rem_1.25rem] flex flex-col">
          <div className="skeleton w-[58px] h-7 rounded-[4px]" />
          <div className="skeleton w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
        <div className="bg-card p-[1rem_1.25rem] flex flex-col">
          <div className="skeleton w-[58px] h-7 rounded-[4px]" />
          <div className="skeleton w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
      </div>

      {/* Section heading + card grid skeleton */}
      <div className="mb-8">
        <div className="flex items-baseline gap-[0.85rem] mb-[1.1rem]" aria-hidden="true">
          <Badge variant="outline" className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] tabular-nums border-border bg-muted/50">01</Badge>
          <span className="skeleton inline-block w-[11ch] h-[22px] rounded-[4px] align-middle" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 max-[640px]:grid-cols-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="p-[1.4rem_1.35rem_1.25rem] bg-card border border-border rounded-lg shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden animate-[cardRise_0.65s_cubic-bezier(0.22,1,0.36,1)_both]"
              style={{ animationDelay: `${i * 70 + 320}ms` }}
              aria-hidden="true"
            >
              <div className="absolute top-0 left-0 w-[38px] h-[2px] opacity-35" style={{ background: 'linear-gradient(90deg, var(--primary), transparent)' }} />
              <div className="flex justify-between items-center gap-4">
                <div className="skeleton w-[55%] h-5 rounded-[4px]" />
                <div className="skeleton w-[72px] h-6 rounded-full" />
              </div>
              <div className="flex flex-wrap gap-[0.4rem] mt-[0.2rem]">
                <span className="skeleton inline-block w-[90px] h-[22px] rounded-full" />
                <span className="skeleton inline-block w-[58px] h-[22px] rounded-full" />
                <span className="skeleton inline-block w-[90px] h-[22px] rounded-full" />
              </div>
              <div className="skeleton w-full h-3 rounded-[4px]" />
            </div>
          ))}
        </div>
      </div>

      {/* Cycling subtitle */}
      <div className="mt-10 pt-[1.4rem] border-t border-dashed border-border flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-muted-foreground italic tracking-[-0.005em] relative max-[640px]:text-[0.85rem]">
        <span className="absolute -top-px left-0 w-9 h-px bg-primary opacity-50" />
        <span className="font-serif text-[1.15rem] text-primary opacity-75 not-italic" aria-hidden="true">§</span>
        <span className="relative inline-block h-[1.4em] min-w-[22ch] max-[640px]:min-w-[16ch]" aria-hidden="true">
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '0s' }}>Fetching search criteria</span>
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '2s' }}>Loading recent runs</span>
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '4s' }}>Syncing with discovery service</span>
        </span>
        <span className="sr-only">Loading page</span>
      </div>
    </div>
  );
}
