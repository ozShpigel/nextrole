import { useEffect, useRef } from 'react';
import { FRAG, VERT } from './metaball-shader';

// The three hues the flat version used, kept deliberately: this page is the
// app's one sanctioned multi-hue moment (AGENTS.md), and carrying the same
// palette across the change means the app gained depth rather than a new look.
const COLORS: [number, number, number][] = [
  [0.88, 0.64, 0.23], // amber
  [0.91, 0.33, 0.50], // raspberry
  [0.18, 0.71, 0.79], // teal
];
// Where a sphere waits before its milestone lands, and where it ends up.
const HOME: [number, number, number][] = [
  [-0.66, -0.38, 0.08],
  [0.00, 0.74, -0.10],
  [0.66, -0.38, 0.08],
];
// Fixed points the three hues are anchored to, pushed out past the geometry so
// the gradient runs across a merged sphere instead of collapsing to its
// average. These never move: the palette must not change as the work
// progresses, only the shape.
const ANCHORS: [number, number, number][] = [
  [-1.05, -0.62, 0.35],
  [0.00, 1.15, -0.25],
  [1.05, -0.62, 0.35],
];

type Props = { settled: boolean[]; finished: boolean };

/**
 * Returns false when WebGL2 is unavailable, so the caller can fall back.
 * Everything below runs off a ref rather than props, because the render loop
 * must not be torn down and rebuilt every time a milestone lands.
 */
export function MetaballVisual({ settled, finished, onUnsupported }: Props & { onUnsupported: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ settled, finished });
  stateRef.current = { settled, finished };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) { onUnsupported(); return; }

    function compile(type: number, src: string): WebGLShader | null {
      const sh = gl!.createShader(type);
      if (!sh) return null;
      gl!.shaderSource(sh, src);
      gl!.compileShader(sh);
      if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) {
        // A shader that will not compile is a bug in this file, not a device
        // limitation — say so loudly, then fall back so the page still works.
        // An empty info log here means the CONTEXT is gone rather than the
        // source being wrong, which is worth distinguishing: they look
        // identical from the outside and have opposite fixes.
        const log = gl!.getShaderInfoLog(sh);
        console.error(
          log
            ? `Metaball shader failed to compile: ${log}`
            : `Metaball shader could not compile and reported nothing — context lost? (isContextLost=${gl!.isContextLost()})`,
        );
        return null;
      }
      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = vs && fs ? gl.createProgram() : null;
    if (!vs || !fs || !prog) { onUnsupported(); return; }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Metaball program failed to link:', gl.getProgramInfoLog(prog));
      onUnsupported();
      return;
    }
    gl.useProgram(prog);

    // One full-screen triangle pair. The only geometry in the scene.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uPos = gl.getUniformLocation(prog, 'uPos');
    const uCol = gl.getUniformLocation(prog, 'uCol');
    const uFinish = gl.getUniformLocation(prog, 'uFinish');

    gl.uniform3fv(uCol, new Float32Array(COLORS.flat()));
    gl.uniform3fv(gl.getUniformLocation(prog, 'uAnchor'), new Float32Array(ANCHORS.flat()));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // How far each sphere has travelled from its waiting position toward the
    // centre. Eased on the GPU's clock rather than snapped, so a milestone
    // reads as one deliberate move — but the TARGET is the milestone, and
    // nothing here advances on its own.
    const travel = [0, 0, 0];
    let raf = 0;
    const t0 = performance.now();

    function frame(now: number) {
      const { settled: s, finished: done } = stateRef.current;
      const time = (now - t0) / 1000;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = canvas!.clientWidth;
      const px = Math.round(size * dpr);
      if (canvas!.width !== px) {
        canvas!.width = px;
        canvas!.height = px;
        gl!.viewport(0, 0, px, px);
      }

      const positions: number[] = [];
      for (let i = 0; i < 3; i++) {
        // Approach the target by a fixed fraction per frame: a spring without
        // the bookkeeping, and it cannot overshoot.
        travel[i] += ((s[i] ? 1 : 0) - travel[i]) * 0.045;
        const [hx, hy, hz] = HOME[i];
        // Waiting spheres drift. This is liveness, NOT progress — it never
        // moves a sphere closer to the centre, only around where it already is.
        const idle = 1 - travel[i];
        const wob = 0.055 * idle;
        positions.push(
          hx * (1 - travel[i]) + Math.sin(time * 0.62 + i * 2.1) * wob,
          hy * (1 - travel[i]) + Math.cos(time * 0.48 + i * 1.7) * wob,
          hz * (1 - travel[i]) + Math.sin(time * 0.55 + i * 3.3) * wob * 0.6,
        );
      }

      gl!.uniform2f(uRes, px, px);
      gl!.uniform1f(uTime, time);
      gl!.uniform3fv(uPos, new Float32Array(positions));
      gl!.uniform1f(uFinish, done ? 1 : 0);

      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      // Deliberately NOT WEBGL_lose_context here. A canvas has exactly one
      // context for its lifetime — getContext hands back the same object every
      // time — and StrictMode tears this effect down and sets it up again on
      // the SAME canvas element. Losing the context in cleanup therefore kills
      // the context the remount is about to use: every shader then fails to
      // compile with an empty info log, and the page silently falls back to
      // flat circles on hardware that could render this perfectly well.
      // Dropping the canvas is what frees the drawing buffer, and React does
      // that on a real unmount.
    };
    // Mount-only: the loop reads live values through stateRef, so re-running
    // this on a milestone would rebuild the GL context mid-animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />;
}
