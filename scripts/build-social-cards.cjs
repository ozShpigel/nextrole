// Renders the social cards from the README diagrams: client/public/og.png
// (1200x630, the link preview for nextrole.cloud) and docs/repo-card.png
// (1280x640, upload as the GitHub repo social preview). Rerun after
// node scripts/build-readme-diagrams.cjs:  node scripts/build-social-cards.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../e2e/node_modules/playwright'));
const R = path.resolve(__dirname, '..').split(path.sep).join('/') + '/';
const scene = fs.readFileSync(R + 'docs/images/pipeline-scene-dark.svg', 'utf8');
const pipe = fs.readFileSync(R + 'docs/images/pipeline-dark.svg', 'utf8');
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:ital,wght@0,400..900;1,400..900&family=Instrument+Sans:wght@400..700&display=swap" rel="stylesheet">`;
const base = `*{margin:0;box-sizing:border-box} body{background:#000;color:#fff;font-family:'Instrument Sans',sans-serif;overflow:hidden}
.mark{font-family:'Schibsted Grotesk';font-weight:800;letter-spacing:-.03em;line-height:1}
.mark i{font-weight:500;color:#9DB8F5}
.glow{position:absolute;inset:0;background:radial-gradient(60% 70% at 72% 55%,rgba(157,184,245,.14),transparent 70%)}`;

const og = `<!doctype html><html><head>${FONTS}<style>${base}
body{width:1200px;height:630px;position:relative}
.l{position:absolute;left:72px;top:0;bottom:0;width:540px;display:flex;flex-direction:column;justify-content:center;gap:22px}
.mark{font-size:86px}
.c-t{font-size:30px;font-weight:600;line-height:1.2}
.c-s{font-size:19px;color:#a7adba;line-height:1.45}
.u{font-size:17px;color:#9DB8F5;font-weight:600;letter-spacing:.02em;margin-top:6px}
.r{position:absolute;right:-6px;top:50%;transform:translateY(-50%);width:760px}
.r svg{width:760px;height:auto;display:block}
</style></head><body>
<div class="l"><div class="mark">Next <i>Role</i></div>
<div class="c-t">An AI job search,<br>from CV to offer.</div>
<div class="c-s">Claude judges each match.<br>Code checks every judgement.</div>
<div class="u">nextrole.cloud</div></div>
<div class="r">${scene}</div></body></html>`;

const repo = `<!doctype html><html><head>${FONTS}<style>${base}
body{width:1280px;height:640px;position:relative}
.top{position:absolute;left:64px;right:64px;top:52px;display:flex;align-items:flex-end;justify-content:space-between}
.mark{font-size:54px}
.c-h{font-size:40px;font-weight:600;letter-spacing:-.01em}
.c-h b{color:#9DB8F5;font-weight:600}
.c-sub{position:absolute;left:64px;top:128px;font-size:19px;color:#a7adba}
.p{position:absolute;left:40px;right:40px;bottom:28px}
.p svg{width:1200px;height:auto;display:block}
</style></head><body>
<div class="top"><div class="c-h">The model judges, <b>code verifies.</b></div><div class="mark">Next <i>Role</i></div></div>
<div class="c-sub">AI job search, from CV to offer · .NET 10 · React · MongoDB Atlas · RabbitMQ · Claude</div>
<div class="p">${pipe}</div></body></html>`;

(async () => {
  const b = await chromium.launch();
  for (const [html, w, h, out, t] of [[og, 1200, 630, R + 'client/public/og.png', 6.4], [repo, 1280, 640, R + 'docs/repo-card.png', 0.6]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(html, { waitUntil: 'networkidle' });
    await p.evaluate(async (t) => {
      await document.fonts.ready;
      document.querySelectorAll('rect[fill="url(#floor)"], rect[x="-40"]').forEach((r) => r.remove());
      document.querySelectorAll('svg').forEach((s) => { if (s.pauseAnimations) { s.pauseAnimations(); s.setCurrentTime(t); } });
    }, t);
    await p.waitForTimeout(3500);
    await p.screenshot({ path: out, timeout: 15000, animations: 'allow' });
    console.log('wrote', out);
    await p.close();
  }
  await b.close();
})();
