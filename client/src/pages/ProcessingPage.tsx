import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { discoveryApi, matchApi } from '../lib/api';
import { useNormalizeProfileFile, useSaveProfile } from '../lib/mutations';
import { useHasProfile } from '../lib/queries';
import { hydrateProfile, mergeNormalizedProfile } from '../lib/profile';
import type { NormalizedProfile, ProfileResponse } from '../lib/types';

// The waiting state for a résumé upload handed off from LandingPage via route
// state. The real work runs underneath this, not before it, so the full Claude
// PDF-parse call is masked instead of happening behind a small button spinner.
//
// **The animation is driven by the work, never by a clock.** It used to run on
// canned step durations totalling 4.6s while a parse takes 10-20s and varies
// with CV length and API latency, so the circles finished merging and then sat
// there — a completed animation with nothing happening, which reads as stuck.
// Capping fake progress at 92% did not help: the convergence is smoothstepped,
// and smoothstep(0.92) is 0.982, so "92%" was already one circle.
//
// Now each of the three circles belongs to one real milestone of the upload
// chain, and only that milestone moves it:
//
//   1. normalize-file returns   — the long one, Claude reading the PDF
//   2. the merged profile is saved
//   3. the first scores land    — the pool scanned against that profile
//
// Nothing can finish early because there is no elapsed-time path to the end
// state. Between milestones the waiting circles drift on a slow sine so the
// page is visibly alive, which is deliberately NOT progress: progress only
// ever moves when something actually completed.
//
// The third milestone is why this page waits as long as it does on a first
// upload. Handing a new visitor an empty Matches tab and letting them discover
// the scan themselves is a worse first minute than a page that says what it is
// doing — so the scan is started here and the redirect waits for it to produce
// something. A scan scores five batches concurrently, so the first round lands
// ~25 jobs at once (~80s measured); the rest arrive behind "Score more".
const STAGES = [
  { label: 'Reading your résumé', sub: 'Parsing structure, dates, and roles' },
  { label: 'Saving your profile', sub: 'Skills, seniority, and domains' },
  { label: 'Finding your matches', sub: 'Scoring open roles against your profile' },
] as const;

// How often to ask whether the scan has produced anything yet. The work takes
// ~80s to first results, so this is not a hot loop.
const MATCH_POLL_MS = 4000;

// Does this user have any scored job yet? Asked of the same endpoint the
// Matches page reads, so "there is something to show" here means exactly what
// it will mean a second later on arrival. limit=1 because the count is all
// that matters; a scan failure reads as "nothing yet" and the poll continues
// until the caller's own timeout ends it.
async function hasAnyMatch(): Promise<boolean> {
  try {
    const res = await discoveryApi('/jobs?limit=1&days_back=60') as { total?: number };
    return (res?.total ?? 0) > 0;
  } catch {
    return false;
  }
}

// A response that arrives in 300ms must not flash the whole state in and out.
const MIN_DISPLAY_MS = 1100;
const HOLD_MS = 650;        // beat on "You're all set" before handing off
const DEST = '/search';

// Hero visual: three overlapping circles drift together as real milestones
// land, using mix-blend-mode: screen (the dark-background counterpart of the
// classic CMY-on-white Venn trick — screen ADDS light instead of subtracting
// ink, so overlaps brighten toward white instead of darkening toward black) so
// every overlap generates its own blended color with zero manual math. This —
// and the checkmark payoff — is the one deliberately non-flat, multi-hue moment
// in the app: everywhere else is flat and limited to a single --ed-accent, but
// this page gets a one-off exception for the sake of a genuine "wow" beat. The
// three hues are picked to be genuinely saturated (not existing --ed-* tokens,
// which are mostly desaturated neutrals by design) — screen-blending a
// near-white or muted tone just washes out instead of producing rich overlaps.
const VENN_COLORS = ['#e0a23a', '#e8547f', '#2fb6c9']; // amber, raspberry, teal
const VENN_OFFSETS: [number, number][] = [[-1, 0.6], [0, -1], [1, 0.6]];
const SPREAD = 34;   // % translate of a circle still waiting on its milestone
const WOBBLE = 2.4;  // % of idle drift — liveness, not progress

