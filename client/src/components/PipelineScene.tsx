import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { scoreColor } from '../lib/format';

// The Landing page's picture of the pipeline — an isometric floor with each
// stage standing on it and a story playing across it on a loop: a listing
// comes in from the job boards and lands in the shared pool, the pool and
// your résumé meet in your matches and a score counts up, a new match slides
// into your ranked list, Gmail sends a reply in, and the match goes on to
// an interview. Change the pipeline and this should change with it.
//
// Accent-lit faces and glowing edges by design (docs/design-system.md →
// Landing pipeline scene); the AGENTS.md guardrails still hold here: tokens
// only, the score on the score ramp, a still frame under reduced motion.
//
// Pure SVG, laid out on a grid and projected here, so every object sits on
// the same floor and the routes stay on the grid lines. Colors come from
// classes in index.css (.nr-scene…) — SVG presentation attributes cannot
// read CSS variables, but CSS properties set by a class (fill, stop-color)
// can.

const TILE_W = 32; // half a tile's width, in viewBox units
const TILE_H = 16; // half a tile's height
const ORIGIN_X = 360;
const ORIGIN_Y = 40;
const GRID = 10;

type Pt = [number, number];

// Grid (gx, gy) and height z → viewBox point.
function iso(gx: number, gy: number, z = 0): Pt {
  return [ORIGIN_X + (gx - gy) * TILE_W, ORIGIN_Y + (gx + gy) * TILE_H - z];
}

const pts = (ps: Pt[]) => ps.map(([x, y]) => `${x},${y}`).join(' ');

// ---- The story's clock -------------------------------------------------
// Every story animation runs on one CYCLE-second loop and places its moment
// inside it with keyTimes, so the beats stay in order without chaining.
const CYCLE = 12;
const BEAT = {
  ingest: [0.2, 1.8],    // job boards → shared pool
  pool: [1.9, 3.4],      // shared pool → your matches
  resume: [1.9, 3.4],    // your résumé → your matches (read on the way)
  score: [3.5, 4.7],     // the score counts up
  row: [4.9, 5.5],       // the new match slides into the list
  lid: [5.8, 6.6],       // the envelope opens
  gmail: [6.1, 7.5],     // a reply comes in
  interview: [7.9, 9.3], // your matches → interviews
  bubble: [9.3, 11.3],   // the interview is under way
} as const;
const END = 11.35;

const kt = (s: number) => (Math.min(Math.max(s, 0), CYCLE) / CYCLE).toFixed(4);
const loop = { dur: `${CYCLE}s`, repeatCount: 'indefinite' } as const;

