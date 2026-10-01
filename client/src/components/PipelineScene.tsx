import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { scoreColor } from '../lib/format';
import { SCENE_LOGOS } from './sceneLogos';

// The Landing page's picture of the pipeline — an isometric floor with each
// stage standing on it and a story playing across it on a loop: listings come
// in every day from several sources and land in the shared pool, a candidate
// hands in their résumé, the pool and the résumé meet in AI matching, a score
// counts up and a new match slides into the ranked list, Gmail sends a reply
// in, and the match goes on to an interview. The story plays once per round,
// each for a résumé from a different country (ROUNDS): one pool, a different
// fit for each. Change the pipeline and this should change with it, and rerun
// scripts/export-pipeline-scene.cjs: the README shows an exported copy.
//
// Accent-lit faces and glowing edges by design (docs/design-system.md →
// Landing pipeline scene); the AGENTS.md guardrails still hold here: tokens
// only (the flags are marks, like company logos), the score on the score
// ramp, a still frame under reduced motion.
//
// Pure SVG, laid out on a grid and projected here, so every object sits on
// the same floor and the routes stay on the grid lines. Colors come from
// classes in index.css (.nr-scene…) — SVG presentation attributes cannot
// read CSS variables, but CSS properties set by a class (fill, stop-color)
// can.

const TILE_W = 28; // half a tile's width, in viewBox units
const TILE_H = 14; // half a tile's height
const ORIGIN_X = 360;
const ORIGIN_Y = 44;
const GRID = 12;

type Pt = [number, number];

// Grid (gx, gy) and height z → viewBox point.
function iso(gx: number, gy: number, z = 0): Pt {
  return [ORIGIN_X + (gx - gy) * TILE_W, ORIGIN_Y + (gx + gy) * TILE_H - z];
}

const pts = (ps: Pt[]) => ps.map(([x, y]) => `${x},${y}`).join(' ');

// ---- The story's clock -------------------------------------------------
// Every story animation places its moment inside a loop with keyTimes, so the
// beats stay in order without chaining. What happens in every round (the
// listings, the packets) loops every CYCLE seconds; what belongs to one
// round's résumé (its candidate, its flag, its score) loops every LONG.
const CYCLE = 12;
// One round per résumé the story follows, each from a different country, so
// the loop reads as "anyone, anywhere" rather than as two markets. Add a
// round here and every per-round element follows: candidate, flag, score.
const ROUNDS = [
  { flag: 'il', city: 'TEL AVIV', score: 92 },
  { flag: 'uk', city: 'LONDON', score: 88 },
  { flag: 'de', city: 'BERLIN', score: 90 },
  { flag: 'us', city: 'NEW YORK', score: 86 },
] as const;
type FlagKind = (typeof ROUNDS)[number]['flag'];
const LONG = CYCLE * ROUNDS.length;
// Two résumés stand on the floor and take turns: round r is résumé r % SLOTS,
// whose flag switches to the new country as its next round begins.
const SLOTS = 2;
const roundsOf = (slot: number) => ROUNDS.map((_, r) => r).filter((r) => r % SLOTS === slot);
const BEAT = {
  src1: [0.2, 1.4],        // the sources → the shared pool
  src2: [0.45, 1.65],
  src3: [0.7, 1.9],
  src4: [0.95, 2.15],
  candidate: [1.1, 1.8],   // the round's candidate hands in their résumé
  scan: [1.6, 2.6],        // the résumé is read
  pool: [2.3, 3.4],        // shared pool → AI matching
  resume: [2.3, 3.4],      // résumé → AI matching
  think: [3.4, 3.9],       // AI matching fires
  match: [3.9, 4.6],       // AI matching → your matches
  score: [4.7, 5.9],       // the score counts up
  row: [5.9, 6.5],         // the new match slides into the list
  lid: [6.7, 7.5],         // the envelope opens
  gmail: [7.0, 8.2],       // a reply comes in, read by AI
  interview: [8.6, 9.8],   // your matches → interviews
  bubble: [9.8, 11.3],     // the interview is under way, prepped by AI
} as const;
const END = 11.4;

const kt = (s: number, cycle = CYCLE) => (Math.min(Math.max(s, 0), cycle) / cycle).toFixed(4);
const loopOf = (cycle: number) => ({ dur: `${cycle}s`, repeatCount: 'indefinite' }) as const;
const loop = loopOf(CYCLE);

// Visible from a to b, with short fades either side.
function Window({ a, b, fade = 0.2, cycle = CYCLE }: { a: number; b: number; fade?: number; cycle?: number }) {
  return (
    <animate
      attributeName="opacity"
      values="0;0;1;1;0;0"
      keyTimes={`0;${kt(a, cycle)};${kt(a + fade, cycle)};${kt(b, cycle)};${kt(b + fade, cycle)};1`}
      {...loopOf(cycle)}
    />
  );
}

// A Window that opens only in one round of the long loop.
function RoundWindow({ round, a, b, fade }: { round: number; a: number; b: number; fade?: number }) {
  return <Window a={round * CYCLE + a} b={round * CYCLE + b} fade={fade} cycle={LONG} />;
}