function VennVisual({ merged, finished, t }: { merged: number; finished: boolean; t: number }) {
  // Decided once, here, and used for BOTH the rendering and the test hook
  // below. Computing them separately is how a check ends up measuring the
  // intent instead of the outcome: an earlier version reported `merged` on the
  // element while each circle decided its own position, so reintroducing a
  // time-based merge left the attribute — and the test reading it — untouched.
  const settled = VENN_COLORS.map((_, i) => i < merged);
  const settledCount = settled.filter(Boolean).length;
  const glowOpacity = 0.1 + (settledCount / VENN_COLORS.length) * 0.35;

  return (
    <div
      className="relative w-[220px] h-[220px] mb-14"
      style={{ isolation: 'isolate' }}
      aria-hidden="true"
      // How many circles have merged, which is by construction how many
      // milestones have landed. Exposed so a test can assert the rule this
      // component exists to keep — that the end state is caused by the work
      // and never by elapsed time — directly, instead of inferring it from
      // whichever label happens to be on screen.
      data-testid="venn"
      data-merged={settledCount}
    >
      {/* Blurred bloom behind the circles, intensifying as they converge —
          isolate above keeps this and the screen-blend circles from blending
          with anything behind the component (nav, grain texture). Kept tightly
          inset + a generous mb- below so the soft blur falloff never washes
          into the headline text underneath. */}
      <div
        className="absolute inset-[-8%] rounded-full blur-2xl transition-opacity duration-700"
        style={{ background: VENN_COLORS[0], opacity: glowOpacity }}
      />
      {VENN_COLORS.map((color, i) => {
        const [dx, dy] = VENN_OFFSETS[i];
        // Two nested transforms on purpose. The outer one is the milestone —
        // a single large move with a long transition, so a completed stage
        // reads as one deliberate event. The inner one is the idle drift, and
        // it has NO transition: sharing one transform would let the 900ms
        // easing swallow the drift and smear the milestone into it.
        const wobble = settled[i] ? 0 : WOBBLE * Math.sin(t / 760 + i * 2.1);
        return (
          <div
            key={color}
            className="absolute inset-0"
            style={{
              transform: `translate(${dx * (settled[i] ? 0 : SPREAD)}%, ${dy * (settled[i] ? 0 : SPREAD)}%)`,
              transition: 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <div
              className="w-full h-full rounded-full"
              style={{
                backgroundColor: color,
                opacity: 0.75,
                mixBlendMode: 'screen',
                transform: `translate(${dx * wobble}%, ${dy * wobble}%)`,
              }}
            />
          </div>
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

  // How many of the three milestones have landed. The only thing that moves
  // the animation forward.
  const [stage, setStage] = useState(0);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Milliseconds since mount, ticked while work is in flight. Feeds the idle
  // drift and the within-stage creep on the bar; never reaches an end state.
  const [t, setT] = useState(0);

  const mountRef = useRef<number>(Date.now());
  const stageStartRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  // The upload must run once per file, not once per effect invocation.
  const uploadedRef = useRef<File | null>(null);
  // Whether this visitor already had matches when they arrived, captured once:
  // the upload saves a profile part-way through, so reading it live would flip
  // a first-time visitor into a returning one mid-animation.
  const hasProfile = useHasProfile();
  const hadProfileAtMount = useRef<boolean | null>(null);
  if (hadProfileAtMount.current === null && hasProfile !== undefined) {
    hadProfileAtMount.current = hasProfile;
  }

  // The real upload — parse the handed-off file, merge into the current
  // profile, and save. Each await is a stage: setStage after it resolves and
  // the corresponding circle moves in.
  //
  // StrictMode invokes this effect twice on mount, and the awaited mutations
  // run to completion either way — a cleanup flag only ever suppressed the
  // setState that followed them. Two Claude PDF reads and two profile saves
  // per upload, each save also firing the pool-role classifier: six
  // normalize-file calls for three CVs in the logs. The ref is keyed by the
  // File itself, so a genuinely new file still uploads and a re-invocation for
  // the same one does not.
  //
  // There is deliberately NO `cancelled` flag alongside it. The two together
  // cancel the upload outright: the ref lets only the FIRST invocation run,
  // and that invocation's own cleanup is what sets the flag — so the parse
  // completed, every `if (cancelled) return` fired, and the profile was never
  // saved. In dev the upload silently did nothing at all. (Found in a browser:
  // the fetch showed 18s and succeeded in performance.getEntriesByType, while
  // the page sat on "Reading your résumé". Neither tsc nor the tests saw it.)
  //
  // Nothing is needed in its place. A setState after unmount is a no-op in
  // React 18, and letting the chain finish is what we want anyway — clicking
  // Skip mid-parse should still save the profile being paid for, not discard
  // it.
  useEffect(() => {
    if (!file) return;
    if (uploadedRef.current === file) return;
    uploadedRef.current = file;
    (async () => {
      try {
        const normalized = await normalizeFileMutation.mutateAsync(file) as NormalizedProfile;
        setStage(1);

        const profileRes = await matchApi('/profile') as ProfileResponse;
        const current = hydrateProfile(profileRes?.structured);
        const merged = mergeNormalizedProfile(current, normalized);
        await saveProfileMutation.mutateAsync(merged as unknown as Record<string, unknown>);
        setStage(2);

        // Scoring the pool takes minutes and resolves long after the first
        // results are worth looking at, so this does not await it. It polls
        // for what the scan writes instead: rows land per batch, and the
        // first batch is enough to redirect on.
        //
        // The scan is deliberately NOT awaited for a second reason — if this
        // request is interrupted the scoring carries on server-side, and the
        // rows already written are kept.
        void matchApi('/pool-scan', { method: 'POST' }).catch(() => {
          // A failed scan is not a failed upload. The profile is saved, and
          // Matches will try again on arrival; falling into the error state
          // here would throw away work that succeeded.
        });

        while (!(await hasAnyMatch())) {
          await new Promise((r) => setTimeout(r, MATCH_POLL_MS));
        }
        setStage(3);
      } catch (e) {
        // The circles stay wherever the failure caught them — an upload that
        // died in the parse must not finish merging on its way to an error.
        setError(`Couldn't parse résumé: ${(e as Error).message}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // No file to process (this route reached directly, or the demo instance's
  // fake picker): there are no milestones to wait for, so walk the stages on a
  // short beat rather than sitting on three separate circles forever.
  useEffect(() => {
    if (file) return;
    const timers = STAGES.map((_, i) => setTimeout(() => setStage(i + 1), 260 * (i + 1)));
    return () => timers.forEach(clearTimeout);
  }, [file]);

  // Reset the within-stage clock whenever a milestone lands, so the creep
  // below restarts its approach instead of continuing from the old stage.
  useEffect(() => {
    stageStartRef.current = Date.now() - mountRef.current;
  }, [stage]);

  // Ticks only while there is something to wait for. Stopping it on finish or
  // error freezes the drift, which is what makes a failed upload read as
  // stopped rather than paused.
  useEffect(() => {
    if (finished || error) return;
    function tick(): void {
      setT(Date.now() - mountRef.current);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [finished, error]);

  // All three milestones in. The minimum display keeps a fast response from
  // flashing the whole sequence in and out.
  useEffect(() => {
    if (stage < STAGES.length || error) return;
    const remaining = Math.max(0, MIN_DISPLAY_MS - (Date.now() - mountRef.current));
    const settle = setTimeout(() => setFinished(true), remaining);
    return () => clearTimeout(settle);
  }, [stage, error]);

  useEffect(() => {
    if (!finished) return;
    // `scanning` tells Matches that a scan for this user is already in flight
    // — the one started above, which keeps going after the redirect until all
    // fifty are scored. Without it Matches fires its own on mount, and since a
    // scan excludes what is already scored, the second one would take the NEXT
    // fifty candidates: a whole extra scan's spend, for a user who has not
    // looked at the first twenty-five yet.
    const handoff = setTimeout(
      () => navigate(DEST, { replace: true, state: { scanning: true } }),
      HOLD_MS,
    );
    return () => clearTimeout(handoff);
  }, [finished, navigate]);

  // The bar earns a third per completed milestone. Inside a stage it creeps
  // asymptotically toward that third — always moving, decelerating, and never
  // arriving, so a long parse still looks alive without the bar claiming
  // ground the work has not taken.
  const stageSpan = 100 / STAGES.length;
  const creep = 1 - Math.exp(-Math.max(0, t - stageStartRef.current) / 5000);
  const pct = finished
    ? 100
    : Math.min(97, stage * stageSpan + (stage < STAGES.length ? creep * stageSpan * 0.8 : 0));

  const active = STAGES[Math.min(stage, STAGES.length - 1)];
  const headline = error ? 'Something went wrong' : finished ? "You're all set" : active.label;
  const sub = error ? error : finished ? 'Taking you to your matches' : active.sub;

  return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] flex items-center justify-center px-6">
      <div className="relative z-[1] w-full max-w-[420px] flex flex-col items-center animate-in fade-in duration-500">

        {/* Kept on the error path too, frozen at the milestone the upload
            reached. Swapping to a bare error card would hide how far it got,
            and a visual that never completed is the honest record of that. */}
        <VennVisual merged={error ? stage : finished ? STAGES.length : stage} finished={finished} t={t} />

        <div className="w-full flex flex-col items-center">
          <h1
            key={headline}
            className="text-[1.75rem] leading-[1.2] font-medium text-[var(--ed-ink)] text-center animate-in fade-in slide-in-from-bottom-1 duration-300"
          >
            {headline}
          </h1>
          <p
            key={sub}
            className={`text-[0.92rem] text-center mt-1.5 mb-5 animate-in fade-in duration-300 ${
              error ? 'text-[var(--ed-no)]' : 'text-[var(--ed-ink-soft)]'
            }`}
          >
            {sub}
          </p>

          {!error && (
            <div className="h-[2px] w-full max-w-[300px] bg-[var(--ed-rule)] overflow-hidden">
              <div
                className="h-full bg-[var(--ed-accent)] transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {error ? (
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="mt-4 rounded-full border border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] px-5 py-[0.55rem] text-[0.72rem] font-semibold uppercase tracking-[0.08em] transition-all hover:bg-[var(--ed-accent-deep)]"
            >
              Back to Home
            </button>
          ) : (
            // Hidden on a first upload, because there is nowhere useful to skip
            // TO: Matches is empty until this scan lands, so the escape hatch
            // leads to a blank screen and reads as the product being broken.
            // Someone who already has matches can leave whenever they like —
            // re-uploading is an edit, not an introduction.
            hadProfileAtMount.current === true && (
              <button
                type="button"
                onClick={() => navigate(DEST, { replace: true, state: { scanning: true } })}
                className="mt-10 text-[0.81rem] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink-soft)] transition-colors"
              >
                Skip &rarr;
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
