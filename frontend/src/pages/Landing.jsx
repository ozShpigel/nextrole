import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const services = [
  {
    name: 'גילוי משרות',
    description: 'סריקה אוטומטית של משרות מ-LinkedIn עם דירוג והתאמה באמצעות AI.',
    path: '/discovery',
    kicker: 'Discovery',
    icon: (
      <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
        <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="21" y1="21" x2="28" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    name: 'מעקב מועמדויות',
    description: 'מעקב אחר מועמדויות לעבודה, ראיונות ועדכוני סטטוס.',
    path: '/tracker',
    kicker: 'Tracking',
    icon: (
      <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
        <rect x="5" y="6" width="22" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="5" y1="12" x2="27" y2="12" stroke="currentColor" strokeWidth="1.5" opacity="0.55"/>
        <line x1="10" y1="18" x2="22" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45"/>
        <line x1="10" y1="22" x2="18" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45"/>
      </svg>
    ),
  },
  {
    name: 'הגדרות',
    description: 'צפייה ועריכה של הפרופיל המקצועי ונתוני הקלט לניתוח Claude.',
    path: '/settings',
    kicker: 'Configuration',
    icon: (
      <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <circle cx="16" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="16" y1="3" x2="16" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="16" y1="25" x2="16" y2="29" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="3" y1="16" x2="7" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="25" y1="16" x2="29" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
];

/* SVG grain texture data URI */
const grainSvg = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export default function Landing() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLoaded(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-56px)] flex flex-col items-center p-[clamp(1.5rem,3.5vw,3rem)_clamp(1.25rem,4vw,3rem)_2rem] bg-bg-deep text-text-primary isolate overflow-x-clip">
      {/* Grain texture overlay */}
      <div
        className="fixed inset-0 z-0 opacity-[0.032] pointer-events-none mix-blend-multiply"
        style={{ backgroundImage: grainSvg, backgroundSize: '200px' }}
        aria-hidden="true"
      />

      {/* Glow orb 1 */}
      <div
        className="fixed rounded-full pointer-events-none z-0 blur-[120px] animate-glow-pulse w-[720px] h-[720px] -top-[260px] -right-[180px]"
        style={{ background: 'radial-gradient(circle, rgba(168, 130, 86, 0.1) 0%, transparent 70%)' }}
        aria-hidden="true"
      />

      {/* Glow orb 2 */}
      <div
        className="fixed rounded-full pointer-events-none z-0 blur-[120px] animate-glow-pulse w-[620px] h-[620px] -bottom-[200px] -left-[170px]"
        style={{
          background: 'radial-gradient(circle, rgba(61, 155, 133, 0.065) 0%, transparent 70%)',
          animationDelay: '-7s',
        }}
        aria-hidden="true"
      />

      {/* Editorial crop marks at viewport corners */}
      <div className="fixed inset-0 pointer-events-none z-[1]" aria-hidden="true">
        <span
          className={`absolute w-7 h-7 top-[18px] left-[18px] border-t border-l border-accent transition-opacity duration-[1200ms] ease-in-out delay-700 max-sm:w-5 max-sm:h-5 max-sm:top-3 max-sm:left-3 ${loaded ? 'opacity-[0.42]' : 'opacity-0'}`}
        />
        <span
          className={`absolute w-7 h-7 top-[18px] right-[18px] border-t border-r border-accent transition-opacity duration-[1200ms] ease-in-out delay-700 max-sm:w-5 max-sm:h-5 max-sm:top-3 max-sm:right-3 ${loaded ? 'opacity-[0.42]' : 'opacity-0'}`}
        />
        <span
          className={`absolute w-7 h-7 bottom-[18px] left-[18px] border-b border-l border-accent transition-opacity duration-[1200ms] ease-in-out delay-700 max-sm:w-5 max-sm:h-5 max-sm:bottom-3 max-sm:left-3 ${loaded ? 'opacity-[0.42]' : 'opacity-0'}`}
        />
        <span
          className={`absolute w-7 h-7 bottom-[18px] right-[18px] border-b border-r border-accent transition-opacity duration-[1200ms] ease-in-out delay-700 max-sm:w-5 max-sm:h-5 max-sm:bottom-3 max-sm:right-3 ${loaded ? 'opacity-[0.42]' : 'opacity-0'}`}
        />
      </div>

      {/* Header */}
      <header
        className={`relative z-[2] text-center mt-[clamp(2rem,7vh,5rem)] mb-[3.25rem] transition-[opacity,transform] duration-1000 ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[18px]'}`}
        style={{ transitionTimingFunction: 'ease, cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        {/* Edition ribbon */}
        <div
          className="inline-flex items-center gap-[0.55rem] font-mono text-[0.62rem] tracking-[0.32em] font-medium text-accent py-[0.42rem] px-[1.1rem] rounded-full mb-[2.25rem] backdrop-blur-[6px] uppercase tabular-nums max-md:text-[0.58rem] max-md:tracking-[0.25em]"
          style={{
            border: '1px solid rgba(168, 130, 86, 0.22)',
            background: 'rgba(168, 130, 86, 0.035)',
          }}
          dir="ltr"
        >
          <span className="text-[0.35rem] text-accent opacity-65 leading-none" aria-hidden="true">●</span>
          <span className="whitespace-nowrap">V 0.1.0 &nbsp;&middot;&nbsp; VOL. 01 &nbsp;&middot;&nbsp; MMXXVI</span>
          <span className="text-[0.35rem] text-accent opacity-65 leading-none" aria-hidden="true">●</span>
        </div>

        <h1 className="m-0 font-normal leading-none">
          <span
            className="block font-mono text-[clamp(0.78rem,1.3vw,0.95rem)] tracking-[0.45em] uppercase text-accent font-medium mb-[clamp(1rem,2vw,1.5rem)] opacity-85 px-[0.6em]"
          >
            — פלטפורמת —
          </span>
          <span
            className="inline-flex gap-[clamp(0.5rem,1.3vw,1.1rem)] items-baseline font-serif font-bold text-[clamp(3.2rem,8.5vw,6.2rem)] leading-[0.92] tracking-[-0.035em] max-md:flex-col max-md:gap-[0.3rem] max-md:items-center"
          >
            <span
              className="inline-block text-text-bright"
              style={{ textShadow: '0 1px 0 rgba(255, 255, 255, 0.5)' }}
            >
              חיפוש
            </span>
            <span
              className="relative inline-block bg-clip-text text-transparent"
              style={{
                background: 'linear-gradient(130deg, var(--color-accent) 0%, var(--color-accent-hover) 55%, #9d7d55 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              עבודה
              {/* Warm halo behind accent word */}
              <span
                className="absolute pointer-events-none -z-1 blur-[14px]"
                style={{
                  inset: '-18% -8%',
                  background: 'radial-gradient(circle, rgba(168, 130, 86, 0.12) 0%, transparent 68%)',
                }}
                aria-hidden="true"
              />
            </span>
          </span>
        </h1>

        <p className="mt-[1.85rem] mx-auto max-w-[460px] font-serif text-[clamp(0.98rem,1.5vw,1.12rem)] leading-[1.75] text-text-secondary font-normal">
          ערכת כלים חכמה לניהול חיפוש העבודה —<br className="max-md:hidden" />
          <em className="italic text-text-primary font-medium tracking-[0.005em]">מונעת בינה מלאכותית, בעיצוב מוקפד.</em>
        </p>

        {/* Ornament: dot-bar-diamond-bar-dot */}
        <div className="flex items-center justify-center gap-[0.55rem] mt-[2.25rem]" style={{ color: 'rgba(168, 130, 86, 0.5)' }} aria-hidden="true">
          <span className="w-[3px] h-[3px] rounded-full bg-current" />
          <span
            className="h-px w-[clamp(24px,5vw,44px)]"
            style={{ background: 'linear-gradient(90deg, transparent, currentColor 30%, currentColor 70%, transparent)' }}
          />
          <span className="w-1.5 h-1.5 bg-current rotate-45 opacity-[0.72]" />
          <span
            className="h-px w-[clamp(24px,5vw,44px)]"
            style={{ background: 'linear-gradient(90deg, transparent, currentColor 30%, currentColor 70%, transparent)' }}
          />
          <span className="w-[3px] h-[3px] rounded-full bg-current" />
        </div>
      </header>

      {/* TOC divider */}
      <div
        className={`relative z-[2] flex items-center gap-4 w-full max-w-[980px] mx-auto mb-[2.25rem] transition-[opacity,transform] duration-[800ms] delay-[350ms] max-md:mb-[1.75rem] ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[10px]'}`}
        style={{ transitionTimingFunction: 'ease, cubic-bezier(0.22, 1, 0.36, 1)' }}
        aria-hidden="true"
      >
        <span
          className="flex-1 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(168, 130, 86, 0.35) 40%, rgba(168, 130, 86, 0.35) 60%, transparent)' }}
        />
        <span className="font-mono text-[0.68rem] tracking-[0.28em] uppercase text-text-dim font-medium whitespace-nowrap px-1 tabular-nums max-md:text-[0.6rem] max-md:tracking-[0.22em]">
          Contents &middot; תוכן העניינים
        </span>
        <span
          className="flex-1 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(168, 130, 86, 0.35) 40%, rgba(168, 130, 86, 0.35) 60%, transparent)' }}
        />
      </div>

      {/* Cards grid */}
      <main className="relative z-[2] grid grid-cols-[repeat(auto-fit,minmax(270px,1fr))] gap-[clamp(1rem,1.5vw,1.5rem)] w-full max-w-[980px] mx-auto max-sm:grid-cols-1 max-sm:gap-[0.9rem]">
        {services.map((svc, i) => (
          <Link
            key={svc.name}
            to={svc.path}
            className={`group relative flex flex-col gap-[1.1rem] p-[1.85rem_1.75rem_1.5rem] min-h-[260px] border border-border rounded-lg no-underline overflow-hidden backdrop-blur-[18px] transition-[opacity,transform,border-color,box-shadow,background] duration-[750ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-[rgba(168,130,86,0.38)] hover:-translate-y-1 focus-visible:border-[rgba(168,130,86,0.38)] focus-visible:-translate-y-1 focus-visible:outline-none max-sm:min-h-auto max-sm:p-[1.4rem_1.3rem_1.15rem] ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
            style={{
              '--i': i,
              background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(253, 249, 242, 0.82) 100%)',
              boxShadow: '0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 1px 3px rgba(80, 60, 30, 0.04)',
              transitionDelay: `calc(var(--i) * 0.1s + 0.5s)`,
              color: 'var(--color-text-primary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 18px 40px -22px rgba(120, 90, 50, 0.22), 0 6px 14px -8px rgba(120, 90, 50, 0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 1px 3px rgba(80, 60, 30, 0.04)';
            }}
            aria-label={`${svc.name} — ${svc.description}`}
          >
            {/* Top stripe (was ::before) */}
            <span
              className="absolute top-0 inset-x-0 h-[2px] opacity-0 scale-x-[0.15] origin-center transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100 group-hover:opacity-100 group-focus-visible:scale-x-100 group-focus-visible:opacity-100 pointer-events-none"
              style={{ background: 'linear-gradient(90deg, transparent, var(--color-accent), transparent)' }}
              aria-hidden="true"
            />

            {/* Radial hover overlay (was ::after) */}
            <span
              className="absolute inset-0 opacity-0 pointer-events-none transition-opacity duration-[450ms] ease-in-out group-hover:opacity-100"
              style={{ background: 'radial-gradient(ellipse at 20% 0%, rgba(168, 130, 86, 0.06) 0%, transparent 55%)' }}
              aria-hidden="true"
            />

            {/* Card top: number + kicker */}
            <div className="flex items-baseline justify-between gap-4 mb-[0.2rem]">
              <span className="relative inline-block font-serif text-[2.4rem] font-bold leading-[0.9] text-accent tracking-[-0.02em] tabular-nums transition-[color,transform] duration-[400ms] ease-in-out max-sm:text-[2rem]">
                {String(i + 1).padStart(2, '0')}
                {/* Underline that scales on hover */}
                <span
                  className="absolute bottom-[-6px] start-0 w-7 h-px bg-accent opacity-35 origin-[inline-start] scale-x-[0.4] transition-[transform,opacity] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100 group-hover:opacity-80 group-focus-visible:scale-x-100 group-focus-visible:opacity-80"
                  aria-hidden="true"
                />
              </span>
              <span className="font-mono text-[0.62rem] tracking-[0.3em] uppercase text-text-dim font-medium pt-2" dir="ltr">
                {svc.kicker}
              </span>
            </div>

            {/* Card body */}
            <div className="flex flex-col gap-3 flex-1">
              <h2 className="font-serif text-[1.35rem] font-bold text-text-bright m-0 tracking-[-0.01em] leading-[1.25] max-sm:text-[1.2rem]">
                {svc.name}
              </h2>
              <span
                className="block w-6 h-px bg-accent opacity-50 transition-[width,opacity] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:w-14 group-hover:opacity-80 group-focus-visible:w-14 group-focus-visible:opacity-80"
                aria-hidden="true"
              />
              <p className="font-mono text-[0.85rem] text-text-secondary leading-[1.75] m-0 font-light">
                {svc.description}
              </p>
            </div>

            {/* Card foot */}
            <div
              className="flex items-center justify-between gap-3 mt-[0.35rem] pt-4"
              style={{ borderBlockStart: '1px dashed rgba(120, 100, 70, 0.14)' }}
            >
              <span className="inline-flex items-center justify-center text-text-dim opacity-75 transition-[color,opacity,transform] duration-[400ms] ease-in-out group-hover:text-accent group-hover:opacity-100 group-hover:-rotate-[4deg] group-focus-visible:text-accent group-focus-visible:opacity-100 group-focus-visible:-rotate-[4deg]" aria-hidden="true">
                {svc.icon}
              </span>
              <span className="inline-flex items-center gap-2 font-mono text-[0.78rem] font-medium text-text-secondary tracking-[0.02em] transition-[color,gap] duration-[350ms] ease-in-out group-hover:text-accent group-hover:gap-[0.8rem] group-focus-visible:text-accent group-focus-visible:gap-[0.8rem]">
                <span>המשך לקריאה</span>
                <span className="inline-flex transition-transform duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-x-1 group-focus-visible:-translate-x-1" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                    <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              </span>
            </div>

            {/* Corner ornament */}
            <span
              className="absolute -bottom-[30px] -end-[30px] w-[120px] h-[120px] rounded-full pointer-events-none opacity-0 transition-[opacity,transform] duration-500 ease-in-out group-hover:opacity-100 group-hover:scale-110 group-focus-visible:opacity-100 group-focus-visible:scale-110"
              style={{ background: 'radial-gradient(circle, rgba(168, 130, 86, 0.07) 0%, transparent 65%)' }}
              aria-hidden="true"
            />
          </Link>
        ))}
      </main>

      {/* Footer */}
      <footer
        className={`relative z-[2] mt-auto pt-[clamp(3rem,6vw,5rem)] pb-6 flex flex-col items-center gap-[0.85rem] text-text-dim transition-opacity duration-[1100ms] ease-in-out delay-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      >
        <span className="font-serif text-[1.25rem] tracking-[0.4em] font-semibold text-accent inline-flex items-center gap-[0.55rem] opacity-[0.82] max-sm:text-[1.05rem] max-sm:tracking-[0.3em]" dir="ltr" aria-hidden="true">
          <span className="text-[0.9rem] text-accent opacity-45">&middot;</span>
          J<span className="text-text-dim opacity-55 font-normal">P</span>A
          <span className="text-[0.9rem] text-accent opacity-45">&middot;</span>
        </span>
        <span className="font-mono text-[0.72rem] tracking-[0.12em] uppercase text-text-dim font-normal max-sm:text-[0.65rem]">
          &copy; 2026 &middot; פלטפורמת חיפוש עבודה &middot; Crafted with care
        </span>
      </footer>
    </div>
  );
}
