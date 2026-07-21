import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

interface ServiceItem {
  name: string;
  description: string;
  path: string;
  kicker: string;
  iconMotionClass: string;
  icon: React.ReactNode;
}

const services: ServiceItem[] = [
  {
    name: 'Job Discovery',
    description: 'Automated job scanning from LinkedIn with AI-powered scoring and matching.',
    path: '/discovery',
    kicker: 'Discovery',
    iconMotionClass: 'nr-icon-search',
    icon: (
      <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
        <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="21" y1="21" x2="28" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    name: 'Application Tracker',
    description: 'Track job applications, interviews, and status updates.',
    path: '/tracker',
    kicker: 'Tracking',
    iconMotionClass: 'nr-icon-track',
    icon: (
      <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
        <rect x="5" y="6" width="22" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line className="nr-scan-1" x1="5" y1="12" x2="27" y2="12" stroke="currentColor" strokeWidth="1.5" opacity="0.55"/>
        <line className="nr-scan-2" x1="10" y1="18" x2="22" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45"/>
        <line className="nr-scan-3" x1="10" y1="22" x2="18" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45"/>
      </svg>
    ),
  },
  {
    name: 'Settings',
    description: 'View and edit your professional profile and Claude analysis inputs.',
    path: '/settings',
    kicker: 'Configuration',
    iconMotionClass: 'nr-icon-gear',
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

// Cursor-follow tilt for the service cards — written directly to the DOM
// (not React state) so mousemove doesn't trigger a re-render per pixel.
function handleCardTilt(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width - 0.5;
  const py = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty('--rx', `${(-py * 6).toFixed(2)}deg`);
  el.style.setProperty('--ry', `${(px * 8).toFixed(2)}deg`);
}
function resetCardTilt(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.setProperty('--rx', '0deg');
  e.currentTarget.style.setProperty('--ry', '0deg');
}

// Scrolls the carousel's own scrollLeft directly — scrollIntoView() walks
// every scrollable ancestor up to the document, which visibly shifted the
// whole page (including the sticky nav) sideways when a dot was clicked.
function scrollToCard(container: HTMLElement | null, index: number): void {
  const card = container?.children[index] as HTMLElement | undefined;
  if (!container || !card) return;
  container.scrollTo({ left: card.offsetLeft, behavior: 'smooth' });
}

/* Below sm, the grid becomes a horizontal snap-scroll peek carousel — this
 * tracks which card is currently snapped so the position dots stay in sync.
 * A plain rAF-throttled scroll listener beats IntersectionObserver here (same
 * call as InterviewPrepPage's scrollspy): only three cards, and it degrades
 * to index 0 on a zero-width rect instead of erroring (jsdom in tests). */
function useActiveCard(containerRef: React.RefObject<HTMLElement | null>, count: number): number {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    function measure(): void {
      raf = 0;
      const containerRect = el!.getBoundingClientRect();
      if (containerRect.width === 0) return;
      let closest = 0;
      let closestDist = Infinity;
      for (let i = 0; i < count; i++) {
        const card = el!.children[i] as HTMLElement | undefined;
        if (!card) continue;
        const dist = Math.abs(card.getBoundingClientRect().left - containerRect.left);
        if (dist < closestDist) { closestDist = dist; closest = i; }
      }
      setActive(closest);
    }
    function onScroll(): void {
      if (!raf) raf = requestAnimationFrame(measure);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef, count]);
  return active;
}

export default function Landing() {
  const [loaded, setLoaded] = useState<boolean>(false);
  const cardsRef = useRef<HTMLElement | null>(null);
  const activeCard = useActiveCard(cardsRef, services.length);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLoaded(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="editorial editorial-grain home-atmosphere relative min-h-[calc(100vh-56px)] flex flex-col items-center p-[clamp(1.5rem,3.5vw,3rem)_clamp(1.25rem,4vw,3rem)_2rem] overflow-x-clip">

      {/* Masthead */}
      <header
        className={`relative z-[2] text-center mt-[clamp(2rem,7vh,5rem)] mb-[3.25rem] transition-[opacity,transform] duration-1000 ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[18px]'}`}
        style={{ transitionTimingFunction: 'ease, cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        <h1 className="m-0 font-normal leading-none">
          <span className="ed-display inline-flex gap-[clamp(0.5rem,1.3vw,1.1rem)] items-baseline font-black text-[clamp(3.2rem,8.5vw,6.4rem)] leading-[0.9] tracking-[-0.035em] max-md:flex-col max-md:gap-[0.3rem] max-md:items-center">
            <span className="inline-block text-[var(--ed-ink)]">Next</span>
            <span className="inline-block italic font-medium text-[var(--ed-accent)]">Role</span>
          </span>
        </h1>

        <p className="ed-display mt-[1.85rem] mx-auto max-w-[460px] text-[clamp(1rem,1.5vw,1.15rem)] leading-[1.75] text-[var(--ed-ink-soft)] font-normal">
          A smart toolkit to manage your job search —<br className="max-md:hidden" />
          <em className="italic text-[var(--ed-ink)] font-medium tracking-[0.005em]">AI-powered, thoughtfully designed.</em>
        </p>

        {/* Ornament: dot-bar-diamond-bar-dot */}
        <div className="flex items-center justify-center gap-[0.55rem] mt-[2.25rem] text-[var(--ed-rule)]" aria-hidden="true">
          <span className="w-[3px] h-[3px] rounded-full bg-current" />
          <span className="h-px w-[clamp(24px,5vw,44px)]" style={{ background: 'linear-gradient(90deg, transparent, currentColor 30%, currentColor 70%, transparent)' }} />
          <span className="w-1.5 h-1.5 bg-[var(--ed-accent)] nr-ornament-diamond" />
          <span className="h-px w-[clamp(24px,5vw,44px)]" style={{ background: 'linear-gradient(90deg, transparent, currentColor 30%, currentColor 70%, transparent)' }} />
          <span className="w-[3px] h-[3px] rounded-full bg-current" />
        </div>
      </header>

      {/* TOC divider */}
      <div
        className={`relative z-[2] flex items-center gap-4 w-full max-w-[980px] mx-auto mb-[2.25rem] transition-[opacity,transform] duration-[800ms] delay-[350ms] max-md:mb-[1.75rem] ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[10px]'}`}
        style={{ transitionTimingFunction: 'ease, cubic-bezier(0.22, 1, 0.36, 1)' }}
        aria-hidden="true"
      >
        <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--ed-rule) 40%, var(--ed-rule) 60%, transparent)' }} />
        <span className="text-[0.66rem] tracking-[0.28em] uppercase text-[var(--ed-ink-faint)] font-semibold whitespace-nowrap px-1 tabular-nums max-md:text-[0.58rem] max-md:tracking-[0.22em]">
          Contents &middot; Table of Contents
        </span>
        <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--ed-rule) 40%, var(--ed-rule) 60%, transparent)' }} />
      </div>

      {/* Cards grid — below sm, becomes a horizontal snap-scroll peek
          carousel (each card ~86% wide so the next one peeks at the edge,
          hinting it's swipeable without needing a separate arrow/label) */}
      <main
        ref={cardsRef}
        className="nr-card-row relative z-[2] grid grid-cols-[repeat(auto-fit,minmax(270px,1fr))] gap-[clamp(1rem,1.5vw,1.5rem)] w-full max-w-[980px] mx-auto max-sm:flex max-sm:gap-3 max-sm:overflow-x-auto max-sm:snap-x max-sm:snap-mandatory max-sm:pb-1"
      >
        {services.map((svc, i) => (
          <Link
            key={svc.name}
            to={svc.path}
            className={`group no-underline transition-[opacity,transform] duration-[750ms] ease-[cubic-bezier(0.22,1,0.36,1)] max-sm:shrink-0 max-sm:w-[86%] max-sm:snap-start ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
            style={{ '--i': i, transitionDelay: `calc(var(--i) * 0.1s + 0.5s)` } as React.CSSProperties}
            aria-label={`${svc.name} — ${svc.description}`}
          >
            <article
              className="nr-tilt-card relative flex flex-col gap-[1.1rem] min-h-[260px] border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 transition-[border-color] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-[var(--ed-ink)] focus-visible:border-[var(--ed-ink)] max-sm:min-h-0"
              onMouseMove={handleCardTilt}
              onMouseLeave={resetCardTilt}
            >
              {/* Top stripe */}
              <span
                className="absolute top-0 inset-x-0 h-[2px] bg-[var(--ed-accent)] opacity-0 scale-x-[0.15] origin-center transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100 group-hover:opacity-100 group-focus-visible:scale-x-100 group-focus-visible:opacity-100 pointer-events-none"
                aria-hidden="true"
              />

              <div className="p-[1.85rem_1.75rem_0] max-sm:p-[1.4rem_1.3rem_0]">
                <div className="flex items-baseline justify-between gap-4 mb-[0.2rem]">
                  <span className="relative ed-display inline-block text-[2.6rem] font-black leading-[0.85] text-[var(--ed-accent)] tracking-[-0.02em] tabular-nums max-sm:text-[2.1rem]">
                    {String(i + 1).padStart(2, '0')}
                    <span className="absolute bottom-[-6px] left-0 w-7 h-px bg-[var(--ed-accent)] opacity-40 origin-left scale-x-[0.4] transition-[transform,opacity] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100 group-hover:opacity-90 group-focus-visible:scale-x-100" aria-hidden="true" />
                  </span>
                  <span className="text-[0.6rem] tracking-[0.2em] uppercase text-[var(--ed-ink-faint)] font-semibold">
                    {svc.kicker}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 flex-1 p-[0_1.75rem] max-sm:p-[0_1.3rem]">
                <h2 className="ed-display text-[1.5rem] font-semibold text-[var(--ed-ink)] tracking-[-0.015em] leading-[1.15] max-sm:text-[1.3rem]">
                  {svc.name}
                </h2>
                <span className="w-6 h-px bg-[var(--ed-accent)] opacity-60 transition-[width,opacity] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:w-14 group-hover:opacity-90 group-focus-visible:w-14" />
                <p className="text-[0.86rem] text-[var(--ed-ink-soft)] leading-[1.7]">
                  {svc.description}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 p-[0_1.75rem_1.5rem] max-sm:p-[0_1.3rem_1.15rem] pt-4 border-t border-dashed border-[var(--ed-rule)]">
                <span className={`${svc.iconMotionClass} inline-flex items-center justify-center text-[var(--ed-ink-faint)] transition-[color] duration-[400ms] ease-in-out group-hover:text-[var(--ed-accent)] group-focus-visible:text-[var(--ed-accent)]`} aria-hidden="true">
                  {svc.icon}
                </span>
                <span className="inline-flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-soft)] transition-[color,gap] duration-[350ms] ease-in-out group-hover:text-[var(--ed-accent)] group-hover:gap-[0.8rem] group-focus-visible:text-[var(--ed-accent)]">
                  <span>Read more</span>
                  <span className="inline-flex transition-transform duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-1 group-focus-visible:translate-x-1" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path d="M8 4L14 10L8 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                </span>
              </div>
            </article>
          </Link>
        ))}
      </main>

      {/* Swipe position dots — mobile peek-carousel only; also jump-to-card */}
      <div className="hidden max-sm:flex relative z-[2] items-center justify-center gap-2 mt-4" role="tablist" aria-label="Service card position">
        {services.map((svc, i) => (
          <button
            key={svc.name}
            type="button"
            role="tab"
            aria-selected={activeCard === i}
            aria-label={`Show ${svc.name}`}
            onClick={() => scrollToCard(cardsRef.current, i)}
            className={`h-1.5 rounded-full transition-all duration-300 ${activeCard === i ? 'w-5 bg-[var(--ed-accent)]' : 'w-1.5 bg-[var(--ed-rule)]'}`}
          />
        ))}
      </div>

      {/* Footer */}
      <footer
        className={`relative z-[2] mt-auto pt-[clamp(3rem,6vw,5rem)] pb-6 flex flex-col items-center gap-[0.85rem] text-[var(--ed-ink-faint)] transition-opacity duration-[1100ms] ease-in-out delay-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      >
        <span className="nr-footer-mono ed-display text-[1.35rem] tracking-[0.4em] font-semibold inline-flex items-center gap-[0.55rem] max-sm:text-[1.1rem] max-sm:tracking-[0.3em]" aria-hidden="true">
          <span className="nr-footer-diamond" />
          N<span className="font-normal">R</span>
          <span className="nr-footer-diamond" />
        </span>
      </footer>
    </div>
  );
}