// Visible from a to b (round-relative) in each of several rounds — one
// animation, because two on the same attribute would override each other.
function RoundsWindow({ rounds, a, b, fade = 0.2 }: { rounds: number[]; a: number; b: number; fade?: number }) {
  const keys = ['0'];
  const vals = ['0'];
  for (const r of rounds) {
    const o = r * CYCLE;
    keys.push(kt(o + a, LONG), kt(o + a + fade, LONG), kt(o + b, LONG), kt(o + b + fade, LONG));
    vals.push('0', '1', '1', '0');
  }
  keys.push('1');
  vals.push('0');
  return <animate attributeName="opacity" values={vals.join(';')} keyTimes={keys.join(';')} {...loopOf(LONG)} />;
}

// Shown for a whole stretch of the long loop, from one round's start until
// the start of `span` rounds later (wrapping past the end), switching without
// a fade: a résumé's flag, held until that résumé's next round.
function Hold({ round, span }: { round: number; span: number }) {
  const from = round * CYCLE;
  const to = (round + span) * CYCLE;
  const wrap = to > LONG;
  const values = wrap ? '1;0;1' : from === 0 ? '1;0' : '0;1;0';
  const keyTimes = wrap
    ? `0;${kt(to - LONG, LONG)};${kt(from, LONG)}`
    : from === 0 ? `0;${kt(to, LONG)}` : `0;${kt(from, LONG)};${kt(to, LONG)}`;
  return <animate attributeName="opacity" values={values} keyTimes={keyTimes} calcMode="discrete" {...loopOf(LONG)} />;
}

// A quick flash when something arrives.
function Flash({ at }: { at: number }) {
  return (
    <animate attributeName="opacity" values="0;0;1;0;0" keyTimes={`0;${kt(at)};${kt(at + 0.12)};${kt(at + 0.9)};1`} {...loop} />
  );
}

// ---- Shapes ------------------------------------------------------------

type Tone = 'strong' | 'soft';

// An isometric box centred on (gx, gy): half-extents in grid units, base and
// height in viewBox units. Only the three faces a viewer can see are drawn.
// `rim` lights the top's front edges — the glowing seam.
function Box({ gx, gy, w, d, z = 0, h, tone = 'soft', top = 'nr-top', rim = false }: {
  gx: number; gy: number; w: number; d: number; z?: number; h: number; tone?: Tone; top?: string; rim?: boolean;
}) {
  const x0 = gx - w, x1 = gx + w, y0 = gy - d, y1 = gy + d, zt = z + h;
  return (
    <g>
      <polygon className="nr-side" fill={`url(#nr-l-${tone})`} points={pts([iso(x0, y1, z), iso(x1, y1, z), iso(x1, y1, zt), iso(x0, y1, zt)])} />
      <polygon className="nr-side" fill={`url(#nr-r-${tone})`} points={pts([iso(x1, y0, z), iso(x1, y1, z), iso(x1, y1, zt), iso(x1, y0, zt)])} />
      <polygon className={top} points={pts([iso(x0, y0, zt), iso(x1, y0, zt), iso(x1, y1, zt), iso(x0, y1, zt)])} />
      {rim && <polyline className="nr-rim" filter="url(#nr-glow)" points={pts([iso(x0, y1, zt), iso(x1, y1, zt), iso(x1, y0, zt)])} />}
    </g>
  );
}

// A face-shaped overlay for the top of a box — used to flash or tint it.
function TopFace({ gx, gy, w, d, z, className, children }: {
  gx: number; gy: number; w: number; d: number; z: number; className: string; children?: ReactNode;
}) {
  return (
    <polygon className={className} opacity={0} points={pts([iso(gx - w, gy - d, z), iso(gx + w, gy - d, z), iso(gx + w, gy + d, z), iso(gx - w, gy + d, z)])}>
      {children}
    </polygon>
  );
}

// The lit tile a stage stands on.
function Pad({ gx, gy, r = 1 }: { gx: number; gy: number; r?: number }) {
  return <polygon className="nr-pad" points={pts([iso(gx - r, gy - r), iso(gx + r, gy - r), iso(gx + r, gy + r), iso(gx - r, gy + r)])} />;
}

// The skews that lay flat things on the floor (or on a face) along the gx
// axis (down-right) or the gy axis (up-right), the way the grid lines run.
const AXIS = { x: '0.894 0.447 0 1', y: '0.894 -0.447 0 1' } as const;

// A label lying on the floor.
function FloorLabel({ gx, gy, text, axis = 'x', small = false }: { gx: number; gy: number; text: string; axis?: 'x' | 'y'; small?: boolean }) {
  const [x, y] = iso(gx, gy);
  const width = text.length * (small ? 6.9 : 9.4) + (small ? 11 : 16);
  return (
    <g transform={`matrix(${AXIS[axis]} ${x} ${y})`}>
      <rect className="nr-label-bg" x={0} y={small ? -10.5 : -14} width={width} height={small ? 14.5 : 20} rx={3} />
      <text className={small ? 'nr-label-sm' : 'nr-label'} x={small ? 5.5 : 8} y={small ? 0.5 : 1}>{text}</text>
    </g>
  );
}

// Staggers each object's rise onto the floor when the scene first shows.
function Rise({ delay, children }: { delay: number; children: ReactNode }) {
  return <g className="nr-rise" style={{ '--d': `${delay}s` } as CSSProperties}>{children}</g>;
}

