// Faceted-gem brand mark — four currentColor triangles, animated in index.css
// (.nr-gem / .nr-gem-facet). currentColor-driven so callers set the color via
// a text-* class: text-primary in the neutral nav, text-[var(--ed-accent)] on
// editorial pages.
export function BrandMark({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`nr-gem shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path className="nr-gem-facet" d="M12 2 L2 12 L12 12 Z" fill="currentColor" />
      <path className="nr-gem-facet" d="M12 2 L22 12 L12 12 Z" fill="currentColor" />
      <path className="nr-gem-facet" d="M2 12 L12 22 L12 12 Z" fill="currentColor" />
      <path className="nr-gem-facet" d="M22 12 L12 22 L12 12 Z" fill="currentColor" />
    </svg>
  );
}