// Visible from a to b, with short fades either side.
function Window({ a, b, fade = 0.2 }: { a: number; b: number; fade?: number }) {
  return (
    <animate
      attributeName="opacity"
      values="0;0;1;1;0;0"
      keyTimes={`0;${kt(a)};${kt(a + fade)};${kt(b)};${kt(b + fade)};1`}
      {...loop}
    />
  );
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

// A label lying on the floor, running along the gx axis (down-right) or the
// gy axis (up-right), the way the grid lines run.
function FloorLabel({ gx, gy, text, axis = 'x' }: { gx: number; gy: number; text: string; axis?: 'x' | 'y' }) {
  const [x, y] = iso(gx, gy);
  const m = axis === 'x' ? `matrix(0.894 0.447 0 1 ${x} ${y})` : `matrix(0.894 -0.447 0 1 ${x} ${y})`;
  const width = text.length * 9.4 + 16;
  return (
    <g transform={m}>
      <rect className="nr-label-bg" x={0} y={-14} width={width} height={20} rx={3} />
      <text className="nr-label" x={8} y={1}>{text}</text>
    </g>
  );
}

// Staggers each object's rise onto the floor when the scene first shows.
function Rise({ delay, children }: { delay: number; children: ReactNode }) {
  return <g className="nr-rise" style={{ '--d': `${delay}s` } as CSSProperties}>{children}</g>;
}

// ---- Routes and packets ------------------------------------------------

// Routes run along the grid lines, so each is a list of grid corners.
const ROUTES = {
  ingest: [[1, 6], [1, 2], [2, 2]],
  pool: [[2, 2], [5, 2], [5, 5]],
  resume: [[4, 9], [4, 5], [5, 5]],
  gmail: [[8, 2], [8, 5], [5, 5]],
  interview: [[5, 5], [5, 8], [8, 8]],
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

const SCORE = 92;
const RING_R = 10;
const RING_C = 2 * Math.PI * RING_R;

export default function PipelineScene({ className = '' }: { className?: string }) {
  // Reduced motion gets the story's last frame, still: every stage present,
  // the score shown, no packets, no rise, no tilt.
  const reduced = usePrefersReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<SVGTextElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);

  // The score counts up on the SVG's own clock, so it stays in step with the
  // SMIL story. Writes to the two nodes directly — no React render per frame.
  // Reads only; nothing is fetched or saved.
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    let last = -1;
    const tick = () => {
      const t = (svgRef.current?.getCurrentTime?.() ?? 0) % CYCLE;
      const p = Math.min(Math.max((t - BEAT.score[0]) / (BEAT.score[1] - BEAT.score[0]), 0), 1);
      const n = Math.round(SCORE * (1 - (1 - p) ** 3));
      if (n !== last && numRef.current && ringRef.current) {
        last = n;
        const color = scoreColor(n);
        numRef.current.textContent = String(n);
        numRef.current.style.fill = color;
        ringRef.current.style.stroke = color;
        ringRef.current.style.strokeDashoffset = String(RING_C * (1 - n / 100));
      }
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
  const [chipX, chipY] = iso(6.4, 4.6, 56);
  const [bubbleX, bubbleY] = iso(9.2, 7.4, 30);

  return (
    <div className="nr-scene-wrap" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <div ref={tiltRef} className="nr-tilt">
        <svg
          ref={svgRef}
          viewBox="0 0 720 400"
          className={`nr-scene ${reduced ? 'nr-still' : ''} ${className}`}
          role="img"
          aria-label="How NextRole works: job boards feed a shared pool every day, your résumé scores that pool into your matches, Gmail tracks the replies, and matches go on to interview prep."
          data-testid="pipeline-scene"
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
            {ROUTE_IDS.map((id) => (
              <path key={id} id={`nr-route-${id}`} d={routePath(ROUTES[id])} />
            ))}
          </defs>

          {/* Floor: grid, its intersections, and the light under your matches */}
          <g mask="url(#nr-floor-mask)">
            {Array.from({ length: GRID + 1 }, (_, i) => (
              <g key={i}>
                <line className="nr-grid" x1={iso(i, 0)[0]} y1={iso(i, 0)[1]} x2={iso(i, GRID)[0]} y2={iso(i, GRID)[1]} />
                <line className="nr-grid" x1={iso(0, i)[0]} y1={iso(0, i)[1]} x2={iso(GRID, i)[0]} y2={iso(GRID, i)[1]} />
              </g>
            ))}
            {Array.from({ length: (GRID + 1) ** 2 }, (_, n) => {
              const [x, y] = iso(n % (GRID + 1), Math.floor(n / (GRID + 1)));
              return <circle key={n} className="nr-node" cx={x} cy={y} r={1.3} />;
            })}
          </g>
          <ellipse className="nr-floor-glow" cx={iso(5, 5)[0]} cy={iso(5, 5)[1]} rx={210} ry={105} fill="url(#nr-floor-glow)" />

          <Pad gx={2} gy={2} />
          <Pad gx={1} gy={6} r={0.9} />
          <Pad gx={4} gy={9} r={0.8} />
          <Pad gx={8} gy={2} r={0.9} />
          <Pad gx={8} gy={8} r={0.9} />

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
                  <animateMotion dur="3.4s" begin={`${n * 0.7}s`} repeatCount="indefinite">
                    <mpath href={`#nr-route-${id}`} />
                  </animateMotion>
                </polygon>
              )}
            </g>
          ))}
          {!reduced && ROUTE_IDS.map((id) => <StoryPacket key={id} route={id} a={BEAT[id][0]} b={BEAT[id][1]} />)}

          {/* Shared pool — the listings, stored once for everyone */}
          <Rise delay={0.35}>
            {[0, 1, 2, 3].map((i) => (
              <Box key={i} gx={2} gy={2} w={0.75} d={0.75} z={i * 11} h={8} tone="strong" rim />
            ))}
            {!reduced && (
              <TopFace gx={2} gy={2} w={0.75} d={0.75} z={41} className="nr-flash">
                <Flash at={BEAT.ingest[1]} />
              </TopFace>
            )}
          </Rise>

          {/* Job boards — listings stacked like cards */}
          <Rise delay={0.2}>
            {[0, 1, 2].map((i) => (
              <Box key={i} gx={1 + i * 0.12} gy={6 - i * 0.12} w={0.62} d={0.45} z={i * 8} h={4} rim={i === 2} />
            ))}
          </Rise>

          {/* Gmail — an envelope whose lid lifts when a reply comes in */}
          <Rise delay={0.5}>
            <Box gx={8} gy={2} w={0.62} d={0.42} h={14} />
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
              <Box gx={8} gy={2} w={0.64} d={0.44} z={14} h={5} tone="strong" rim />
              <polyline className="nr-ink-line" points={pts([iso(7.36, 1.56, 19), iso(8.15, 2, 19), iso(7.36, 2.44, 19)])} />
            </g>
          </Rise>

          {/* Your matches — where the pool and your résumé meet */}
          <Rise delay={0.05}>
            <Box gx={5} gy={5} w={1.25} d={1.25} h={16} tone="strong" top="nr-top-strong" rim />
            <polyline className="nr-edge-accent" filter="url(#nr-glow)" points={pts([iso(3.75, 6.25, 0), iso(6.25, 6.25, 0), iso(6.25, 3.75, 0)])} />
            {/* the ranked list, best match longest at the back */}
            {[0.95, 0.8, 0.65].map((len, i) => (
              <Box key={i} gx={4.0 + len} gy={4.2 + i * 0.55} w={len} d={0.2} z={16} h={5} />
            ))}
            {!reduced && (
              <TopFace gx={5} gy={5} w={1.25} d={1.25} z={16} className="nr-flash">
                <Flash at={BEAT.pool[1]} />
              </TopFace>
            )}
            {/* the new match, sliding in at the front; lit once a reply lands */}
            <g opacity={hidden}>
              {!reduced && <Window a={BEAT.row[0]} b={END} />}
              <g>
                {!reduced && (
                  <animateTransform attributeName="transform" type="translate" values="0 -26;0 -26;0 0;0 0" keyTimes={`0;${kt(BEAT.row[0])};${kt(BEAT.row[1])};1`} {...loop} />
                )}
                <Box gx={4.85} gy={5.85} w={0.85} d={0.2} z={16} h={5} tone="strong" />
                <TopFace gx={4.85} gy={5.85} w={0.85} d={0.2} z={21} className="nr-row-hot">
                  {!reduced && <Window a={BEAT.gmail[1]} b={END} />}
                </TopFace>
              </g>
            </g>
          </Rise>

          {/* Your résumé — a standing sheet, read by a scan line on its way in */}
          <Rise delay={0.65}>
            <Box gx={4} gy={9} w={0.5} d={0.05} h={46} rim />
            {[0, 1, 2, 3, 4].map((i) => {
              const len = i === 0 ? 0.5 : i % 2 ? 0.75 : 0.62;
              return (
                <line
                  key={i}
                  className="nr-ink-line"
                  x1={iso(3.62, 9.05, 38 - i * 7)[0]} y1={iso(3.62, 9.05, 38 - i * 7)[1]}
                  x2={iso(3.62 + len, 9.05, 38 - i * 7)[0]} y2={iso(3.62 + len, 9.05, 38 - i * 7)[1]}
                />
              );
            })}
            {!reduced && (
              <line
                className="nr-scan"
                filter="url(#nr-glow)"
                opacity={0}
                x1={iso(3.5, 9.05, 43)[0]} y1={iso(3.5, 9.05, 43)[1]}
                x2={iso(4.5, 9.05, 43)[0]} y2={iso(4.5, 9.05, 43)[1]}
              >
                <Window a={BEAT.resume[0] - 0.4} b={BEAT.resume[1] - 0.2} />
                <animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 38;0 38" keyTimes={`0;${kt(BEAT.resume[0] - 0.4)};${kt(BEAT.resume[1] - 0.2)};1`} {...loop} />
              </line>
            )}
          </Rise>

          {/* Interviews — a desk, and the conversation above it */}
          <Rise delay={0.8}>
            <Box gx={8} gy={8} w={0.55} d={0.55} h={10} tone="strong" rim />
            {!reduced && (
              <TopFace gx={8} gy={8} w={0.55} d={0.55} z={10} className="nr-flash">
                <Flash at={BEAT.interview[1]} />
              </TopFace>
            )}
          </Rise>
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

          {/* The score, counting up as the listing meets your résumé */}
          <g transform={`translate(${chipX} ${chipY})`} opacity={hidden}>
            {!reduced && <Window a={BEAT.score[0] - 0.1} b={END} />}
            <rect className="nr-chip" x={-52} y={-17} width={116} height={34} rx={7} />
            <circle className="nr-ring-track" cx={-34} cy={0} r={RING_R} />
            <circle
              ref={ringRef}
              className="nr-ring"
              cx={-34} cy={0} r={RING_R}
              transform="rotate(-90 -34 0)"
              style={{ stroke: scoreColor(SCORE), strokeDasharray: RING_C, strokeDashoffset: reduced ? RING_C * (1 - SCORE / 100) : RING_C }}
            />
            <text ref={numRef} className="nr-score" x={-19} y={6} style={{ fill: scoreColor(SCORE) }}>{reduced ? SCORE : 0}</text>
            <text className="nr-chip-caption" x={7} y={5}>MATCH</text>
          </g>

          {/* Labels */}
          <FloorLabel gx={3.05} gy={2.75} text="SHARED POOL" axis="y" />
          <FloorLabel gx={0.2} gy={4.3} text="EVERY DAY" axis="y" />
          <FloorLabel gx={-0.15} gy={7.05} text="JOB BOARDS" />
          <FloorLabel gx={3.25} gy={10.05} text="YOUR RÉSUMÉ" />
          <FloorLabel gx={3.35} gy={7.45} text="YOUR MATCHES" />
          <FloorLabel gx={7} gy={3.1} text="GMAIL" />
          <FloorLabel gx={7.1} gy={9.1} text="INTERVIEWS" />
        </svg>
      </div>
    </div>
  );
}
