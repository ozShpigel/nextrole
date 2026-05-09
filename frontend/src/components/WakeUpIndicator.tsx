interface WakeUpIndicatorProps {
  attempt: number;
  elapsed: number;
}

export default function WakeUpIndicator({ attempt, elapsed }: WakeUpIndicatorProps) {
  return (
    <div
      className="flex items-center gap-6 mt-16 mx-auto max-w-[560px] p-[1.8rem_2rem] border border-border rounded-lg shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300 max-[640px]:flex-col max-[640px]:text-center max-[640px]:p-[1.5rem_1.25rem]"
      style={{ background: 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, hsl(var(--card)) 55%, rgba(0,0,0,0.015) 100%)' }}
      role="status"
      aria-live="polite"
    >
      <div className="relative shrink-0 w-[52px] h-[52px]" aria-hidden="true">
        <span className="absolute inset-0 border border-dashed border-border rounded-full animate-spin" />
        <span className="absolute top-1/2 left-1/2 w-[7px] h-[7px] rounded-full origin-[0_0] opacity-80 animate-pulse" style={{ background: 'hsl(var(--primary))' }} />
        <span className="absolute top-1/2 left-1/2 w-[7px] h-[7px] rounded-full origin-[0_0] opacity-80 animate-pulse" style={{ background: '#3d9b85' }} />
        <span className="absolute top-1/2 left-1/2 w-[7px] h-[7px] rounded-full origin-[0_0] opacity-80 animate-pulse" style={{ background: '#8b6fc0' }} />
      </div>
      <div className="flex flex-col gap-[0.35rem] flex-1 min-w-0">
        <div className="font-serif text-[1.05rem] font-bold text-foreground tracking-[-0.005em]">Waking up the discovery service</div>
        <div className="text-[0.82rem] text-muted-foreground leading-[1.65]">
          The service was asleep (Render Free Tier). Waking up can take up to a minute — we are waiting and will retry automatically.
        </div>
        {attempt > 0 && (
          <div className="mt-1 font-mono text-[0.7rem] tracking-[0.14em] uppercase text-primary tabular-nums">
            Attempt {attempt}
            {elapsed > 0 && <span className="text-muted-foreground tracking-[0.08em]"> · {elapsed}s</span>}
          </div>
        )}
      </div>
    </div>
  );
}
