import { useEffect, useRef, useState } from 'react';

// Leading number (with optional decimals) + whatever trails it (e.g. "%").
// Falls through un-animated for non-numeric values like the avgScore "-"
// placeholder.
const LEADING_NUMBER = /^(-?\d+(?:\.\d+)?)(.*)$/;

// Counts up from 0 to `target` once per distinct value — a data refresh
// that lands on the same number stays put instead of re-triggering.
function useCountUp(target: number | null, decimals: number, duration = 900): string | null {
  const [display, setDisplay] = useState<string | null>(target !== null ? (0).toFixed(decimals) : null);
  const prevTarget = useRef<number | null>(null);

  useEffect(() => {
    if (target === null || prevTarget.current === target) return;
    prevTarget.current = target;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target.toFixed(decimals));
      return;
    }

    let raf = 0;
    const start = performance.now();
    function tick(now: number): void {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      setDisplay((target! * eased).toFixed(decimals));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Reset so StrictMode's dev-only mount→cleanup→mount cycle (which
      // reuses this same ref) doesn't see "already animated to this
      // target" on the real mount and skip the animation entirely.
      prevTarget.current = null;
    };
  }, [target, decimals, duration]);

  return display;
}

interface StatCardProps {
  value: string | number;
  label: string;
  index?: number;
}

export function StatCard({ value, label, index = 0 }: StatCardProps) {
  const str = String(value);
  const match = LEADING_NUMBER.exec(str);
  const target = match ? parseFloat(match[1]) : null;
  const decimals = match?.[1].includes('.') ? match[1].split('.')[1].length : 0;
  const suffix = match ? match[2] : '';
  const display = useCountUp(target, decimals);
  const rendered = target !== null ? `${display}${suffix}` : str;

  return (
    <div
      className="ed-rise group border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 py-6 px-5 relative overflow-hidden transition-all hover:border-[var(--ed-ink)] hover:-translate-y-[2px]"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span className="absolute top-0 inset-x-0 h-[2px] bg-[var(--ed-accent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="ed-display text-[2.4rem] font-black leading-none text-[var(--ed-ink)] tracking-[-0.02em] tabular-nums">{rendered}</div>
      <div className="text-[0.62rem] text-[var(--ed-ink-faint)] mt-[0.45rem] uppercase tracking-[0.18em] font-semibold">{label}</div>
    </div>
  );
}
