import { useState } from 'react';

// Deterministic hue from the company name — used for the colored-initial
// fallback when a job has no scraped logo (or the logo URL 404s/goes stale).
function hashHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function CompanyAvatar({ name, logo, size = 44 }: { name: string; logo?: string | null; size?: number }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const dim = `${size / 16}rem`;
  if (logo && !logoFailed) {
    return (
      <img
        src={logo}
        alt=""
        style={{ width: dim, height: dim }}
        className="rounded-full shrink-0 object-contain border border-[var(--ed-rule)] bg-white"
        onError={() => setLogoFailed(true)}
      />
    );
  }
  const hue = hashHue(name || '?');
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <div
      style={{ width: dim, height: dim, background: `hsl(${hue} 45% 16%)`, color: `hsl(${hue} 70% 72%)`, borderColor: `hsl(${hue} 45% 32%)` }}
      className="rounded-full flex items-center justify-center shrink-0 font-bold text-[0.95rem] border"
    >
      {initial}
    </div>
  );
}
