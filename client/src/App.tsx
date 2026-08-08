import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { useConfig, useProfile, useResumeFile } from './lib/queries';
import { BrandMark } from './components/BrandMark';

// Routes exempt from the onboarding redirect: "/" is the onboarding screen
// itself (nowhere to redirect to), "/settings" is where profile setup
// actually happens, "/score" works standalone without a saved profile.
const ONBOARDING_EXEMPT_PATHS = new Set(['/', '/settings', '/score']);

// A brand-new profile means every other page (Matches, Applications, Messages,
// Preparation) would otherwise show its own empty state with no shared
// "start here" cue. Route straight to the landing page's upload CTA instead
// — one clear next action instead of four disconnected blank screens.
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

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `shrink-0 relative py-[0.45rem] px-4 rounded-full text-[0.82rem] font-medium transition-all ${isActive ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`;

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
          Read-only demo — explore the sample data freely; changes are disabled.
        </div>
      )}
      <nav data-app-nav className="bg-background/80 backdrop-blur-[20px] border-b border-border sticky top-0 z-50">
        <div className="max-w-[1100px] mx-auto px-6 flex items-center justify-between gap-3 h-14">
          <NavLink to="/" className="shrink-0 inline-flex items-center gap-[0.4rem] font-serif font-bold text-[1rem] text-foreground tracking-[-0.01em] transition-opacity hover:opacity-75">
            <BrandMark size={15} className="text-primary" />
            NextRole<span className="text-primary" aria-hidden="true">.</span>
          </NavLink>
          {/* min-w-0 lets this shrink below its content width inside the flex
              row instead of forcing the whole page to scroll horizontally;
              overflow-x-auto then scrolls just this strip on narrow screens. */}
          <div className="ed-scroll flex items-center gap-[0.15rem] min-w-0 overflow-x-auto">
            <NavLink to="/search" className={navLinkClass}>Matches</NavLink>
            <NavLink to="/tracker" className={navLinkClass}>Applications</NavLink>
            <NavLink to="/messages" className={navLinkClass}>Messages</NavLink>
            <NavLink to="/interview-prep" className={navLinkClass}>Preparation</NavLink>
            <NavLink to="/settings" className={navLinkClass}>Profile</NavLink>
          </div>
        </div>
      </nav>
      <ScrollToTop />
      <OnboardingGate />
    </div>
  );
}
