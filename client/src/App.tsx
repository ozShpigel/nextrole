import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Search, Kanban, Mail, GraduationCap, User } from 'lucide-react';
import { useAuthStatus, useHasProfile, useProfile, useResumeFile } from './lib/queries';
import { ProfileTabIcon, SignInWithGoogle } from './components/Account';
import { NoticeBanner } from './components/NoticeBanner';
import { isCvUploadInProgress, useCvUpload } from './lib/cvUpload';
import { BrandMark } from './components/BrandMark';

// Routes exempt from the onboarding redirect: "/" is the onboarding screen
// itself (nowhere to redirect to), "/settings" is where profile setup
// actually happens, "/score" works standalone without a saved profile,
// "/processing" is the retired post-upload page, kept only as a redirect.
// "/about" is the public story of the product, for visitors with no CV too.
const ONBOARDING_EXEMPT_PATHS = new Set(['/', '/settings', '/score', '/processing', '/about']);

// A brand-new profile means every other page (Matches, Active, Applications,
// Messages, Preparation) would otherwise show its own empty state with no
// shared "start here" cue. Route straight to the landing page's upload CTA
// instead — one clear next action instead of five disconnected blank screens.
function OnboardingGate() {
  const { pathname } = useLocation();
  const profileQuery = useProfile();
  const resumeQuery = useResumeFile();
  const hasProfile = useHasProfile();
  const upload = useCvUpload();

  if (ONBOARDING_EXEMPT_PATHS.has(pathname)) return <Outlet />;
  // A résumé being read right now: there is no profile YET, and redirecting
  // to "/" would bounce the reader off the Matches skeleton they were just
  // sent to (cvUpload.ts).
  if (isCvUploadInProgress(upload)) return <Outlet />;
  // undefined is "still loading" OR "errored" — useHasProfile collapses both,
  // and they differ here. Fail OPEN on the error: a transient cold-start or
  // network blip must never lock a real user out by misreading "errored" as
  // "no profile". Only a confirmed, successfully-loaded empty state redirects.
  if (hasProfile === undefined) {
    return profileQuery.isLoading || resumeQuery.isLoading ? null : <Outlet />;
  }
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

// The Profile tab is also the account: signed in, its icon is the account's
// initial, and the Profile page holds the email and Sign out (Account.tsx).
function NavIcon({ to, auth, size, fallback }: { to: string; auth: AuthStatus; size: number; fallback: React.ReactNode }) {
  return to === '/settings' ? <ProfileTabIcon auth={auth} size={size} fallback={fallback} /> : <>{fallback}</>;
}

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `shrink-0 relative inline-flex items-center gap-2 py-[0.45rem] px-[0.95rem] rounded-full text-[0.8rem] font-medium transition-all ${isActive ? 'text-[var(--ed-accent)] bg-[var(--ed-accent)]/10' : 'text-muted-foreground bg-transparent hover:text-foreground'}`;

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `flex-1 flex flex-col items-center justify-center gap-1 py-[0.4rem] text-[0.62rem] font-medium transition-all ${isActive ? 'text-[var(--ed-accent)] bg-[var(--ed-accent)]/10' : 'text-[var(--ed-ink-faint)]'}`;

// Bottom tab bar shown below the md breakpoint in place of the top link
// row, which would otherwise overflow five items on a phone-width screen.
// Fixed to the viewport, so App's caller pads the content column to match
// its height (including the iOS home-indicator safe area) — see MOBILE_NAV_
// SPACER below.
type AuthStatus = ReturnType<typeof useAuthStatus>['data'];

function MobileNav({ hasProfile, auth }: { hasProfile: boolean | undefined; auth: AuthStatus }) {
  if (!hasProfile) return null;
  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-50 flex items-stretch bg-background/80 backdrop-blur-[20px] border-t border-border pb-[env(safe-area-inset-bottom)]"
    >
      {NAV_LINKS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} className={mobileNavLinkClass}>
          <NavIcon to={to} auth={auth} size={20} fallback={<Icon size={20} aria-hidden="true" />} />
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

// True once the window has scrolled past the top. The nav is fully
// transparent at the top — the page's own background (grain, glow) shows
// through it, so there is no band — and only takes a translucent, blurred
// backing once content is scrolling underneath it.
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(() => typeof window !== 'undefined' && window.scrollY > 4);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
}

// The way to About from anywhere in the app, without spending a nav slot on
// it. Landing renders its own footer, so this one stays off "/". It sits
// outside every page's .editorial wrapper, so neutral tokens only (the
// --ed-* vars don't resolve here — docs/design-system.md, scope caveat).
function AppFooter() {
  const { pathname } = useLocation();
  if (pathname === '/') return null;
  return (
    <footer className="py-8 flex justify-center text-[13px] text-muted-foreground">
      <p>
        NextRole &middot; {new Date().getFullYear()} &middot;{' '}
        <NavLink to="/about" className="hover:text-foreground hover:underline">About</NavLink> &middot;{' '}
        <a href="https://github.com/ozShpigel/nextrole" target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
          GitHub
        </a>
      </p>
    </footer>
  );
}

export default function App() {
  // Every link in the nav leads somewhere a visitor without a CV cannot use —
  // OnboardingGate bounces them straight back to "/" from all five. Showing
  // the links anyway advertises five dead ends. They appear the moment a
  // profile exists, which is the moment they mean something. `undefined`
  // (still loading) hides them too, so they arrive once instead of flashing
  // in and out on first paint.
  const hasProfile = useHasProfile();
  const scrolled = useScrolled();
  const auth = useAuthStatus().data;
  return (
    <div className="relative">
      <nav data-app-nav className={`sticky top-0 z-50 transition-[background-color,backdrop-filter] duration-300 ${scrolled ? 'bg-[var(--ed-paper)]/55 backdrop-blur-[20px]' : 'bg-transparent'}`}>
        <div className="w-full px-8 flex items-center gap-4 md:gap-10 h-14">
          <NavLink to="/" className="shrink-0 inline-flex items-center gap-[0.4rem] font-serif font-bold text-[1rem] text-foreground tracking-[-0.01em] transition-opacity hover:opacity-75">
            <BrandMark size={24} className="text-foreground" flicker />
            NextRole
          </NavLink>
          {/* min-w-0 lets this shrink below its content width inside the flex
              row instead of forcing the whole page to scroll horizontally;
              overflow-x-auto then scrolls just this strip if it ever runs
              tight on a narrow desktop window. Hidden below md: — that width
              can't fit all five links, so MobileNav (a fixed bottom bar)
              takes over navigation there instead. */}
          {hasProfile && (
            <div className="ed-scroll hidden md:flex items-center gap-2 min-w-0 overflow-x-auto">
              {NAV_LINKS.map(({ to, label, Icon }) => (
                <NavLink key={to} to={to} className={navLinkClass}>
                  <NavIcon to={to} auth={auth} size={16} fallback={<Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 opacity-80" />} />
                  {label}
                </NavLink>
              ))}
            </div>
          )}
          {/* Optional, never a gate: the uid cookie (docs/multi-user.md) stays
              the only identity and uploading a CV is still the whole
              onboarding. Here only before onboarding, when there is no
              Profile tab yet; after it, sign-in and Sign out live on the
              Profile page. `hasProfile === false`, not falsy — `undefined` is
              still loading, and rendering on it flashes the link in and out.
              Sign-in asks for openid/email/profile only — the Gmail mailbox
              scope is deliberately NOT requested here. */}
          {hasProfile === false && auth?.available && !auth.signedIn && <SignInWithGoogle className="ml-auto" />}
        </div>
      </nav>
      {/* Directly under the nav and above every page, so an account-level
          notice is seen rather than found. Renders nothing when there are
          none. */}
      <NoticeBanner />
      <ScrollToTop />
      <div className={hasProfile ? MOBILE_NAV_SPACER : undefined}>
        <OnboardingGate />
        <AppFooter />
      </div>
      <MobileNav hasProfile={hasProfile} auth={auth} />
    </div>
  );
}
