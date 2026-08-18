import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { matchApi } from '../lib/api';
import { useNormalizeProfileFile, useSaveProfile } from '../lib/mutations';
import { hydrateProfile, mergeNormalizedProfile } from '../lib/profile';
import type { NormalizedProfile, ProfileResponse } from '../lib/types';

// A staged "we're working on your behalf" beat shown while a résumé upload
// (handed off from LandingPage via route state) is actually parsed and
// saved — the real work runs underneath this animation, not before it, so
// the full ~10-20s Claude PDF-parse call is masked instead of happening
// silently behind a small button spinner with this page only flashing by
// at the very end. The step timings/labels are canned; only the final
// hold on "Finishing up" is real (bounded by the actual network call).
// Visiting this route with no file (e.g. directly) plays the same canned
// beat with nothing real underneath, then heads to Matches — a harmless
// fallback, and the visual slot a future real-time scraping progress feed
// can drop into later.
const STEPS = [
  { label: 'Reading your résumé', sub: 'Parsing structure, dates, and roles', duration: 1000 },
  { label: 'Extracting your experience', sub: 'Skills, seniority, and domains', duration: 1150 },
  { label: 'Mapping your skills to roles', sub: 'Matching your profile against open roles', duration: 1150 },
  { label: 'Scanning matching companies', sub: 'Checking fit against companies that hire for it', duration: 1300 },
] as const;
const WAITING_STEP = { label: 'Finishing up', sub: 'Wrapping up your matches' };

const TOTAL_MS = STEPS.reduce((sum, s) => sum + s.duration, 0);
const HOLD_MS = 550; // beat on the finished state before handing off
const WAITING_PROGRESS_CAP = 92; // never show 100% until real work (if any) actually resolved
const DEST = '/search';

// Hero visual: three overlapping circles drift together as fake progress
// advances, using mix-blend-mode: screen (the dark-background counterpart
// of the classic CMY-on-white Venn diagram trick — screen ADDS light
// instead of subtracting ink, so overlaps brighten toward white instead of
// darkening toward black) so every overlap generates its own blended color
// with zero manual math. This — and the checkmark payoff on completion —
// is the one deliberately non-flat, multi-hue moment in the app: everywhere
// else is flat and limited to a single --ed-accent, but this page gets a
// one-off exception for the sake of a genuine "wow" beat. The three hues
// are picked to be genuinely saturated (not existing --ed-* tokens, which
// are mostly desaturated neutrals by design) — screen-blending a near-white
// or muted tone just washes out instead of producing rich overlap colors.
const VENN_COLORS = ['#e0a23a', '#e8547f', '#2fb6c9']; // amber, raspberry, teal
const VENN_OFFSETS: [number, number][] = [[-1, 0.6], [0, -1], [1, 0.6]];