// An 18×12 flag, drawn from its top-left corner.
function Flag({ kind }: { kind: FlagKind }) {
  if (kind === 'de') {
    return (
      <g>
        <rect className="nr-flag-de-black" width={18} height={4} />
        <rect className="nr-flag-de-red" y={4} width={18} height={4} />
        <rect className="nr-flag-de-gold" y={8} width={18} height={4} />
        <rect className="nr-flag-frame" width={18} height={12} />
      </g>
    );
  }
  if (kind === 'us') {
    // Thirteen stripes and the canton; the stars are below the size it's drawn at.
    const stripe = 12 / 13;
    return (
      <g>
        <rect className="nr-flag-white" width={18} height={12} />
        {[0, 2, 4, 6, 8, 10, 12].map((i) => (
          <rect key={i} className="nr-flag-us-red" y={i * stripe} width={18} height={stripe} />
        ))}
        <rect className="nr-flag-us-blue" width={7.2} height={7 * stripe} />
        <rect className="nr-flag-frame" width={18} height={12} />
      </g>
    );
  }
  if (kind === 'il') {
    const star = (flip: number) => pts([[9, 6 - 2.6 * flip], [11.25, 6 + 1.3 * flip], [6.75, 6 + 1.3 * flip]]);
    return (
      <g>
        <rect className="nr-flag-white" width={18} height={12} />
        <rect className="nr-flag-il" y={1.2} width={18} height={1.8} />
        <rect className="nr-flag-il" y={9} width={18} height={1.8} />
        <polygon className="nr-flag-il-star" points={star(1)} />
        <polygon className="nr-flag-il-star" points={star(-1)} />
        <rect className="nr-flag-frame" width={18} height={12} />
      </g>
    );
  }
  return (
    <g>
      <g clipPath="url(#nr-flag-clip)">
        <rect className="nr-flag-uk" width={18} height={12} />
        <path className="nr-flag-uk-diag" d="M0 0 L18 12 M18 0 L0 12" />
        <path className="nr-flag-uk-diag-red" d="M0 0 L18 12 M18 0 L0 12" />
        <rect className="nr-flag-white" x={7.3} width={3.4} height={12} />
        <rect className="nr-flag-white" y={4.3} width={18} height={3.4} />
        <rect className="nr-flag-uk-red" x={8.1} width={1.8} height={12} />
        <rect className="nr-flag-uk-red" y={5.1} width={18} height={1.8} />
      </g>
      <rect className="nr-flag-frame" width={18} height={12} />
    </g>
  );
}

// ---- Routes and packets ------------------------------------------------

// Routes run along the grid lines, so each is a list of grid corners.
const ROUTES = {
  src1: [[1, 0], [4, 0], [4, 3]],
  src2: [[1, 2], [4, 2], [4, 3]],
  src3: [[1, 4], [4, 4], [4, 3]],
  src4: [[1, 6], [4, 6], [4, 3]],
  candidate: [[1, 10], [3, 10], [3, 9]],
  pool: [[4, 3], [6, 3], [6, 6]],
  resume: [[3, 9], [3, 7], [6, 7], [6, 6]],
  match: [[6, 6], [9, 6]],
  gmail: [[9, 2], [9, 6]],
  interview: [[9, 6], [9, 10]],
} satisfies Record<string, [number, number][]>;
type RouteId = keyof typeof ROUTES;
const ROUTE_IDS = Object.keys(ROUTES) as RouteId[];

const routePath = (via: [number, number][]) =>
  via.map(([gx, gy], i) => `${i ? 'L' : 'M'}${iso(gx, gy).join(' ')}`).join(' ');

const PACKET = pts([[0, -4], [8, 0], [0, 4], [-8, 0]]);

// The story's packet: travels its route once per cycle, between a and b,
// with a fading trail, and lights the route while it's on it.
function StoryPacket({ route, a, b }: { route: RouteId; a: number; b: number }) {
  return (
    <g>
      <path className="nr-route-lit" d={routePath(ROUTES[route])} opacity={0} filter="url(#nr-glow)">
        <Window a={a} b={b + 0.3} fade={0.3} />
      </path>
      <g opacity={0} filter="url(#nr-glow)">
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={`0;${kt(a - 0.02)};${kt(a)};${kt(b + 0.12)};${kt(b + 0.25)};1`} {...loop} />
        {[0, 0.06, 0.12, 0.18].map((lag, i) => (
          <polygon key={i} className="nr-packet" points={PACKET} opacity={1 - i * 0.26}>
            <animateMotion keyPoints="0;0;1;1" keyTimes={`0;${kt(a + lag)};${kt(b + lag)};1`} calcMode="linear" {...loop}>
              <mpath href={`#nr-route-${route}`} />
            </animateMotion>
          </polygon>
        ))}
      </g>
    </g>
  );
}

// The companies whose listings ride each board's route into the pool, two a
// cycle: a brand mark where Simple Icons has one, the company's initial on a
// plain tile where it doesn't. Real companies on that board, never decoration.
type Rider = { logo: keyof typeof SCENE_LOGOS } | { initial: string };
const RIDERS: Record<'src1' | 'src2' | 'src3' | 'src4', [Rider, Rider]> = {
  src1: [{ logo: 'monzo' }, { logo: 'deliveroo' }],    // Greenhouse
  src2: [{ logo: 'nvidia' }, { logo: 'intel' }],       // Workday
  src3: [{ initial: 'C' }, { initial: 'A' }],          // Comeet: Coralogix, Aidoc
  src4: [{ logo: 'cloudinary' }, { initial: 'M' }],    // Lever: Cloudinary, Mobileye
};
const SECOND_RIDER = 5.6; // seconds after the first, so the boards keep flowing

