import { useId } from 'react';

// Brand mark — a rounded tile with a forward chevron: "next". The chevron is
// cut OUT of the tile with a mask rather than drawn on it in a second color,
// so it always shows whatever is behind the mark — a light tile reads as
// light-with-dark-chevron on the dark app, and the same mark inverts on a
// light background with no second variant (docs/brand/logo-option-b-chevron.png).
// useId() keeps the mask's id collision-free when several marks render on one
// page. The favicon (client/public/favicon.svg) and the link card
// (scripts/build-social-cards.cjs) draw the same geometry — change all three.
// currentColor-driven so callers set the color via a text-* class.
export function BrandMark({ size = 16, className = '' }: { size?: number; className?: string }) {
  const maskId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <mask id={maskId}>
          <rect width="64" height="64" fill="white" />
          <path d="M27 20.5 38.5 32 27 43.5" fill="none" stroke="black" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
        </mask>
      </defs>
      <rect width="64" height="64" rx="14" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
