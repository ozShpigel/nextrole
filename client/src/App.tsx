import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Search, Kanban, Mail, GraduationCap, User } from 'lucide-react';
import { useConfig, useProfile, useResumeFile } from './lib/queries';
import { BrandMark } from './components/BrandMark';

// Routes exempt from the onboarding redirect: "/" is the onboarding screen
// itself (nowhere to redirect to), "/settings" is where profile setup
// actually happens, "/score" works standalone without a saved profile,
// "/processing" is the post-upload beat — the profile queries may not have
// refetched yet when it mounts, and it always hands off to "/search" itself.
const ONBOARDING_EXEMPT_PATHS = new Set(['/', '/settings', '/score', '/processing']);

// A brand-new profile means every other page (Matches, Active, Applications,
// Messages, Preparation) would otherwise show its own empty state with no
// shared "start here" cue. Route straight to the landing page's upload CTA
// instead — one clear next action instead of five disconnected blank screens.
function OnboardingGate() {
  const { pathname } = useLocation();
  const profileQuery = useProfile();
  const resumeQuery = useResumeFile();

  if (ONBOARDING_EXEMPT_PATHS.has(pathname)) return <Outlet />;
  if (profileQuery.isLoading || resumeQuery.isLoading) return null;
  // Fail OPEN on error — a transient cold-start/network blip on either query
  // must never lock a real user out of the app by misreading "errored" as
  // "no profile". Only a confirmed, successfully-loaded empty state redirects.
  if (profileQuery.isError || resumeQuery.isError) return <Outlet />;

  const hasProfile = !!resumeQuery.data || !!profileQuery.data?.content?.trim();
  if (!hasProfile) return <Navigate to="/" replace />;

  return <Outlet />;
}

// "Apps" nav link removed 2026-08-11 — Active now covers the day-to-day
// pipeline view. The /tracker route and ApplicationList page are
// intentionally left in place: closed (Rejected/Withdrawn) applications and
// the application detail page (notes, interviews, salary, delete) have no
// equivalent on Active yet, so they stay reachable by URL.
const NAV_LINKS = [
  { to: '/search', label: 'Matches', Icon: Search },
  { to: '/active', label: 'Active', Icon: Kanban },
  { to: '/messages', label: 'Messages', Icon: Mail },
  { to: '/interview-prep', label: 'Prep', Icon: GraduationCap },
  { to: '/settings', label: 'Profile', Icon: User },
];

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `shrink-0 relative py-[0.4rem] px-[0.7rem] rounded-full text-[0.8rem] font-medium transition-all ${isActive ? 'text-[var(--ed-accent)] bg-[var(--ed-accent)]/10' : 'text-muted-foreground bg-transparent hover:text-foreground'}`;

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `flex-1 flex flex-col items-center justify-center gap-1 py-[0.4rem] text-[0.62rem] font-medium transition-all ${isActive ? 'text-[var(--ed-accent)] bg-[var(--ed-accent)]/10' : 'text-[var(--ed-ink-faint)]'}`;

// Bottom tab bar shown below the md breakpoint in place of the top link
// row, which would otherwise overflow five items on a phone-width screen.
// Fixed to the viewport, so App's caller pads the content column to match
// its height (including the iOS home-indicator safe area) — see MOBILE_NAV_
// SPACER below.
function MobileNav() {
  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-50 flex items-stretch bg-background/80 backdrop-blur-[20px] border-t border-border pb-[env(safe-area-inset-bottom)]"
    >
      {NAV_LINKS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} className={mobileNavLinkClass}>
          <Icon size={20} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

// Matches MobileNav's own rendered height — py-[0.4rem]×2 (0.8rem) + the
// 20px icon (1.25rem) + gap-1 (0.25rem) + the label's line box at the
// inherited 1.5 line-height (0.93rem) + its border-t (~0.0625rem) ≈ 3.29rem,
// rounded up to 3.5rem for cross-browser font-metric slack — plus the
// safe-area inset it also pads for, so page content never sits underneath
// the fixed bar. NOTE: calc() requires whitespace around +/- operators
// (Tailwind arbitrary values use "_" for that space) — omitting it silently
// invalidates the whole declaration and browsers drop it, which is why an
// earlier version of this line had no effect at all.
const MOBILE_NAV_SPACER = 'pb-[calc(3.5rem_+_env(safe-area-inset-bottom))] md:pb-0';

/* BrowserRouter keeps the window scroll offset across navigations, so opening
 * a page from deep in a long list (e.g. tracker → application detail) landed
 * mid-page. Reset to top on forward navigations only — POP (browser back)
 * is left alone. */
function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navigationType]);
  return null;
}

export default function App() {
  const { data: config } = useConfig();
  return (
    <div className="relative">
      {config?.demoMode && (
        <div className="bg-primary/10 text-foreground border-b border-border text-center text-[0.78rem] font-medium py-[0.4rem] px-4">
          Live demo — real AI scoring.
        </div>
      )}
      <nav data-app-nav className="bg-background/80 backdrop-blur-[20px] border-b border-border sticky top-0 z-50">
        <div className="w-full px-8 flex items-center gap-4 md:gap-10 h-14">
          <NavLink to="/" className="shrink-0 inline-flex items-center gap-[0.4rem] font-serif font-bold text-[1rem] text-foreground tracking-[-0.01em] transition-opacity hover:opacity-75">
            <BrandMark size={24} className="text-foreground" />
            NextRole
          </NavLink>
          {/* min-w-0 lets this shrink below its content width inside the flex
              row instead of forcing the whole page to scroll horizontally;
              overflow-x-auto then scrolls just this strip if it ever runs
              tight on a narrow desktop window. Hidden below md: — that width
              can't fit all five links, so MobileNav (a fixed bottom bar)
              takes over navigation there instead. */}
          <div className="ed-scroll hidden md:flex items-center gap-0 min-w-0 overflow-x-auto">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink key={to} to={to} className={navLinkClass}>{label}</NavLink>
            ))}
          </div>
        </div>
      </nav>
      <ScrollToTop />
      <div className={MOBILE_NAV_SPACER}>
        <OnboardingGate />
      </div>
      <MobileNav />
    </div>
  );
}