// A small upright tile, centred on its origin: the brand's mark on its colour.
function LogoTile({ rider }: { rider: Rider }) {
  if ('initial' in rider) {
    return (
      <g>
        <rect className="nr-chip" x={-10} y={-10} width={20} height={20} rx={5} />
        <text className="nr-tile-initial" x={0} y={4.6}>{rider.initial}</text>
      </g>
    );
  }
  const mark = SCENE_LOGOS[rider.logo];
  return (
    <g>
      <rect x={-10} y={-10} width={20} height={20} rx={5} fill={mark.color} />
      <rect className="nr-flag-frame" x={-10} y={-10} width={20} height={20} rx={5} />
      <path d={mark.path} fill="#ffffff" transform="translate(-6.5 -6.5) scale(0.5417)" />
    </g>
  );
}

// A source route's story: the route lights, and each of its companies rides
// it into the shared pool, slipping behind the stack as it arrives.
function SourceRiders({ route, a, b }: { route: keyof typeof RIDERS; a: number; b: number }) {
  return (
    <g>
      <path className="nr-route-lit" d={routePath(ROUTES[route])} opacity={0} filter="url(#nr-glow)">
        <Window a={a} b={b + 0.3} fade={0.3} />
      </path>
      {RIDERS[route].map((rider, i) => {
        const s = a + i * SECOND_RIDER;
        const e = b + i * SECOND_RIDER;
        return (
          <g key={i} opacity={0}>
            <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={`0;${kt(s - 0.02)};${kt(s + 0.15)};${kt(e - 0.1)};${kt(e + 0.1)};1`} {...loop} />
            <animateMotion keyPoints="0;0;1;1" keyTimes={`0;${kt(s)};${kt(e)};1`} calcMode="linear" {...loop}>
              <mpath href={`#nr-route-${route}`} />
            </animateMotion>
            <g transform="translate(0 -13)">
              <LogoTile rider={rider} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

// ---- The stages ----------------------------------------------------------

const AI = { gx: 6, gy: 6 } as const;
const MATCHES = { gx: 9, gy: 6 } as const;
const GMAIL = { gx: 9, gy: 2 } as const;
const INTERVIEWS = { gx: 9, gy: 10 } as const;

// An arc through the air from AI matching to a stage it also reads for.
function arcPath(from: Pt, to: Pt, lift: number) {
  const cx = (from[0] + to[0]) / 2;
  const cy = Math.min(from[1], to[1]) - lift;
  return `M${from.join(' ')} Q${cx} ${cy} ${to.join(' ')}`;
}
const ARCS = {
  gmail: { d: arcPath(iso(AI.gx, AI.gy, 56), iso(GMAIL.gx, GMAIL.gy, 22), 40), at: BEAT.gmail },
  interview: { d: arcPath(iso(AI.gx, AI.gy, 56), iso(INTERVIEWS.gx, INTERVIEWS.gy, 12), 30), at: [BEAT.bubble[0] - 0.3, BEAT.bubble[0] + 0.9] },
} as const;

// The job sources: the ATS boards companies post on, each a small stack of
// cards with its name on the floor beside it.
const SOURCES = [
  { gx: 1, gy: 0, name: 'GREENHOUSE' },
  { gx: 1, gy: 2, name: 'WORKDAY' },
  { gx: 1, gy: 4, name: 'COMEET' },
  { gx: 1, gy: 6, name: 'LEVER' },
] as const;

// The candidates, back to front. Two of them own the story's résumés, one
// per slot: they step up in each of their slot's rounds.
const PEOPLE: { gx: number; gy: number; slot?: number }[] = [
  { gx: 0.5, gy: 9.45 },
  { gx: 1.4, gy: 9.35, slot: 0 },
  { gx: 0.75, gy: 10.4, slot: 1 },
  { gx: 1.6, gy: 10.45 },
];

// A blocky person: a body and a head.
function Person({ gx, gy }: { gx: number; gy: number }) {
  return (
    <g>
      <Box gx={gx} gy={gy} w={0.17} d={0.13} h={14} tone="strong" />
      <Box gx={gx} gy={gy} w={0.12} d={0.12} z={16} h={9} top="nr-top-strong" rim />
    </g>
  );
}

// A standing résumé, read by a scan line in each of its rounds. Its flag is
// the current round's country, held until the résumé's next round.
function Resume({ gx, slot, reduced }: { gx: number; slot: number; reduced: boolean }) {
  const gy = 9;
  const [fx, fy] = iso(gx - 0.36, gy + 0.05, 37);
  const rounds = roundsOf(slot);
  const scanKeys = ['0'];
  const scanVals = ['0 0'];
  for (const r of rounds) {
    const o = r * CYCLE;
    scanKeys.push(kt(o + BEAT.scan[0], LONG), kt(o + BEAT.scan[1], LONG), kt(o + BEAT.scan[1] + 0.25, LONG));
    scanVals.push('0 0', '0 36', '0 36');
  }
  scanKeys.push('1');
  scanVals.push('0 0');
  return (
    <g>
      <Box gx={gx} gy={gy} w={0.44} d={0.05} h={42} rim />
      {rounds.map((r) => (
        <g key={r} transform={`matrix(${AXIS.x} ${fx} ${fy}) scale(0.62)`} opacity={reduced ? (r === slot ? 1 : 0) : 0}>
          {!reduced && <Hold round={r} span={SLOTS} />}
          <Flag kind={ROUNDS[r].flag} />
        </g>
      ))}
      {[1, 2, 3, 4].map((i) => {
        const len = i % 2 ? 0.68 : 0.56;
        const [x1, y1] = iso(gx - 0.36, gy + 0.05, 34 - i * 6.5);
        const [x2, y2] = iso(gx - 0.36 + len, gy + 0.05, 34 - i * 6.5);
        return <line key={i} className="nr-ink-line" x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      {!reduced && (
        <line
          className="nr-scan"
          filter="url(#nr-glow)"
          opacity={0}
          x1={iso(gx - 0.44, gy + 0.05, 40)[0]} y1={iso(gx - 0.44, gy + 0.05, 40)[1]}
          x2={iso(gx + 0.44, gy + 0.05, 40)[0]} y2={iso(gx + 0.44, gy + 0.05, 40)[1]}
        >
          <RoundsWindow rounds={rounds} a={BEAT.scan[0]} b={BEAT.scan[1]} />
          <animateTransform
            attributeName="transform"
            type="translate"
            values={scanVals.join(';')}
            keyTimes={scanKeys.join(';')}
            {...loopOf(LONG)}
          />
        </line>
      )}
    </g>
  );
}

// ---- Behaviour ---------------------------------------------------------

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

const RING_R = 10;
const RING_C = 2 * Math.PI * RING_R;
const ORBIT_R = 1.3; // grid units
const ORBIT_RX = ORBIT_R * Math.SQRT2 * TILE_W;
const ORBIT_RY = ORBIT_R * Math.SQRT2 * TILE_H;

export default function PipelineScene({ className = '' }: { className?: string }) {
  // Reduced motion gets the first round's last frame, still: every stage
  // present, the score shown, no packets, no rise, no tilt.
  const reduced = usePrefersReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const numRefs = useRef<(SVGTextElement | null)[]>([]);
  const ringRefs = useRef<(SVGCircleElement | null)[]>([]);

  // The score counts up on the SVG's own clock, so it stays in step with the
  // SMIL story: the current round's chip counts, the other waits at 0.
  // Writes to the nodes directly — no React render per frame. Reads only;
  // nothing is fetched or saved.
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const last = ROUNDS.map(() => -1);
    const tick = () => {
      const t = (svgRef.current?.getCurrentTime?.() ?? 0) % LONG;
      const current = Math.floor(t / CYCLE);
      const p = Math.min(Math.max((t - current * CYCLE - BEAT.score[0]) / (BEAT.score[1] - BEAT.score[0]), 0), 1);
      ROUNDS.forEach((round, i) => {
        const n = i === current ? Math.round(round.score * (1 - (1 - p) ** 3)) : 0;
        const num = numRefs.current[i];
        const ring = ringRefs.current[i];
        if (n === last[i] || !num || !ring) return;
        last[i] = n;
        const color = scoreColor(n);
        num.textContent = String(n);
        num.style.fill = color;
        ring.style.stroke = color;
        ring.style.strokeDashoffset = String(RING_C * (1 - n / 100));
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (reduced || !tiltRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    tiltRef.current.style.transform = `rotateX(${(-py * 7).toFixed(2)}deg) rotateY(${(px * 9).toFixed(2)}deg)`;
  }
  function onPointerLeave() {
    if (tiltRef.current) tiltRef.current.style.transform = '';
  }

  // Story elements start hidden and are revealed by their animations; with
  // reduced motion there are no animations, so they start shown.
  const hidden = reduced ? 1 : 0;
  const [chipX, chipY] = iso(MATCHES.gx + 3.4, MATCHES.gy - 0.4, 20);
  const [bubbleX, bubbleY] = iso(INTERVIEWS.gx + 1.2, INTERVIEWS.gy - 0.6, 30);
  const [aiX, aiY] = iso(AI.gx, AI.gy, 10);

  return (
    <div className="nr-scene-wrap" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <div ref={tiltRef} className="nr-tilt">
        <svg
          ref={svgRef}
          viewBox="0 0 720 400"
          className={`nr-scene ${reduced ? 'nr-still' : ''} ${className}`}
          role="img"
          aria-label="How NextRole works: ATS boards (Greenhouse, Workday, Comeet, Lever) feed a shared pool every day, AI matching scores that pool against each candidate's résumé — résumés from Israel, the UK, Germany and the US each get their own matches — Gmail tracks the replies, and matches go on to interview prep."
          data-testid="pipeline-scene"
          data-cycle={CYCLE}
          data-scores={ROUNDS.map((r) => r.score).join(',')}
        >
          <defs>
            <filter id="nr-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {(['strong', 'soft'] as const).map((tone) => (
              <g key={tone}>
                <linearGradient id={`nr-l-${tone}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" className={`nr-stop-l-${tone}-a`} />
                  <stop offset="100%" className={`nr-stop-l-${tone}-b`} />
                </linearGradient>
                <linearGradient id={`nr-r-${tone}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" className={`nr-stop-r-${tone}-a`} />
                  <stop offset="100%" className={`nr-stop-r-${tone}-b`} />
                </linearGradient>
              </g>
            ))}
            <radialGradient id="nr-floor-glow">
              <stop offset="0%" className="nr-stop-glow-a" />
              <stop offset="100%" className="nr-stop-glow-b" />
            </radialGradient>
            <radialGradient id="nr-floor-fade" cx="50%" cy="50%" r="55%">
              <stop offset="55%" stopColor="white" />
              <stop offset="100%" stopColor="black" />
            </radialGradient>
            <mask id="nr-floor-mask">
              <rect width="720" height="400" fill="url(#nr-floor-fade)" />
            </mask>
            <clipPath id="nr-flag-clip">
              <rect width={18} height={12} />
            </clipPath>
            {ROUTE_IDS.map((id) => (
              <path key={id} id={`nr-route-${id}`} d={routePath(ROUTES[id])} />
            ))}
            <path
              id="nr-orbit"
              d={`M${aiX - ORBIT_RX} ${aiY} a${ORBIT_RX} ${ORBIT_RY} 0 1 0 ${2 * ORBIT_RX} 0 a${ORBIT_RX} ${ORBIT_RY} 0 1 0 ${-2 * ORBIT_RX} 0`}
            />
          </defs>

          {/* Floor: grid, its intersections, and the light under AI matching */}
          <g mask="url(#nr-floor-mask)">
            {Array.from({ length: GRID + 1 }, (_, i) => (
              <g key={i}>
                <line className="nr-grid" x1={iso(i, 0)[0]} y1={iso(i, 0)[1]} x2={iso(i, GRID)[0]} y2={iso(i, GRID)[1]} />
                <line className="nr-grid" x1={iso(0, i)[0]} y1={iso(0, i)[1]} x2={iso(GRID, i)[0]} y2={iso(GRID, i)[1]} />
              </g>
            ))}
            {Array.from({ length: (GRID + 1) ** 2 }, (_, n) => {
              const [x, y] = iso(n % (GRID + 1), Math.floor(n / (GRID + 1)));
              return <circle key={n} className="nr-node" cx={x} cy={y} r={1.2} />;
            })}
          </g>
          <ellipse className="nr-floor-glow" cx={iso(AI.gx, AI.gy)[0]} cy={iso(AI.gx, AI.gy)[1]} rx={230} ry={115} fill="url(#nr-floor-glow)" />

          {SOURCES.map((s) => <Pad key={`${s.gx}-${s.gy}`} gx={s.gx} gy={s.gy} r={0.75} />)}
          <Pad gx={4} gy={3} />
          <Pad gx={1.05} gy={9.9} r={1.05} />
          <Pad gx={3} gy={9} r={1.05} />
          <Pad gx={GMAIL.gx} gy={GMAIL.gy} r={0.9} />
          <Pad gx={INTERVIEWS.gx} gy={INTERVIEWS.gy} r={0.9} />

          {/* Routes: dashes flowing along them, a dim packet always on each,
              and the story's packet lighting its route in turn */}
          {ROUTE_IDS.map((id, n) => (
            <g key={id}>
              <use href={`#nr-route-${id}`} className="nr-route" />
              {ROUTES[id].slice(1, -1).map(([gx, gy]) => {
                const [x, y] = iso(gx, gy);
                return <polygon key={`${gx}-${gy}`} className="nr-joint" points={pts([[x, y - 3.5], [x + 7, y], [x, y + 3.5], [x - 7, y]])} />;
              })}
              {!reduced && (
                <polygon className="nr-packet-dim" points={PACKET}>
                  <animateMotion dur="3.4s" begin={`${(n * 0.45).toFixed(2)}s`} repeatCount="indefinite">
                    <mpath href={`#nr-route-${id}`} />
                  </animateMotion>
                </polygon>
              )}
            </g>
          ))}
          {!reduced && ROUTE_IDS.map((id) => (id in RIDERS
            ? <SourceRiders key={id} route={id as keyof typeof RIDERS} a={BEAT[id][0]} b={BEAT[id][1]} />
            : <StoryPacket key={id} route={id} a={BEAT[id][0]} b={BEAT[id][1]} />))}

          {/* Job sources — the ATS boards, listings stacked like cards */}
          <Rise delay={0.15}>
            {SOURCES.map((s) => (
              <g key={`${s.gx}-${s.gy}`}>
                {[0, 1, 2].map((i) => (
                  <Box key={i} gx={s.gx + i * 0.1} gy={s.gy - i * 0.1} w={0.5} d={0.38} z={i * 7} h={3.5} rim={i === 2} />
                ))}
              </g>
            ))}
          </Rise>

          {/* Shared pool — the listings, stored once for everyone */}
          <Rise delay={0.35}>
            {[0, 1, 2, 3].map((i) => (
              <Box key={i} gx={4} gy={3} w={0.72} d={0.72} z={i * 10} h={7} tone="strong" rim />
            ))}
            {!reduced && (
              <TopFace gx={4} gy={3} w={0.72} d={0.72} z={37} className="nr-flash">
                <Flash at={BEAT.src4[1]} />
              </TopFace>
            )}
          </Rise>

          {/* Gmail — an envelope whose lid lifts when a reply comes in */}
          <Rise delay={0.5}>
            <Box gx={GMAIL.gx} gy={GMAIL.gy} w={0.58} d={0.4} h={13} />
            <g>
              {!reduced && (
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values="0 0;0 0;0 -10;0 -10;0 0;0 0"
                  keyTimes={`0;${kt(BEAT.lid[0])};${kt(BEAT.lid[0] + 0.2)};${kt(BEAT.lid[1])};${kt(BEAT.lid[1] + 0.3)};1`}
                  {...loop}
                />
              )}
              <Box gx={GMAIL.gx} gy={GMAIL.gy} w={0.6} d={0.42} z={13} h={5} tone="strong" rim />
              <polyline
                className="nr-ink-line"
                points={pts([iso(GMAIL.gx - 0.6, GMAIL.gy - 0.4, 18), iso(GMAIL.gx + 0.14, GMAIL.gy, 18), iso(GMAIL.gx - 0.6, GMAIL.gy + 0.4, 18)])}
              />
            </g>
          </Rise>

          {/* AI matching — a core floating over its plinth, sparks on an
              orbit, and a ping when a listing meets a résumé */}
          <Rise delay={0.05}>
            <Box gx={AI.gx} gy={AI.gy} w={0.95} d={0.95} h={10} tone="strong" rim />
            <use href="#nr-orbit" className="nr-orbit" />
            {!reduced && (
              <ellipse className="nr-ping" cx={aiX} cy={aiY} rx={ORBIT_RX * 0.5} ry={ORBIT_RY * 0.5} opacity={0}>
                <animate attributeName="rx" values={`${ORBIT_RX * 0.5};${ORBIT_RX * 0.5};${ORBIT_RX * 2.2};${ORBIT_RX * 2.2}`} keyTimes={`0;${kt(BEAT.think[0])};${kt(BEAT.think[0] + 0.9)};1`} {...loop} />
                <animate attributeName="ry" values={`${ORBIT_RY * 0.5};${ORBIT_RY * 0.5};${ORBIT_RY * 2.2};${ORBIT_RY * 2.2}`} keyTimes={`0;${kt(BEAT.think[0])};${kt(BEAT.think[0] + 0.9)};1`} {...loop} />
                <animate attributeName="opacity" values="0;0;1;0;0" keyTimes={`0;${kt(BEAT.think[0])};${kt(BEAT.think[0] + 0.05)};${kt(BEAT.think[0] + 0.9)};1`} {...loop} />
              </ellipse>
            )}
            <g>
              {!reduced && (
                <animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" />
              )}
              <Box gx={AI.gx} gy={AI.gy} w={0.5} d={0.5} z={20} h={32} tone="strong" top="nr-top-strong" rim />
              <TopFace gx={AI.gx} gy={AI.gy} w={0.5} d={0.5} z={52} className="nr-flash">
                {!reduced && <Flash at={BEAT.think[0]} />}
              </TopFace>
            </g>
            {!reduced && [0, 1.6].map((begin) => (
              <circle key={begin} className="nr-spark" r={2} filter="url(#nr-glow)">
                <animateMotion dur="3.2s" begin={`${begin}s`} repeatCount="indefinite">
                  <mpath href="#nr-orbit" />
                </animateMotion>
              </circle>
            ))}
          </Rise>

          {/* Your matches — where AI matching sends its scores */}
          <Rise delay={0.2}>
            <Box gx={MATCHES.gx} gy={MATCHES.gy} w={1.2} d={1.2} h={15} tone="strong" top="nr-top-strong" rim />
            <polyline
              className="nr-edge-accent"
              filter="url(#nr-glow)"
              points={pts([iso(MATCHES.gx - 1.2, MATCHES.gy + 1.2, 0), iso(MATCHES.gx + 1.2, MATCHES.gy + 1.2, 0), iso(MATCHES.gx + 1.2, MATCHES.gy - 1.2, 0)])}
            />
            {/* the ranked list, best match longest at the back */}
            {[0.92, 0.77, 0.62].map((len, i) => (
              <Box key={i} gx={MATCHES.gx - 1 + len} gy={MATCHES.gy - 0.78 + i * 0.52} w={len} d={0.19} z={15} h={5} />
            ))}
            {!reduced && (
              <TopFace gx={MATCHES.gx} gy={MATCHES.gy} w={1.2} d={1.2} z={15} className="nr-flash">
                <Flash at={BEAT.match[1]} />
              </TopFace>
            )}
            {/* the new match, sliding in at the front; lit once a reply lands */}
            <g opacity={hidden}>
              {!reduced && <Window a={BEAT.row[0]} b={END} />}
              <g>
                {!reduced && (
                  <animateTransform attributeName="transform" type="translate" values="0 -26;0 -26;0 0;0 0" keyTimes={`0;${kt(BEAT.row[0])};${kt(BEAT.row[1])};1`} {...loop} />
                )}
                <Box gx={MATCHES.gx - 0.17} gy={MATCHES.gy + 0.8} w={0.82} d={0.19} z={15} h={5} tone="strong" />
                <TopFace gx={MATCHES.gx - 0.17} gy={MATCHES.gy + 0.8} w={0.82} d={0.19} z={20} className="nr-row-hot">
                  {!reduced && <Window a={BEAT.gmail[1]} b={END} />}
                </TopFace>
              </g>
            </g>
          </Rise>

          {/* Interviews — a desk, and the conversation above it */}
          <Rise delay={0.8}>
            <Box gx={INTERVIEWS.gx} gy={INTERVIEWS.gy} w={0.52} d={0.52} h={10} tone="strong" rim />
            {!reduced && (
              <TopFace gx={INTERVIEWS.gx} gy={INTERVIEWS.gy} w={0.52} d={0.52} z={10} className="nr-flash">
                <Flash at={BEAT.interview[1]} />
              </TopFace>
            )}
          </Rise>

          {/* The résumés — two, taking turns, each wearing its round's flag */}
          <Rise delay={0.65}>
            <Resume gx={2.45} slot={0} reduced={reduced} />
            <Resume gx={3.55} slot={1} reduced={reduced} />
          </Rise>

          {/* The candidates — the round's owner steps up, wearing their flag */}
          <Rise delay={0.9}>
            {PEOPLE.map((p) => {
              if (p.slot === undefined || reduced) return <Person key={`${p.gx}-${p.gy}`} gx={p.gx} gy={p.gy} />;
              const rounds = roundsOf(p.slot);
              const [fx, fy] = iso(p.gx, p.gy, 36);
              const keys = ['0'];
              const vals = ['0 0'];
              for (const r of rounds) {
                const o = r * CYCLE;
                keys.push(kt(o + BEAT.candidate[0] - 0.4, LONG), kt(o + BEAT.candidate[0], LONG), kt(o + BEAT.resume[1], LONG), kt(o + BEAT.resume[1] + 0.4, LONG));
                vals.push('0 0', '0 -6', '0 -6', '0 0');
              }
              keys.push('1');
              vals.push('0 0');
              return (
                <g key={`${p.gx}-${p.gy}`}>
                  <animateTransform attributeName="transform" type="translate" values={vals.join(';')} keyTimes={keys.join(';')} {...loopOf(LONG)} />
                  <Person gx={p.gx} gy={p.gy} />
                  <TopFace gx={p.gx} gy={p.gy} w={0.12} d={0.12} z={25} className="nr-row-hot">
                    <RoundsWindow rounds={rounds} a={BEAT.candidate[0] - 0.4} b={BEAT.resume[1]} />
                  </TopFace>
                  {rounds.map((r) => (
                    <g key={r} transform={`translate(${fx - 7} ${fy - 11}) scale(0.78)`} opacity={0}>
                      <RoundWindow round={r} a={BEAT.candidate[0] - 0.4} b={BEAT.resume[1]} />
                      <Flag kind={ROUNDS[r].flag} />
                    </g>
                  ))}
                </g>
              );
            })}
          </Rise>

          {/* AI matching also reads the replies and preps the interviews */}
          {Object.entries(ARCS).map(([id, arc]) => (
            <g key={id}>
              <path className="nr-arc" d={arc.d} />
              {!reduced && (
                <path className="nr-arc-lit" d={arc.d} filter="url(#nr-glow)" opacity={0}>
                  <Window a={arc.at[0]} b={arc.at[1]} fade={0.3} />
                </path>
              )}
            </g>
          ))}

          <g transform={`translate(${bubbleX} ${bubbleY})`} opacity={hidden}>
            {!reduced && <Window a={BEAT.bubble[0]} b={BEAT.bubble[1]} />}
            <rect className="nr-chip" x={-21} y={-13} width={42} height={24} rx={9} />
            <polygon className="nr-chip" points="-7,10 2,10 -9,18" />
            {[-9, 0, 9].map((x, i) => (
              <circle key={x} className="nr-dot" cx={x} cy={-1} r={2.5}>
                {!reduced && <animate attributeName="opacity" values=".25;1;.25" dur="0.9s" begin={`${i * 0.15}s`} repeatCount="indefinite" />}
              </circle>
            ))}
          </g>

          {/* Labels */}
          <FloorLabel gx={-0.3} gy={7.4} text="ATS BOARDS · DAILY" axis="y" />
          {SOURCES.map((s) => <FloorLabel key={s.name} gx={s.gx - 0.62} gy={s.gy + 0.68} text={s.name} small />)}
          <FloorLabel gx={4.9} gy={3.9} text="SHARED POOL · VECTORS" axis="y" />
          <FloorLabel gx={3.5} gy={7.7} text="AI MATCHING" />
          <FloorLabel gx={0.1} gy={11.55} text="CANDIDATES" />
          <FloorLabel gx={2.2} gy={10.25} text="RÉSUMÉS" />
          <FloorLabel gx={8.4} gy={7.85} text="MATCHES" />
          <FloorLabel gx={8.1} gy={3.1} text="GMAIL" />
          <FloorLabel gx={8.2} gy={11.1} text="INTERVIEWS" />
          {/* The score, one chip per round: where the listing is, and how well
              it fits that round's résumé */}
          {ROUNDS.map((round, i) => {
            const shown = reduced ? (i === 0 ? 1 : 0) : 0;
            return (
              <g key={round.flag} transform={`translate(${chipX} ${chipY})`} opacity={shown}>
                {!reduced && <RoundWindow round={i} a={BEAT.score[0] - 0.1} b={END} />}
                <rect className="nr-chip" x={-52} y={-19} width={122} height={52} rx={7} />
                <circle className="nr-ring-track" cx={-34} cy={-1} r={RING_R} />
                <circle
                  ref={(el) => { ringRefs.current[i] = el; }}
                  className="nr-ring"
                  cx={-34} cy={-1} r={RING_R}
                  transform="rotate(-90 -34 -1)"
                  style={{ stroke: scoreColor(round.score), strokeDasharray: RING_C, strokeDashoffset: reduced ? RING_C * (1 - round.score / 100) : RING_C }}
                />
                <text ref={(el) => { numRefs.current[i] = el; }} className="nr-score" x={-19} y={5} style={{ fill: scoreColor(round.score) }}>
                  {reduced ? round.score : 0}
                </text>
                <text className="nr-chip-caption" x={9} y={4}>MATCH</text>
                <g transform="translate(-43 17) scale(0.72)">
                  <Flag kind={round.flag} />
                </g>
                <text className="nr-city" x={-25} y={25}>{round.city}</text>
              </g>
            );
          })}

        </svg>
      </div>
    </div>
  );
}
