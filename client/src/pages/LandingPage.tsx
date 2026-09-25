import { useEffect, useRef, useState } from 'react';
import { startCvUpload, useCvUpload, type CvUploadState } from '../lib/cvUpload';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Upload } from 'lucide-react';
import { apiUrl } from '../lib/api';
import { useAuthStatus, useHasProfile } from '../lib/queries';

// Company marks for the "Companies like these" marquee — simplified but
// recognizable, self-contained (each carries its own backing shape/color
// where the real brand mark has one, transparent where it doesn't) so no
// outer frame is needed around them.
// `disc` draws the white backing the marquee needs; the sign-in link sits on
// the page background and takes the bare glyph.
// How long what was found stays on screen before Matches takes over. Long
// enough to read a title and a few skills; short against a ~20s read.
const REVEAL_MS = 1600;

// The read's meter. There is no honest percentage for a model reading a PDF,
// so the width is not presented as one: it eases toward CREEP_TO over about a
// full read's length — fast at first, then ever slower, never arriving — and
// only a real milestone, the essentials landing, takes it to the end. Always
// moving, so the wait never looks stuck; never claiming ground the work has
// not taken. (The retired processing page kept the same rule: progress only
// moves to done when something actually completed.)
const CREEP_TO = 88;
const CREEP_MS = 18_000;

function ReadMeter({ done }: { done: boolean }) {
  // Starts at 0 and is set to the creep target one frame after mount, so the
  // long transition has a start to animate from.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setStarted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const width = done ? 100 : started ? CREEP_TO : 0;
  const transition = done
    ? 'width 450ms cubic-bezier(.2,.8,.2,1)'
    : `width ${CREEP_MS}ms cubic-bezier(.08,.72,.18,1)`;

  return (
    <div className="ed-meter" role="progressbar" aria-label="Reading your résumé" data-testid="upload-progress">
      <div className="ed-meter__fill" style={{ width: `${width}%`, transition }} />
    </div>
  );
}

// The upload, in place of the upload button: the meter while the résumé is
// read, then — the moment the essentials are saved — the meter completes and
// the card shows what was actually found, as the hand-over to Matches.
function UploadCard({ upload }: { upload: CvUploadState }) {
  const found = upload.phase === 'matching' || upload.phase === 'done' ? upload.found : undefined;
  const headline = found
    ? [found.experience?.[0]?.title, found.seniority].filter(Boolean).join(' · ')
    : '';
  const skills = found
    ? [...new Set((found.skills ?? []).flatMap((g) => g.items))].slice(0, 5)
    : [];

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="upload-card"
      className="w-full max-w-[26rem] text-left rounded-2xl border border-[var(--ed-rule)] bg-[var(--ed-panel)] p-5 flex flex-col gap-3 animate-in fade-in duration-300"
    >
      <ReadMeter done={!!found} />
      {found ? (
        <>
          <p className="flex items-center gap-2 text-[16px] font-medium text-[var(--ed-ink)] animate-in fade-in duration-300">
            <Check size={16} className="shrink-0 text-[var(--ed-accent)]" aria-hidden="true" />
            <span className="truncate">{headline || 'Résumé read'}</span>
          </p>
          {skills.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Skills found">
              {skills.map((s) => (
                <li key={s} className="rounded-full border border-[var(--ed-rule)] px-[0.6rem] py-[0.15rem] text-[13px] text-[var(--ed-ink-soft)] animate-in fade-in duration-500">
                  {s}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-[var(--ed-ink-faint)]">Finding your matches…</p>
        </>
      ) : (
        <>
          <p className="text-[16px] font-medium text-[var(--ed-ink)]">Reading your résumé…</p>
          <p className="text-[13px] text-[var(--ed-ink-faint)]">Roles, skills, seniority</p>
        </>
      )}
    </div>
  );
}

function GoogleMark({ disc = false, size = '100%' }: { disc?: boolean; size?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      {disc && <circle cx="24" cy="24" r="24" fill="#fff" />}
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.14-3.13-.4-4.6H24v9h11.8c-.5 2.7-2.05 5-4.35 6.55v5.4h7c4.1-3.78 6.45-9.36 6.45-16.35z" />
      <path fill="#34A853" d="M24 46c5.85 0 10.75-1.94 14.35-5.25l-7-5.4c-1.94 1.3-4.45 2.07-7.35 2.07-5.65 0-10.44-3.81-12.15-8.94H4.6v5.57C8.2 41.1 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.85 28.48A13.98 13.98 0 0 1 11.1 24c0-1.56.27-3.07.75-4.48v-5.57H4.6A21.98 21.98 0 0 0 2 24c0 3.55.85 6.9 2.6 9.86l7.25-5.38z" />
      <path fill="#EA4335" d="M24 10.75c3.18 0 6.03 1.1 8.28 3.24l6.2-6.2C34.72 4.18 29.82 2 24 2 15.5 2 8.2 6.9 4.6 14.14l7.25 5.57c1.7-5.13 6.5-8.96 12.15-8.96z" />
    </svg>
  );
}

function MetaMark() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="meta-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0064E1" />
          <stop offset="100%" stopColor="#00B2FF" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="13" fill="url(#meta-grad)" />
      <text x="24" y="32" textAnchor="middle" fontSize="21" fontWeight="700" fill="#fff" fontFamily="Georgia, serif">&#8734;</text>
    </svg>
  );
}

function AmazonMark() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="13" fill="#B15C1E" />
      <path d="M13 27c6 5 16 5 22 0" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M31 25.4l4 .7-1.7 3.6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="88%" height="88%" viewBox="0 0 44 44" aria-hidden="true">
      <rect x="1" y="1" width="19.5" height="19.5" fill="#F35325" />
      <rect x="23.5" y="1" width="19.5" height="19.5" fill="#81BC06" />
      <rect x="1" y="23.5" width="19.5" height="19.5" fill="#05A6F0" />
      <rect x="23.5" y="23.5" width="19.5" height="19.5" fill="#FFBA08" />
    </svg>
  );
}

