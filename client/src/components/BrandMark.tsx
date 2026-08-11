import { useId } from 'react';

// Brand mark — two overlapping circles, the product's actual mechanic (job
// facets ∩ profile facets). The circles are outlines only; the overlap
// (the lens) is the filled shape. Built with a clipPath rather than a
// hand-rolled arc path — a lens drawn as two arcs is easy to get backwards
// (fills the two outer petals instead of the shared overlap), where clipping
// one full circle to the other is unambiguous. useId() keeps the clipPath's
// id collision-free across the multiple BrandMark instances that can render
// on one page.
// currentColor-driven so callers set the color via a text-* class:
// text-foreground in the neutral nav, text-[var(--ed-accent)] on editorial pages.
export function BrandMark({ size = 16, className = '' }: { size?: number; className?: string }) {
  const clipId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="24" cy="32" r="16" />
        </clipPath>
      </defs>
      <circle cx="24" cy="32" r="16" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />
      <circle cx="40" cy="32" r="16" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />
      <circle cx="40" cy="32" r="16" fill="currentColor" clipPath={`url(#${clipId})`} />
    </svg>
  );
}
