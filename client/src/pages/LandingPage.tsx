import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { BrandMark } from '../components/BrandMark';

// Real job-board source marks — kept small and self-contained since there
// are only three (mirrors AVAILABLE_SITES in CriteriaPanel.tsx). Not a
// generic icon library dependency for three fixed brand marks.
function LinkedInMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#0A66C2" />
      <path d="M7.4 9.8h2.6v7.6H7.4V9.8zm1.3-4.15a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM11.5 9.8h2.5v1.04h.04c.35-.65 1.2-1.34 2.46-1.34 2.63 0 3.12 1.73 3.12 3.98v4h-2.6v-3.55c0-.85-.02-1.94-1.18-1.94-1.19 0-1.37.93-1.37 1.88v3.6h-2.6V9.8z" fill="#fff" />
    </svg>
  );
}

function IndeedMark() {
  return (
    <span className="font-black text-[1.02rem] tracking-[-0.02em]" style={{ color: '#2164F3' }} aria-hidden="true">
      indeed<span style={{ color: '#FFC72C' }}>.</span>
    </span>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.14-3.13-.4-4.6H24v9h11.8c-.5 2.7-2.05 5-4.35 6.55v5.4h7c4.1-3.78 6.45-9.36 6.45-16.35z" />
      <path fill="#34A853" d="M24 46c5.85 0 10.75-1.94 14.35-5.25l-7-5.4c-1.94 1.3-4.45 2.07-7.35 2.07-5.65 0-10.44-3.81-12.15-8.94H4.6v5.57C8.2 41.1 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.85 28.48A13.98 13.98 0 0 1 11.1 24c0-1.56.27-3.07.75-4.48v-5.57H4.6A21.98 21.98 0 0 0 2 24c0 3.55.85 6.9 2.6 9.86l7.25-5.38z" />
      <path fill="#EA4335" d="M24 10.75c3.18 0 6.03 1.1 8.28 3.24l6.2-6.2C34.72 4.18 29.82 2 24 2 15.5 2 8.2 6.9 4.6 14.14l7.25 5.57c1.7-5.13 6.5-8.96 12.15-8.96z" />
    </svg>
  );
}

function SourceBadge({ children, plate }: { children: React.ReactNode; plate?: boolean }) {
  return (
    <div className="w-14 h-14 rounded-2xl border border-[var(--ed-rule)] bg-[var(--ed-panel)]/60 flex items-center justify-center transition-transform hover:-translate-y-0.5">
      {plate ? (
        <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center">{children}</span>
      ) : children}
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLoaded(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="editorial editorial-grain home-atmosphere relative min-h-[calc(100vh-56px)] flex flex-col items-center justify-center text-center p-[clamp(1.5rem,3.5vw,3rem)] overflow-x-clip">

      <div
        className={`relative z-[2] max-w-[620px] mx-auto transition-[opacity,transform] duration-1000 ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[18px]'}`}
        style={{ transitionTimingFunction: 'ease, cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        <span className="inline-flex items-center gap-[0.45rem] text-[0.66rem] tracking-[0.28em] uppercase text-[var(--ed-ink-faint)] font-semibold mb-6">
          <BrandMark size={13} className="text-[var(--ed-accent)]" />
          AI-powered job search
        </span>

        <h1 className="m-0 font-normal leading-none">
          <span className="ed-display inline-flex gap-[clamp(0.5rem,1.3vw,1.1rem)] items-baseline font-black text-[clamp(3.4rem,9vw,7rem)] leading-[0.9] tracking-[-0.035em] max-md:flex-col max-md:gap-[0.3rem] max-md:items-center">
            <span className="inline-block text-[var(--ed-ink)]">Next</span>
            <span className="inline-block italic font-medium text-[var(--ed-accent)]">Role</span>
          </span>
        </h1>

        <p className="ed-display mt-[1.6rem] text-[clamp(1rem,1.5vw,1.15rem)] text-[var(--ed-ink-soft)] font-normal">
          Discover, match, and track your next role.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => navigate('/settings?upload=1')}
            className="group inline-flex items-center gap-2 rounded-full bg-[var(--ed-accent)] text-[var(--ed-paper)] px-6 py-[0.65rem] text-[0.74rem] font-semibold uppercase tracking-[0.08em] transition-all hover:bg-[var(--ed-accent-deep)] hover:-translate-y-[1px] hover:shadow-lg"
          >
            <Upload size={14} className="transition-transform group-hover:-translate-y-0.5" aria-hidden="true" />
            Upload your résumé
          </button>
          <Link
            to="/search"
            className="inline-flex items-center gap-2 text-[0.74rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-soft)] transition-colors hover:text-[var(--ed-ink)]"
          >
            Browse your matches
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>

        {/* Real job-board sources — matches AVAILABLE_SITES in CriteriaPanel.tsx */}
        <div className="mt-16 pt-9 border-t border-dashed border-[var(--ed-rule)]">
          <p className="text-[0.62rem] tracking-[0.26em] uppercase text-[var(--ed-ink-faint)] font-semibold mb-5">
            Matching roles from&hellip;
          </p>
          <div className="flex items-center justify-center gap-4">
            <SourceBadge><LinkedInMark /></SourceBadge>
            <SourceBadge><IndeedMark /></SourceBadge>
            <SourceBadge plate><GoogleMark /></SourceBadge>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer
        className={`relative z-[2] mt-auto pt-[clamp(3rem,6vw,5rem)] pb-6 flex flex-col items-center gap-[0.85rem] text-[var(--ed-ink-faint)] transition-opacity duration-[1100ms] ease-in-out delay-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      >
        <span className="nr-footer-mono ed-display text-[1.35rem] tracking-[0.4em] font-semibold inline-flex items-center gap-[0.55rem] max-sm:text-[1.1rem] max-sm:tracking-[0.3em]" aria-hidden="true">
          <BrandMark size={11} className="text-[var(--ed-accent)]" />
          N<span className="font-normal">R</span>
          <BrandMark size={11} className="text-[var(--ed-accent)]" />
        </span>
      </footer>
    </div>
  );
}
