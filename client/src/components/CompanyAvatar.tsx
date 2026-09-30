import { useState } from 'react';

// Deterministic hue from the company name — used for the colored-initial
// fallback when a job has no scraped logo (or the logo URL 404s/goes stale).
function hashHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash % 360;
}

// `shape="tile"` draws an app-icon rounded square instead of a circle — the
// Matches cards use it; everywhere else keeps the circle.
export function CompanyAvatar({ name, logo, size = 44, shape = 'circle' }: { name: string; logo?: string | null; size?: number; shape?: 'circle' | 'tile' }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const dim = `${size / 16}rem`;
  const round = shape === 'tile' ? 'rounded-[28%]' : 'rounded-full';
  if (logo && !logoFailed) {
    return (
      <img
        src={logo}
        alt=""
        // Tile padding in rem from the tile's own size: a percentage padding
        // resolves against the parent's width, and on a wide card row that
        // swallowed the whole 44px tile and left it blank white.
        style={{ width: dim, height: dim, padding: shape === 'tile' ? `${(size * 0.14) / 16}rem` : undefined }}
        className={`${round} shrink-0 object-contain border border-[var(--ed-rule)] bg-white`}
        onError={() => setLogoFailed(true)}
      />
    );
  }
  const hue = hashHue(name || '?');
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <div
      style={{ width: dim, height: dim, background: `hsl(${hue} 45% 16%)`, color: `hsl(${hue} 70% 72%)`, borderColor: `hsl(${hue} 45% 32%)` }}
      className={`${round} flex items-center justify-center shrink-0 font-bold border ${shape === 'tile' ? 'text-[16px]' : 'text-[0.95rem]'}`}
    >
      {initial}
    </div>
  );
}
