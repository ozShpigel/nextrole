// Exports the Landing pipeline scene (client/src/components/PipelineScene.tsx)
// as a standalone animated SVG for the README: the rendered markup, the
// .nr-scene CSS with every var() resolved, and the JS-driven score count-up
// replaced by a SMIL ring fill. A README image runs no script, but SMIL and
// CSS animations inside an SVG do play.
//
// Rerun after changing the scene, with the client dev server up:
//   cd client && bun run dev
//   node scripts/export-pipeline-scene.cjs [http://localhost:5173/]
// Every /api request is stubbed, so no API is needed and nothing is written.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const { chromium } = require(path.join(root, 'e2e/node_modules/playwright'));
const CSS = fs.readFileSync(path.join(root, 'client/src/index.css'), 'utf8');
const OUT = path.join(root, 'docs/images/pipeline-scene.svg');
const URL = process.argv[2] ?? 'http://localhost:5173/';

// Pull the scene's rules: from the section header to the brand-flicker block.
const start = CSS.indexOf('.nr-scene-wrap');
const end = CSS.indexOf('/* Nav brand mark');
let css = CSS.slice(start, end)
  .split('\n')
  .filter((l) => !/^\.nr-(scene-wrap|tilt)|\.nr-tilt/.test(l.trim()))
  .join('\n');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.route('**/api/**', (r) => {
    const u = r.request().url();
    if (u.includes('/auth/me')) return r.fulfill({ json: { signedIn: false, email: null, available: true } });
    if (u.includes('/match/profile')) return r.fulfill({ status: 404, json: {} });
    return r.fulfill({ json: {} });
  });
  await p.goto(URL);
  const scene = p.getByTestId('pipeline-scene');
  await scene.waitFor();
  await p.waitForTimeout(1500);

  const { markup, vars } = await scene.evaluate((svg) => {
    const cs = getComputedStyle(svg);
    const names = ['--ed-accent', '--ed-paper', '--ed-panel', '--ed-ink', '--ed-ink-soft', '--ed-ink-faint', '--ed-rule-strong',
      '--nr-flag-white', '--nr-flag-il-blue', '--nr-flag-uk-blue', '--nr-flag-uk-red'];
    const vars = Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
    const clone = svg.cloneNode(true);
    // The score: final number, ring filled by SMIL in its round's window.
    const C = 2 * Math.PI * 10, CYCLE = 12, LONG = 24, SCORES = [92, 88];
    clone.querySelectorAll('.nr-score').forEach((t, i) => { t.textContent = String(SCORES[i]); });
    clone.querySelectorAll('.nr-ring').forEach((ring, i) => {
      ring.style.removeProperty('stroke-dashoffset');
      ring.setAttribute('stroke-dashoffset', String(C));
      const a = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
      const k = (s) => (s / LONG).toFixed(4);
      a.setAttribute('attributeName', 'stroke-dashoffset');
      a.setAttribute('values', `${C};${C};${C * (1 - SCORES[i] / 100)};${C * (1 - SCORES[i] / 100)}`);
      a.setAttribute('keyTimes', `0;${k(i * CYCLE + 4.7)};${k(i * CYCLE + 5.9)};1`);
      a.setAttribute('dur', `${LONG}s`);
      a.setAttribute('repeatCount', 'indefinite');
      ring.appendChild(a);
    });
    // Both scores are >= 60, the ramp's top stop (lib/format.ts scoreColor).
    clone.querySelectorAll('.nr-score').forEach((t) => { t.style.fill = '#059669'; });
    clone.querySelectorAll('.nr-ring').forEach((r) => { r.style.stroke = '#059669'; });
    clone.removeAttribute('data-testid');
    clone.removeAttribute('style');
    clone.setAttribute('class', 'nr-scene');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', '720');
    clone.setAttribute('height', '400');
    return { markup: new XMLSerializer().serializeToString(clone), vars };
  });
  await b.close();

  vars['--font-sans'] = "'Instrument Sans', 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif";
  for (const [k, v] of Object.entries(vars)) css = css.split(`var(${k})`).join(v);
  if (/var\(--(?!d,)/.test(css)) throw new Error('unresolved var: ' + css.match(/var\(--[^)]+\)/)[0]);
  // The score's final color, from the ramp (the React code sets it per frame).

  const style = `<style>${css.replace(/\s+/g, ' ')}</style>`;
  const bg = `<rect x="-40" y="-40" width="800" height="480" fill="${vars['--ed-paper'] || '#000'}"/>`;
  let out = markup.replace(/<defs>/, `${style}<defs>`).replace(/<\/defs>/, `</defs>${bg}`);
  out = out.replace('viewBox="0 0 720 400"', 'viewBox="-10 -10 740 420"');
  fs.writeFileSync(OUT, out);
  console.log('wrote', path.relative(root, OUT), (out.length / 1024).toFixed(1) + ' KB');
})();