function VennVisual({ pct, finished }: { pct: number; finished: boolean }) {
  const t = Math.min(1, pct / 100);
  const ease = t * t * (3 - 2 * t); // smoothstep — a gentler approach/settle than linear
  const spread = 34 * (1 - ease); // % translate — shrinks to 0 (full overlap) as ease → 1
  const glowOpacity = 0.1 + ease * 0.35;

  return (
    <div className="relative w-[220px] h-[220px] mb-14" style={{ isolation: 'isolate' }} aria-hidden="true">
      {/* Blurred bloom behind the circles, intensifying as they converge —
          isolate above keeps this and the screen-blend circles from
          blending with anything behind the component (nav, grain texture).
          Kept tightly inset + a generous mb- below so the soft blur falloff
          never washes into the headline text underneath. */}
      <div
        className="absolute inset-[-8%] rounded-full blur-2xl transition-opacity duration-300"
        style={{ background: VENN_COLORS[0], opacity: glowOpacity }}
      />
      {VENN_COLORS.map((color, i) => {
        const [dx, dy] = VENN_OFFSETS[i];
        return (
          <div
            key={color}
            className="absolute inset-0 rounded-full transition-transform duration-300 ease-out"
            style={{
              backgroundColor: color,
              opacity: 0.75,
              mixBlendMode: 'screen',
              transform: `translate(${dx * spread}%, ${dy * spread}%)`,
            }}
          />
        );
      })}
      {finished && (
        <div className="absolute inset-0 flex items-center justify-center animate-in zoom-in-50 fade-in duration-500">
          <div className="w-11 h-11 rounded-full bg-[var(--ed-paper)] flex items-center justify-center shadow-lg">
            <Check size={20} className="text-[var(--ed-ink)]" strokeWidth={3} aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProcessingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const file = (location.state as { file?: File } | null)?.file ?? null;

  const normalizeFileMutation = useNormalizeProfileFile();
  const saveProfileMutation = useSaveProfile();

  const [stepIndex, setStepIndex] = useState(0);
  const [stepsDone, setStepsDone] = useState(false); // canned beat finished
  const [realDone, setRealDone] = useState(!file); // no file → nothing real to wait on
  const [finished, setFinished] = useState(false); // both done → holding on "You're all set"
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // The real upload — parse the handed-off file, merge into the current
  // profile, and save. Runs once, independent of the canned step timers.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const normalized = await normalizeFileMutation.mutateAsync(file) as NormalizedProfile;
        const profileRes = await matchApi('/profile') as ProfileResponse;
        const current = hydrateProfile(profileRes?.structured);
        const merged = mergeNormalizedProfile(current, normalized);
        await saveProfileMutation.mutateAsync(merged as unknown as Record<string, unknown>);
        if (!cancelled) setRealDone(true);
      } catch (e) {
        if (!cancelled) setError(`Couldn't parse résumé: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Advance through the canned step list on its own schedule, independent
  // of whether the real work above has resolved yet.
  useEffect(() => {
    const timeouts = STEPS.map((_, i) => {
      const at = STEPS.slice(0, i + 1).reduce((sum, s) => sum + s.duration, 0);
      return setTimeout(() => {
        if (i === STEPS.length - 1) setStepsDone(true);
        else setStepIndex(i + 1);
      }, at);
    });
    return () => timeouts.forEach(clearTimeout);
  }, []);

  // Only once BOTH the canned beat and the real work (if any) are done —
  // never navigate away while a real upload is still in flight.
  useEffect(() => {
    if (!stepsDone || !realDone || error) return;
    setFinished(true);
    const handoff = setTimeout(() => navigate(DEST, { replace: true }), HOLD_MS);
    return () => clearTimeout(handoff);
  }, [stepsDone, realDone, error, navigate]);

  // Smooth 0→100 progress, driven by elapsed wall time rather than step
  // count so it reads as one continuous process instead of four jumps —
  // also what lights up the constellation nodes below. Capped short of
  // 100 until real work resolves so it never reads as "done" prematurely.
  useEffect(() => {
    function tick(now: number): void {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const cap = realDone ? 100 : WAITING_PROGRESS_CAP;
      setProgress(Math.min(cap, (elapsed / TOTAL_MS) * cap));
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [realDone]);

  const pct = finished ? 100 : progress;
  const waiting = stepsDone && !realDone && !error;
  const active = finished ? null : waiting ? WAITING_STEP : STEPS[stepIndex];

  if (error) {
    return (
      <div className="editorial editorial-grain min-h-[calc(100vh-56px)] flex items-center justify-center px-6">
        <div className="relative z-[1] w-full max-w-[420px] flex flex-col items-center text-center animate-in fade-in duration-500">
          <p className="text-[0.81rem] tracking-[0.16em] uppercase text-[var(--ed-ink-faint)] font-medium mb-3">
            Setting up your search
          </p>
          <h1 className="text-[2.5rem] leading-[1.08] font-medium text-[var(--ed-ink)] mb-2">Something went wrong</h1>
          <p className="text-[0.88rem] text-[var(--ed-no)] mb-9">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="rounded-full border border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] px-5 py-[0.55rem] text-[0.72rem] font-semibold uppercase tracking-[0.08em] transition-all hover:bg-[var(--ed-accent-deep)]"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] flex items-center justify-center px-6">
      <div className="relative z-[1] w-full max-w-[420px] flex flex-col items-center animate-in fade-in duration-500">

        <VennVisual pct={pct} finished={finished} />

        <div className="w-full flex flex-col items-center">
          <h1
            key={finished ? 'done' : active!.label}
            className="text-[1.75rem] leading-[1.2] font-medium text-[var(--ed-ink)] text-center animate-in fade-in slide-in-from-bottom-1 duration-300"
          >
            {finished ? "You're all set" : active!.label}
          </h1>
          <p
            key={finished ? 'done-sub' : active!.sub}
            className="text-[0.92rem] text-[var(--ed-ink-soft)] text-center mt-1.5 mb-5 animate-in fade-in duration-300"
          >
            {finished ? 'Taking you to your matches' : active!.sub}
          </p>

          <div className="h-[2px] w-full max-w-[300px] bg-[var(--ed-rule)] overflow-hidden">
            <div
              className="h-full bg-[var(--ed-accent)] transition-[width] duration-200 ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>

          <button
            type="button"
            onClick={() => navigate(DEST, { replace: true })}
            className="mt-10 text-[0.81rem] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink-soft)] transition-colors"
          >
            Skip &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