function NetflixMark() {
  return (
    <svg width="55%" height="80%" viewBox="0 0 26 36" aria-hidden="true">
      <path d="M2 0h6l10 24V0h6v36h-6L8 12v24H2V0z" fill="#E50914" />
    </svg>
  );
}

function SalesforceMark() {
  return (
    <svg width="90%" height="66%" viewBox="0 0 48 32" aria-hidden="true">
      <ellipse cx="16" cy="17" rx="10" ry="9" fill="#00A1E0" />
      <ellipse cx="28" cy="13" rx="9" ry="8" fill="#00A1E0" />
      <ellipse cx="36" cy="19" rx="8" ry="7" fill="#00A1E0" />
      <rect x="10" y="17" width="30" height="10" rx="5" fill="#00A1E0" />
    </svg>
  );
}

function RedditMark() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="13" fill="#FF4500" />
      <circle cx="24" cy="27" r="11" fill="#fff" />
      <circle cx="18.5" cy="26" r="2.2" fill="#FF4500" />
      <circle cx="29.5" cy="26" r="2.2" fill="#FF4500" />
      <path d="M18 31c2 2 10 2 12 0" stroke="#FF4500" strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="24" cy="12" r="2.5" fill="#fff" />
      <line x1="24" y1="14.5" x2="24" y2="18" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

function SpotifyMark() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill="#1DB954" />
      <path d="M13 20c7-2 15-1 21 3" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M14 26c6-1.6 13-1 18 2.4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <path d="M15 32c5-1 10-.6 14 1.6" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const COMPANY_LOGOS = [
  { name: 'Google', node: <GoogleMark disc /> },
  { name: 'Meta', node: <MetaMark /> },
  { name: 'Amazon', node: <AmazonMark /> },
  { name: 'Microsoft', node: <MicrosoftMark /> },
  { name: 'Netflix', node: <NetflixMark /> },
  { name: 'Salesforce', node: <SalesforceMark /> },
  { name: 'Reddit', node: <RedditMark /> },
  { name: 'Spotify', node: <SpotifyMark /> },
];

