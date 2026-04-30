import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

const services = [
  {
    name: 'Job Discovery',
    description: 'Automated job scanning from LinkedIn with AI-powered scoring and matching.',
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
    name: 'Application Tracker',
    description: 'Track job applications, interviews, and status updates.',
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
    name: 'Settings',
    description: 'View and edit your professional profile and Claude analysis inputs.',
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

const grainSvg = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export default function Landing() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLoaded(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-56px)] flex flex-col items-center p-[clamp(1.5rem,3.5vw,3rem)_clamp(1.25rem,4vw,3rem)_2rem] bg-background text-foreground isolate overflow-x-clip">
      {/* Grain texture overlay */}
      <div
        className="fixed inset-0 z-0 opacity-[0.032] pointer-events-none mix-blend-multiply"
        style={{ backgroundImage: grainSvg, backgroundSize: '200px' }}
        aria-hidden="true"
      />

      {/* Glow orb 1 */}
      <div
        className="fixed rounded-full pointer-events-none z-0 blur-[120px] animate-glow-pulse w-[720px] h-[720px] -top-[260px] -right-[180px]"
        style={{ background: 'radial-gradient(circle, rgba(0, 0, 0, 0.04) 0%, transparent 70%)' }}
        aria-hidden="true"
      />

      {/* Glow orb 2 */}
      <div
        className="fixed rounded-full pointer-events-none z-0 blur-[120px] animate-glow-pulse w-[620px] h-[620px] -bottom-[200px] -left-[170px]"
        style={{
          background: 'radial-gradient(circle, rgba(0, 0, 0, 0.03) 0%, transparent 70%)',
          animationDelay: '-7s',
        }}
        aria-hidden="true"
      />

      {/* Editorial crop marks at viewport corners */}
      <div className="fixed inset-0 pointer-events-none z-[1]" aria-hidden="true">
        <span className={`absolute w-7 h-7 top-[18px] left-[18px] border-t border-l border-border transition-opacity duration-[1200ms] ease-in-out delay-700 max-sm:w-5 max-sm:h-5 max-sm:top-3 max-sm:left-3 ${loaded ? 'opacity-[0.42]' : 'opacity-0'}`} />
        <span className={`absolute w-7 h-7 top-[18px] right-[18px] border-t border-r border-border transition-opacity duration-[1200ms] ease-in-out delay-700 max-sm:w-5 max-sm:h-5 max-sm:top-3 max-sm:right-3 ${loaded ? 'opacity-[0.42]' : 'opacity-0'}`} />
        <span className={`absolute w-7 h-7 bottom-[18px] left-[18px] border-b border-l border-border transition-opacity duration-[1200ms] ease-in-out delay-700 max-sm:w-5 max-sm:h-5 max-sm:bottom-3 max-sm:left-3 ${loaded ? 'opacity-[0.42]' : 'opacity-0'}`} />
        <span className={`absolute w-7 h-7 bottom-[18px] right-[18px] border-b border-r border-border transition-opacity duration-[1200ms] ease-in-out delay-700 max-sm:w-5 max-sm:h-5 max-sm:bottom-3 max-sm:right-3 ${loaded ? 'opacity-[0.42]' : 'opacity-0'}`} />
      </div>

      {/* Header */}
      <header
        className={`relative z-[2] text-center mt-[clamp(2rem,7vh,5rem)] mb-[3.25rem] transition-[opacity,transform] duration-1000 ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[18px]'}`}
        style={{ transitionTimingFunction: 'ease, cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        {/* Edition ribbon */}
        <Badge
          variant="outline"
          className="gap-[0.55rem] font-mono text-[0.62rem] tracking-[0.32em] font-medium text-muted-foreground py-[0.42rem] px-[1.1rem] mb-[2.25rem] backdrop-blur-[6px] uppercase tabular-nums border-border bg-muted/50 max-md:text-[0.58rem] max-md:tracking-[0.25em]"
        >
          <span className="text-[0.35rem] text-primary opacity-65 leading-none" aria-hidden="true">●</span>
          <span className="whitespace-nowrap">V 0.1.0 &nbsp;&middot;&nbsp; VOL. 01 &nbsp;&middot;&nbsp; MMXXVI</span>
          <span className="text-[0.35rem] text-primary opacity-65 leading-none" aria-hidden="true">●</span>
        </Badge>

        <h1 className="m-0 font-normal leading-none">
          <span className="block font-mono text-[clamp(0.78rem,1.3vw,0.95rem)] tracking-[0.45em] uppercase text-primary font-medium mb-[clamp(1rem,2vw,1.5rem)] opacity-85 px-[0.6em]">
            — Platform —
          </span>
          <span className="inline-flex gap-[clamp(0.5rem,1.3vw,1.1rem)] items-baseline font-serif font-bold text-[clamp(3.2rem,8.5vw,6.2rem)] leading-[0.92] tracking-[-0.035em] max-md:flex-col max-md:gap-[0.3rem] max-md:items-center">
            <span className="inline-block text-foreground" style={{ textShadow: '0 1px 0 rgba(255, 255, 255, 0.5)' }}>
              Next
            </span>
            <span
              className="relative inline-block bg-clip-text text-transparent"
              style={{
                background: 'linear-gradient(130deg, var(--primary) 0%, var(--muted-foreground) 55%, var(--ring) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Role
              <span
                className="absolute pointer-events-none -z-1 blur-[14px]"
                style={{ inset: '-18% -8%', background: 'radial-gradient(circle, rgba(0, 0, 0, 0.06) 0%, transparent 68%)' }}
                aria-hidden="true"
              />
            </span>
          </span>
        </h1>

        <p className="mt-[1.85rem] mx-auto max-w-[460px] font-serif text-[clamp(0.98rem,1.5vw,1.12rem)] leading-[1.75] text-muted-foreground font-normal">
          A smart toolkit to manage your job search —<br className="max-md:hidden" />
          <em className="italic text-foreground font-medium tracking-[0.005em]">AI-powered, thoughtfully designed.</em>
        </p>

        {/* Ornament: dot-bar-diamond-bar-dot */}
        <div className="flex items-center justify-center gap-[0.55rem] mt-[2.25rem] text-border" aria-hidden="true">
          <span className="w-[3px] h-[3px] rounded-full bg-current" />
          <span className="h-px w-[clamp(24px,5vw,44px)]" style={{ background: 'linear-gradient(90deg, transparent, currentColor 30%, currentColor 70%, transparent)' }} />
          <span className="w-1.5 h-1.5 bg-current rotate-45 opacity-[0.72]" />
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
        <Separator className="flex-1 bg-transparent" style={{ background: 'linear-gradient(90deg, transparent, var(--border) 40%, var(--border) 60%, transparent)' }} />
        <span className="font-mono text-[0.68rem] tracking-[0.28em] uppercase text-muted-foreground font-medium whitespace-nowrap px-1 tabular-nums max-md:text-[0.6rem] max-md:tracking-[0.22em]">
          Contents &middot; Table of Contents
        </span>
        <Separator className="flex-1 bg-transparent" style={{ background: 'linear-gradient(90deg, transparent, var(--border) 40%, var(--border) 60%, transparent)' }} />
      </div>

      {/* Cards grid */}
      <main className="relative z-[2] grid grid-cols-[repeat(auto-fit,minmax(270px,1fr))] gap-[clamp(1rem,1.5vw,1.5rem)] w-full max-w-[980px] mx-auto max-sm:grid-cols-1 max-sm:gap-[0.9rem]">
        {services.map((svc, i) => (
          <Link
            key={svc.name}
            to={svc.path}
            className={`group no-underline transition-[opacity,transform] duration-[750ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
            style={{ '--i': i, transitionDelay: `calc(var(--i) * 0.1s + 0.5s)` }}
            aria-label={`${svc.name} — ${svc.description}`}
          >
            <Card
              className="relative flex flex-col gap-[1.1rem] min-h-[260px] overflow-hidden backdrop-blur-[18px] bg-card shadow-sm transition-[border-color,box-shadow,background] duration-[750ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-primary/30 hover:-translate-y-1 hover:shadow-lg focus-visible:border-primary/30 focus-visible:-translate-y-1 max-sm:min-h-0"
            >
              {/* Top stripe */}
              <span
                className="absolute top-0 inset-x-0 h-[2px] opacity-0 scale-x-[0.15] origin-center transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100 group-hover:opacity-100 group-focus-visible:scale-x-100 group-focus-visible:opacity-100 pointer-events-none"
                style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)' }}
                aria-hidden="true"
              />

              {/* Radial hover overlay */}
              <span
                className="absolute inset-0 opacity-0 pointer-events-none transition-opacity duration-[450ms] ease-in-out group-hover:opacity-100"
                style={{ background: 'radial-gradient(ellipse at 20% 0%, var(--muted) 0%, transparent 55%)' }}
                aria-hidden="true"
              />

              <CardHeader className="p-[1.85rem_1.75rem_0] max-sm:p-[1.4rem_1.3rem_0] space-y-0">
                <div className="flex items-baseline justify-between gap-4 mb-[0.2rem]">
                  <span className="relative inline-block font-serif text-[2.4rem] font-bold leading-[0.9] text-primary tracking-[-0.02em] tabular-nums transition-[color,transform] duration-[400ms] ease-in-out max-sm:text-[2rem]">
                    {String(i + 1).padStart(2, '0')}
                    <span className="absolute bottom-[-6px] left-0 w-7 h-px bg-primary opacity-35 origin-left scale-x-[0.4] transition-[transform,opacity] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100 group-hover:opacity-80 group-focus-visible:scale-x-100 group-focus-visible:opacity-80" aria-hidden="true" />
                  </span>
                  <Badge variant="outline" className="font-mono text-[0.62rem] tracking-[0.3em] uppercase text-muted-foreground font-medium border-transparent bg-transparent py-0 px-0">
                    {svc.kicker}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-3 flex-1 p-[0_1.75rem] max-sm:p-[0_1.3rem]">
                <CardTitle className="font-serif text-[1.35rem] font-bold text-foreground tracking-[-0.01em] leading-[1.25] max-sm:text-[1.2rem]">
                  {svc.name}
                </CardTitle>
                <Separator className="w-6 bg-primary opacity-50 transition-[width,opacity] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:w-14 group-hover:opacity-80 group-focus-visible:w-14 group-focus-visible:opacity-80" />
                <CardDescription className="font-mono text-[0.85rem] text-muted-foreground leading-[1.75] font-light">
                  {svc.description}
                </CardDescription>
              </CardContent>

              <CardFooter
                className="justify-between gap-3 p-[0_1.75rem_1.5rem] max-sm:p-[0_1.3rem_1.15rem] pt-4 border-t border-dashed border-border"
              >
                <span className="inline-flex items-center justify-center text-muted-foreground opacity-75 transition-[color,opacity,transform] duration-[400ms] ease-in-out group-hover:text-primary group-hover:opacity-100 group-hover:-rotate-[4deg] group-focus-visible:text-primary group-focus-visible:opacity-100 group-focus-visible:-rotate-[4deg]" aria-hidden="true">
                  {svc.icon}
                </span>
                <Button variant="ghost" className="h-auto p-0 font-mono text-[0.78rem] font-medium text-muted-foreground tracking-[0.02em] hover:bg-transparent hover:text-primary gap-2 transition-[color,gap] duration-[350ms] ease-in-out group-hover:text-primary group-hover:gap-[0.8rem] group-focus-visible:text-primary group-focus-visible:gap-[0.8rem]">
                  <span>Read more</span>
                  <span className="inline-flex transition-transform duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-1 group-focus-visible:translate-x-1" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path d="M8 4L14 10L8 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                </Button>
              </CardFooter>

              {/* Corner ornament */}
              <span
                className="absolute -bottom-[30px] -right-[30px] w-[120px] h-[120px] rounded-full pointer-events-none opacity-0 transition-[opacity,transform] duration-500 ease-in-out group-hover:opacity-100 group-hover:scale-110 group-focus-visible:opacity-100 group-focus-visible:scale-110"
                style={{ background: 'radial-gradient(circle, var(--muted) 0%, transparent 65%)' }}
                aria-hidden="true"
              />
            </Card>
          </Link>
        ))}
      </main>

      {/* Footer */}
      <footer
        className={`relative z-[2] mt-auto pt-[clamp(3rem,6vw,5rem)] pb-6 flex flex-col items-center gap-[0.85rem] text-muted-foreground transition-opacity duration-[1100ms] ease-in-out delay-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      >
        <span className="font-serif text-[1.25rem] tracking-[0.4em] font-semibold text-primary inline-flex items-center gap-[0.55rem] opacity-[0.82] max-sm:text-[1.05rem] max-sm:tracking-[0.3em]" aria-hidden="true">
          <span className="text-[0.9rem] text-primary opacity-45">&middot;</span>
          N<span className="text-muted-foreground opacity-55 font-normal">R</span>
          <span className="text-[0.9rem] text-primary opacity-45">&middot;</span>
        </span>
        <span className="font-mono text-[0.72rem] tracking-[0.12em] uppercase text-muted-foreground font-normal max-sm:text-[0.65rem]">
          &copy; 2026 &middot; NextRole &middot; Crafted with care
        </span>
      </footer>
    </div>
  );
}
