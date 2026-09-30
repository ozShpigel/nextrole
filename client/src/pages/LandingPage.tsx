import { useEffect, useRef, useState } from 'react';
import { startCvUpload, useCvUpload, type CvUploadState } from '../lib/cvUpload';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Upload } from 'lucide-react';
import { useHasProfile } from '../lib/queries';
import PipelineScene from '../components/PipelineScene';
import { GoogleMark } from '../components/GoogleMark';

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

// Company marks for the "Matching roles from…" row, drawn as app-icon tiles:
// every mark sits on the same rounded square, on the brand's own tile color,
// so the row reads as one set instead of differently-shaped glyphs. Brand
// colors are the one place hex is allowed on this page — they are the
// companies' colors, not ours. Illustrative examples, not a claim about
// actual data sources.
type CompanyTile = { name: string; tile: string; glyph: React.ReactNode };

const COMPANY_LOGOS: CompanyTile[] = [
  { name: 'Google', tile: '#ffffff', glyph: <GoogleMark size="62%" /> },
  {
    name: 'Meta',
    tile: '#0866FF',
    glyph: (
      <svg width="72%" height="72%" viewBox="0 0 48 48" aria-hidden="true">
        <path
          d="M6 30.5c0-7.6 4-15 9.6-15 4.3 0 7.4 3.6 11.3 10.2l2.4 4.1c2.8 4.7 4.9 6.8 7.6 6.8 3.2 0 5.1-3 5.1-7.4 0-6.1-3-11.9-7.3-11.9-3.3 0-5.8 2.8-8.9 7.9l-2.2 3.6c-3.3 5.4-6 7.8-9.8 7.8C9.1 36.6 6 34.1 6 30.5z"
          fill="none" stroke="#fff" strokeWidth="3.6" strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    name: 'Amazon',
    tile: '#131A22',
    glyph: (
      <svg width="80%" height="80%" viewBox="0 0 48 48" aria-hidden="true">
        <text x="24" y="25" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Arial, Helvetica, sans-serif">amazon</text>
        <path d="M11 30c7.5 5 18.5 5 26 0" stroke="#FF9900" strokeWidth="2.8" strokeLinecap="round" fill="none" />
        <path d="M33.2 28.4l4.2.9-1.6 4" stroke="#FF9900" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),
  },
  {
    name: 'Microsoft',
    tile: '#1b1b1b',
    glyph: (
      <svg width="54%" height="54%" viewBox="0 0 44 44" aria-hidden="true">
        <rect x="1" y="1" width="19.5" height="19.5" fill="#F35325" />
        <rect x="23.5" y="1" width="19.5" height="19.5" fill="#81BC06" />
        <rect x="1" y="23.5" width="19.5" height="19.5" fill="#05A6F0" />
        <rect x="23.5" y="23.5" width="19.5" height="19.5" fill="#FFBA08" />
      </svg>
    ),
  },
  {
    name: 'Netflix',
    tile: '#000000',
    glyph: (
      <svg width="40%" height="62%" viewBox="0 0 26 40" aria-hidden="true">
        <path d="M2 0h6.4l9.6 26V0H24v40c-2-.3-4.2-.5-6.4-.6L8 13.6V39c-2 .1-4 .3-6 .6V0z" fill="#E50914" />
      </svg>
    ),
  },
  {
    name: 'Airbnb',
    tile: '#FF5A5F',
    glyph: (
      <svg width="64%" height="64%" viewBox="0 0 48 48" aria-hidden="true">
        <path
          d="M24 34.5c-3.6-4.4-6-8.6-6-11.8 0-3.5 2.6-5.7 6-5.7s6 2.2 6 5.7c0 3.2-2.4 7.4-6 11.8zm0 0c4.6 4.6 9.6 6.6 12.6 3.8 2.6-2.4 1.6-6.4-.6-11.2L27.6 9.4C26.6 7.3 25.4 6 24 6s-2.6 1.3-3.6 3.4L12 27.1c-2.2 4.8-3.2 8.8-.6 11.2 3 2.8 8 .8 12.6-3.8z"
          fill="none" stroke="#fff" strokeWidth="3.2" strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    name: 'Spotify',
    tile: '#121212',
    glyph: (
      <svg width="66%" height="66%" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="22" fill="#1ED760" />
        <path d="M12.5 18.5c7.5-2.3 16.5-1.4 23 2.6" stroke="#121212" strokeWidth="3.4" strokeLinecap="round" fill="none" />
        <path d="M14 25.2c6.2-1.8 13.4-1 18.6 2.2" stroke="#121212" strokeWidth="3" strokeLinecap="round" fill="none" />
        <path d="M15.4 31.4c5-1.3 10.4-.8 14.5 1.6" stroke="#121212" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      </svg>
    ),
  },
  {
    name: 'Reddit',
    tile: '#FF4500',
    glyph: (
      <svg width="68%" height="68%" viewBox="0 0 48 48" aria-hidden="true">
        <ellipse cx="24" cy="28" rx="14" ry="10.5" fill="#fff" />
        <circle cx="10.5" cy="23" r="3.6" fill="#fff" />
        <circle cx="37.5" cy="23" r="3.6" fill="#fff" />
        <circle cx="18.5" cy="27" r="2.4" fill="#FF4500" />
        <circle cx="29.5" cy="27" r="2.4" fill="#FF4500" />
        <path d="M18.5 32.5c3 2.2 8 2.2 11 0" stroke="#FF4500" strokeWidth="1.9" strokeLinecap="round" fill="none" />
        <path d="M24 17.5l2.2-8.2 6.2 1.6" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="34.4" cy="11.4" r="2.6" fill="#fff" />
      </svg>
    ),
  },
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
    <div className="flex items-center justify-start gap-3.5 max-sm:gap-2.5">
      {indices.map((logoIndex, slot) => {
        const logo = COMPANY_LOGOS[logoIndex];
        return (
          <div key={slot} className="w-11 h-11 max-sm:w-10 max-sm:h-10">
            <div
              key={logoIndex}
              title={logo.name}
              style={{ background: logo.tile }}
              className="w-full h-full rounded-[12px] border border-[var(--ed-rule-strong)] flex items-center justify-center overflow-hidden shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ed-ink)_14%,transparent)] animate-in fade-in zoom-in-90 duration-500"
            >
              {logo.glyph}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const hasProfile = useHasProfile();
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
    <div className="editorial editorial-grain home-atmosphere relative min-h-[calc(100vh-56px)] flex flex-col overflow-x-clip">
      {/* Runpod-style hero: the pitch bottom-left, the pipeline scene large on
          the right and allowed to run off the edge. Stacks on narrow screens,
          scene first. */}
      <div className="relative z-[2] flex-1 grid items-center gap-6 px-[clamp(1.25rem,5vw,5rem)] pt-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-0">
        <div
          className={`text-left max-w-[34rem] md:self-end md:pb-[clamp(2rem,9vh,6rem)] transition-[opacity,transform] duration-1000 ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[18px]'}`}
          style={{ transitionTimingFunction: 'ease, cubic-bezier(0.22, 1, 0.36, 1)' }}
        >
          {/* The promise is the headline; the wordmark lives in the nav. */}
          <h1 className="m-0 font-medium text-[clamp(2.9rem,5.4vw,4.9rem)] leading-[1.02] tracking-[-0.03em]">
            <span className="block text-[var(--ed-ink)]">Know it fits.</span>
            <span className="inline-block ed-hero-gradient pb-[0.08em] pr-[0.04em]">Apply.</span>
          </h1>

          {ours?.phase === 'error' && (
            <p role="alert" className="mt-5 text-[16px] text-[var(--ed-no)]">
              Couldn’t read that résumé — try another file.
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-start gap-5">
            {reading || found ? (
              <UploadCard upload={(reading ? ours : found)!} />
            ) : (
            <button
              type="button"
              onClick={onUploadClick}
              className="group inline-flex items-center gap-2 rounded-full bg-[var(--ed-accent)] text-[var(--ed-paper)] px-4 py-[0.45rem] text-[13px] font-semibold tracking-[0.01em] transition-all hover:bg-[var(--ed-accent-deep)] hover:-translate-y-[1px]"
            >
              <Upload size={13}className="transition-transform group-hover:-translate-y-0.5" aria-hidden="true" />
              {ours?.phase === 'error' ? 'Try another file' : 'Upload Resume'}
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
          <div className="mt-12 pt-7 border-t border-dashed border-[var(--ed-rule)] max-w-[26rem]">
            <p className="text-[0.62rem] tracking-[0.26em] uppercase text-[var(--ed-ink-faint)] font-semibold mb-6">
              Matching roles from…
            </p>
            <LogoMarquee />
          </div>
        </div>

        <div className="order-first md:order-none md:scale-[1.16] md:origin-left">
          <PipelineScene />
        </div>
      </div>

      {/* Footer */}
      <footer
        className={`relative z-[2] pt-8 pb-6 flex flex-col items-center gap-[0.85rem] text-[var(--ed-ink-faint)] transition-opacity duration-[1100ms] ease-in-out delay-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}
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