const SLOT_COUNT = 6;
// One shared, slower clock — each tick picks a single random slot to swap,
// so only ever one mark is mid-transition at a time instead of several
// slots flickering together.
const SWITCH_INTERVAL_MS = 1800;

function LogoMarquee() {
  const [indices, setIndices] = useState<number[]>(() =>
    Array.from({ length: SLOT_COUNT }, (_, i) => i % COMPANY_LOGOS.length),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setIndices((prev) => {
        const slot = Math.floor(Math.random() * SLOT_COUNT);
        // Exclude every mark already showing (including this slot's own
        // current one) — always changes, and never duplicates a logo
        // that's already elsewhere in the row.
        const taken = new Set(prev);
        const available = COMPANY_LOGOS.map((_, i) => i).filter((i) => !taken.has(i));
        const next = available[Math.floor(Math.random() * available.length)];
        const updated = [...prev];
        updated[slot] = next;
        return updated;
      });
    }, SWITCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center justify-center gap-4 max-sm:gap-3">
      {indices.map((logoIndex, slot) => (
        <div key={slot} className="w-7 h-7 flex items-center justify-center max-sm:w-6 max-sm:h-6">
          <div key={logoIndex} className="w-full h-full flex items-center justify-center animate-in fade-in zoom-in-90 duration-500">
            {COMPANY_LOGOS[logoIndex].node}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const hasProfile = useHasProfile();
  const signInAvailable = useAuthStatus().data?.available ?? false;
  const [loaded, setLoaded] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLoaded(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // The file input's click() must fire synchronously inside this handler —
  // any navigation or async gap first (e.g. routing to Settings and waiting
  // on its profile load, as this used to do) burns through the browser's
  // "user activation" window and the native picker silently refuses to open.
  //
  // The actual parse (a real Claude API call — 10-20s for a résumé PDF) is
  // not awaited here: it starts from this handler and runs outside any page
  // (cvUpload.ts), and the reader goes straight to Matches, which shows
  // skeleton cards until the profile is saved. Awaiting it here left users
  // staring at a small button spinner for the whole wait.
  function onResumeFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    startedHereRef.current = file;
    void startCvUpload(file);
  }

  // The first part of the wait belongs here: it is about the reader's CV, not
  // about jobs, and a grid of job skeletons would promise what cannot exist
  // yet. Matches takes over the moment there is a profile to retrieve
  // against — the essentials read, a few seconds in.
  const upload = useCvUpload();
  const startedHereRef = useRef<File | null>(null);
  const ours = upload && upload.file === startedHereRef.current ? upload : null;
  const reading = ours?.phase === 'reading';
  const found = ours && (ours.phase === 'matching' || ours.phase === 'done') ? ours : null;
  useEffect(() => {
    // Navigating on a state change, not firing a mutation: the upload itself
    // was started by the file picker's handler above. A short beat first, so
    // what was found can be read before Matches takes over.
    if (!found) return;
    const handoff = setTimeout(() => navigate('/search'), REVEAL_MS);
    return () => clearTimeout(handoff);
  }, [found, navigate]);

  function onUploadClick(): void {
    fileInputRef.current?.click();
  }

  return (
    <div className="editorial editorial-grain home-atmosphere relative min-h-[calc(100vh-56px)] flex flex-col items-center justify-center text-center p-[clamp(1.5rem,3.5vw,3rem)] overflow-x-clip">

      <div
        className={`relative z-[2] max-w-[620px] mx-auto transition-[opacity,transform] duration-1000 ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[18px]'}`}
        style={{ transitionTimingFunction: 'ease, cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        <h1 className="m-0 font-normal leading-none">
          <span className="ed-display inline-flex gap-[clamp(0.5rem,1.3vw,1.1rem)] items-baseline font-black text-[clamp(3.4rem,9vw,7rem)] leading-[0.9] tracking-[-0.035em] max-md:flex-col max-md:gap-[0.3rem] max-md:items-center">
            <span className="inline-block text-[var(--ed-ink)]">Next</span>
            <span className="inline-block italic font-medium text-[var(--ed-accent)]">Role</span>
          </span>
        </h1>

        {ours?.phase === 'error' ? (
          <p role="alert" className="ed-display mt-[1.6rem] text-[clamp(1rem,1.5vw,1.15rem)] text-[var(--ed-no)] font-normal">
            Couldn’t read that résumé — try another file.
          </p>
        ) : (
          <p className="ed-display mt-[1.6rem] text-[clamp(1rem,1.5vw,1.15rem)] text-[var(--ed-ink-soft)] font-normal">
            Find it. Know it fits. Apply.
          </p>
        )}

        <div className="mt-9 flex flex-wrap items-center justify-center gap-5">
          {reading || found ? (
            <UploadCard upload={(reading ? ours : found)!} />
          ) : (
          <button
            type="button"
            onClick={onUploadClick}
            className="group inline-flex items-center gap-2 rounded-full bg-[var(--ed-accent)] text-[var(--ed-paper)] px-6 py-[0.65rem] text-[0.74rem] font-semibold uppercase tracking-[0.08em] transition-all hover:bg-[var(--ed-accent-deep)] hover:-translate-y-[1px]"
          >
            <Upload size={14} className="transition-transform group-hover:-translate-y-0.5" aria-hidden="true" />
            {ours?.phase === 'error' ? 'Try another file' : 'Upload your résumé'}
          </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            onChange={onResumeFile}
            className="hidden"
            data-testid="resume-file-input"
          />
          {/* Optional, never a gate. The uid cookie (docs/multi-user.md) stays the
              only identity and uploading a CV is still the whole onboarding —
              this is the recovery path for the one real hole in cookie-only
              identity: clearing cookies or switching device otherwise loses the
              account for good. Shown only to a visitor we don't already
              recognise (hasProfile === false, not falsy — `undefined` means the
              profile queries are still loading, and rendering on that flashes
              the link in and out). Linking an already-onboarded session to a
              Google account belongs in Settings, not in front of someone who
              hasn't seen the product yet, and the Gmail mailbox scope
              (gmail.readonly, a restricted scope) is deliberately NOT requested
              here — sign-in asks for openid/email/profile only.
 */}
          {!reading && !found && hasProfile === false && signInAvailable && (
            <a
              href={apiUrl('/auth/google/start')}
              className="inline-flex items-center gap-2 text-[0.74rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-soft)] transition-colors hover:text-[var(--ed-ink)]"
            >
              <GoogleMark size="14" />
              Sign in with Google
              <span aria-hidden="true">&rarr;</span>
            </a>
          )}
          {/* "Your matches" is a promise nobody without a CV can be shown:
              Matches has nothing to list until a profile exists to score
              against, and OnboardingGate sends them straight back here
              anyway. For a returning visitor it is the fastest route in. */}
          {!reading && !found && hasProfile && (
            <Link
              to="/search"
              className="inline-flex items-center gap-2 text-[0.74rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-soft)] transition-colors hover:text-[var(--ed-ink)]"
            >
              Browse your matches
              <span aria-hidden="true">&rarr;</span>
            </Link>
          )}
        </div>

        {/* Company marks cycling independently per slot — illustrative
            examples, not a claim about actual data sources. */}
        <div className="mt-16 pt-9 border-t border-dashed border-[var(--ed-rule)]">
          <p className="text-[0.62rem] tracking-[0.26em] uppercase text-[var(--ed-ink-faint)] font-semibold mb-6">
            Companies like these
          </p>
          <LogoMarquee />
        </div>
      </div>

      {/* Footer */}
      <footer
        className={`relative z-[2] pt-[clamp(3rem,6vw,5rem)] pb-6 flex flex-col items-center gap-[0.85rem] text-[var(--ed-ink-faint)] transition-opacity duration-[1100ms] ease-in-out delay-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      >
        <p className="text-[13px] text-[var(--ed-ink-faint)]">
          NextRole &middot; {new Date().getFullYear()} &middot;{' '}
          <a
            href="https://github.com/ozShpigel/nextrole"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--ed-ink-faint)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ed-paper)] focus-visible:ring-[var(--ed-ink)] rounded-sm"
          >
            GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
