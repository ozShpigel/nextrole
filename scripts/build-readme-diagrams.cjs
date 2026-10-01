// Builds the README diagrams as standalone SVGs, dark and light:
// docs/images/{architecture,pipeline,journey}-{dark,light}.svg, for the README <picture>s.
// Same palette as the Landing pipeline scene's exported copy
// (scripts/export-pipeline-scene.cjs): accent, ink and panel from the site's
// tokens, green only on the score packet. Packets move with SMIL, which plays
// inside an <img>; reduced motion hides them.
//
//   node scripts/build-readme-diagrams.cjs
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const THEMES = {
  dark: {
    bg: '#000000', panel: '#0b0d12', panelHi: '#10141d', ink: '#ffffff', soft: '#a7adba',
    faint: 'rgba(255,255,255,0.42)', rule: 'rgba(255,255,255,0.14)', accent: '#9DB8F5', score: '#059669',
  },
  light: {
    bg: '#ffffff', panel: '#f5f7fc', panelHi: '#eef2fb', ink: '#1d2b25', soft: '#59645f',
    faint: 'rgba(29,43,37,0.45)', rule: 'rgba(29,43,37,0.14)', accent: '#7B93D4', score: '#059669',
  },
};

const W = 1000, H = 540;
const FONT = "'Instrument Sans','Segoe UI',system-ui,-apple-system,Helvetica,Arial,sans-serif";
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildArchitecture(c) {
  const out = [];
  const add = (s) => out.push(s);

  // A box with a title and up to two sub lines. kind: svc | ext | hub
  function node(x, y, w, h, title, subs = [], kind = 'svc') {
    const stroke = kind === 'ext' ? c.faint : kind === 'hub' ? c.accent : `color-mix(in oklab, ${c.accent} 45%, transparent)`;
    const dash = kind === 'ext' ? ' stroke-dasharray="4 4"' : '';
    const fill = kind === 'hub' ? c.panelHi : c.panel;
    add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="${kind === 'hub' ? 1.6 : 1.1}"${dash}${kind === 'hub' ? ' filter="url(#glow)"' : ''}/>`);
    const cx = x + w / 2;
    const top = y + h / 2 - (subs.length * 15) / 2 + 4;
    add(`<text x="${cx}" y="${top}" class="t">${esc(title)}</text>`);
    subs.forEach((s, i) => add(`<text x="${cx}" y="${top + 16 + i * 15}" class="s">${esc(s)}</text>`));
  }
  const caption = (x, y, s, anchor = 'start') => add(`<text x="${x}" y="${y}" class="cap" text-anchor="${anchor}">${esc(s)}</text>`);
  const edge = (id, d, label, lx, ly) => {
    add(`<path id="${id}" d="${d}" class="e" marker-end="url(#arrow)"/>`);
    if (label) add(`<text x="${lx}" y="${ly}" class="el">${esc(label)}</text>`);
  };
  // A packet riding a path: begin offset, travel seconds, loop length.
  const packet = (pathId, begin, dur, loop, color = c.accent) => {
    const a = begin / loop, b = Math.min((begin + dur) / loop, 1);
    add(`<circle r="3.6" class="pkt" fill="${color}" opacity="0"><animateMotion dur="${loop}s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;${a.toFixed(3)};${b.toFixed(3)};1" calcMode="linear"><mpath href="#${pathId}"/></animateMotion><animate attributeName="opacity" dur="${loop}s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;${a.toFixed(3)};${(a + 0.005).toFixed(3)};${(b - 0.005).toFixed(3)};${b.toFixed(3)};1"/></circle>`);
  };

  add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`);
  add(`<title id="t">NextRole architecture</title>`);
  add(`<desc id="d">Users, company job boards and Gmail on the left feed services on one VPS: Caddy and the React app, a RabbitMQ ingest (publisher, queue, consumer) and the mail sync. All of them go through the API, the only service that calls Claude. The API scores with Claude, corrects every score with seven server-side checks, and stores it in MongoDB Atlas next to the shared pool and its vector index; Voyage embeds postings and profiles.</desc>`);
  add(`<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9" fill="none" stroke="${c.faint}" stroke-width="1.4"/></marker>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="9"/><feFlood flood-color="${c.accent}" flood-opacity="0.35"/><feComposite operator="in" in2="SourceAlpha"/><feComposite operator="over" in="SourceGraphic"/></filter>
  <radialGradient id="floor" cx="68%" cy="50%" r="55%"><stop offset="0" stop-color="${c.accent}" stop-opacity="0.10"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></radialGradient>
</defs>`);
  add(`<style>
  text{font-family:${FONT}}
  .t{font-size:13.5px;font-weight:600;fill:${c.ink};text-anchor:middle}
  .s{font-size:11px;fill:${c.soft};text-anchor:middle}
  .cap{font-size:10px;font-weight:600;letter-spacing:.14em;fill:${c.faint}}
  .el{font-size:10.5px;fill:${c.soft};text-anchor:middle}
  .e{fill:none;stroke:${c.faint};stroke-width:1.2}
  .chip{font-size:11px;fill:${c.ink};text-anchor:middle}
  .chipk{font-size:9.5px;letter-spacing:.12em;font-weight:600;fill:${c.accent};text-anchor:middle}
  @media (prefers-reduced-motion: reduce){.pkt{display:none}}
</style>`);
  add(`<rect width="${W}" height="${H}" fill="${c.bg}"/>`);
  add(`<rect width="${W}" height="${H}" fill="url(#floor)"/>`);

  // Column captions
  caption(85, 34, 'IN', 'middle');
  caption(885, 34, 'AI + DATA', 'middle');

  // VPS frame
  add(`<rect x="180" y="48" width="590" height="470" rx="18" fill="none" stroke="${c.rule}" stroke-width="1.2"/>`);
  caption(200, 72, 'ONE HETZNER VPS · DOCKER COMPOSE');
  caption(750, 72, 'DEPLOYED ON MERGE TO MAIN', 'end');

  // Left: inputs
  node(20, 100, 130, 56, 'Users', ['any browser, no signup'], 'ext');
  node(20, 257, 130, 56, 'Gmail', ['recruiter replies'], 'ext');
  node(20, 410, 130, 56, 'Job boards', ['Greenhouse · Workday'], 'ext');

  // Row 1: serving
  caption(200, 104, 'SERVE');
  node(200, 112, 110, 50, 'Caddy', ['auto TLS']);
  node(340, 112, 130, 50, 'web', ['nginx · React SPA']);

  // Row 2: mail sync
  caption(200, 252, 'MAIL SYNC · DAILY 02:00 UTC');
  node(340, 260, 130, 50, 'mailbot', ['moves cards, never back']);

  // Row 3: daily ingest
  caption(200, 404, 'INGEST · DAILY 06:15 UTC');
  node(200, 412, 92, 50, 'publisher', ['1 msg / board']);
  node(310, 412, 92, 50, 'RabbitMQ', ['+ dead letters']);
  node(420, 412, 110, 50, 'consumer', ['hash · filter · embed']);

  // Hub: the API
  node(570, 96, 180, 400, '', [], 'hub');
  add(`<text x="660" y="126" class="t" style="font-size:15px">api</text>`);
  add(`<text x="660" y="143" class="s">ASP.NET Core · .NET 10</text>`);
  const chips = [
    ['RETRIEVE', '$vectorSearch + filters'],
    ['JUDGE', 'Claude Evaluator'],
    ['VERIFY', 'Correct() · 7 checks'],
    ['GENERATE', 'résumé packs, validated'],
  ];
  chips.forEach(([k, v], i) => {
    const y = 166 + i * 74;
    add(`<rect x="586" y="${y}" width="148" height="56" rx="9" fill="${c.bg}" stroke="color-mix(in oklab, ${c.accent} ${k === 'VERIFY' ? 80 : 35}%, transparent)"/>`);
    add(`<text x="660" y="${y + 22}" class="chipk">${k}</text>`);
    add(`<text x="660" y="${y + 40}" class="chip">${esc(v)}</text>`);
  });
  add(`<text x="660" y="482" class="cap" text-anchor="middle" style="fill:${c.accent}">ONLY CLAUDE CALLER</text>`);

  // Right: AI and data
  node(800, 96, 180, 64, 'Anthropic', ['Haiku 4.5 · facts, scoring', 'Sonnet 5 · résumé packs'], 'ext');
  node(800, 190, 180, 56, 'Voyage', ['voyage-4 · api + ingest'], 'ext');
  node(800, 290, 180, 84, 'MongoDB Atlas', ['shared job pool', 'per-user scores', 'vector index'], 'ext');

  // Edges
  edge('p-user', 'M150,128 C 175,128 175,137 198,137', '', 0, 0);
  edge('p-caddy', 'M310,137 H338', '', 0, 0);
  edge('p-web', 'M470,137 H568', 'HTTP', 520, 130);
  edge('p-claude', 'M750,128 H798', '', 0, 0);
  edge('p-query', 'M750,218 H798', 'embed', 774, 211);
  edge('p-store', 'M750,332 H798', 'store', 774, 325);
  edge('p-gmail', 'M150,285 H338', 'read', 245, 278);
  edge('p-mail', 'M470,285 H568', 'HTTP', 520, 278);
  edge('p-pub', 'M292,437 H308', '', 0, 0);
  edge('p-q', 'M402,437 H418', '', 0, 0);
  edge('p-facts', 'M530,437 H568', 'facts', 549, 430);
  edge('p-boards', 'M150,438 C 170,438 170,488 190,488 H 436 C 446,488 446,476 446,464', 'fetch', 320, 502);
  edge('p-ingest-store', 'M505,462 V 506 H 890 V 376', 'store', 822, 500);

  // Packets: a user request rides to Claude and the score lands in Atlas;
  // a board's postings ride the queue to the API.
  const L = 8;
  packet('p-user', 0.0, 0.5, L);
  packet('p-caddy', 0.5, 0.3, L);
  packet('p-web', 0.8, 0.6, L);
  packet('p-claude', 1.6, 0.4, L);
  packet('p-store', 2.4, 0.4, L, c.score);
  packet('p-gmail', 3.0, 0.7, L);
  packet('p-mail', 3.7, 0.5, L);
  packet('p-boards', 4.6, 1.1, L);
  packet('p-facts', 5.7, 0.4, L);
  packet('p-ingest-store', 5.8, 1.6, L);

  add(`</svg>`);
  return out.join('\n');
}

// The five stages, left to right. Each says who does the work -- the model or
// code -- because that split is the point: the model judges, code verifies.
const STAGES = [
  { n: '01', title: 'Fetch', who: 'CODE', subs: ['one call per board', 'SHA-256 skips unchanged'], value: 'never deletes', note: 'a failed fetch throws' },
  { n: '02', title: 'Filter', who: 'CODE', subs: ['age · location · function', 'before any paid call'], value: '0 of 116', note: 'wanted roles hidden' },
  { n: '03', title: 'Extract', who: 'MODEL', subs: ['Claude Haiku, batched', 'closed vocabularies'], value: 'once', note: 'per posting, for everyone' },
  { n: '04', title: 'Retrieve', who: 'CODE', subs: ['$vectorSearch on your CV', '+ filters on the facts'], value: 'unscored only', note: 'reach a paid call' },
  { n: '05', title: 'Score + verify', who: 'MODEL + CODE', subs: ['Claude judges, temp 0', 'Correct() overrides'], value: '7 checks', note: '22/24 on the golden set' },
];

function buildPipeline(c) {
  const PW = 1000, PH = 330, CW = 176, GAP = 20, X0 = 20, CY = 78, CH = 196;
  const cx = (i) => X0 + i * (CW + GAP);
  const out = [];
  const add = (s) => out.push(s);
  const mix = (pct) => `color-mix(in oklab, ${c.accent} ${pct}%, transparent)`;

  add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}" role="img" aria-labelledby="t d">`);
  add(`<title id="t">The path a posting takes</title>`);
  add(`<desc id="d">Five stages. Shared, once per posting: Fetch (code; one call per board, unchanged postings skipped by hash, never deletes, a failed fetch throws), Filter (code; age, location and function before any paid call; 0 of 116 checked wanted roles hidden), Extract (model; Claude Haiku reads each posting once for every user). Per user, on demand: Retrieve (code; vector search on the CV plus filters, only unscored postings reach a paid call), Score and verify (Claude judges at temperature 0, then seven server-side checks in Correct() override it; 22 of 24 on the golden set).</desc>`);
  add(`<defs>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="9"/><feFlood flood-color="${c.accent}" flood-opacity="0.35"/><feComposite operator="in" in2="SourceAlpha"/><feComposite operator="over" in="SourceGraphic"/></filter>
  <radialGradient id="floor" cx="80%" cy="55%" r="60%"><stop offset="0" stop-color="${c.accent}" stop-opacity="0.10"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></radialGradient>
</defs>`);
  add(`<style>
  text{font-family:${FONT}}
  .n{font-size:10px;font-weight:600;letter-spacing:.14em;fill:${c.accent}}
  .h{font-size:16px;font-weight:600;fill:${c.ink}}
  .s{font-size:11px;fill:${c.soft}}
  .v{font-size:15px;font-weight:700;fill:${c.ink}}
  .vn{font-size:10.5px;fill:${c.soft}}
  .cap{font-size:10px;font-weight:600;letter-spacing:.14em;fill:${c.faint}}
  .who{font-size:9px;font-weight:700;letter-spacing:.12em}
  .rail{fill:none;stroke:${c.faint};stroke-width:1.2;stroke-dasharray:2 5}
  @media (prefers-reduced-motion: reduce){.pkt{display:none}}
</style>`);
  add(`<rect width="${PW}" height="${PH}" fill="${c.bg}"/><rect width="${PW}" height="${PH}" fill="url(#floor)"/>`);

  // Bands: what is shared vs what is per user.
  const band = (x1, x2, label) => {
    add(`<path d="M${x1},52 V46 H${x2} V52" fill="none" stroke="${c.rule}" stroke-width="1.2"/>`);
    add(`<text x="${(x1 + x2) / 2}" y="36" class="cap" text-anchor="middle">${label}</text>`);
  };
  band(cx(0), cx(2) + CW, 'SHARED · ONCE PER POSTING');
  band(cx(3), cx(4) + CW, 'PER USER · ON DEMAND');

  // The rail the packets ride, drawn behind the cards so a packet shows only
  // between stages.
  const railY = CY + 70;
  add(`<path id="rail" d="M${X0 - 14},${railY} H${cx(4) + CW + 14}" class="rail"/>`);
  // The skip: out of the filter's bottom, down and away.
  const fx = cx(1) + CW / 2;
  add(`<path id="skip" d="M${fx},${CY + CH} C ${fx},${CY + CH + 22} ${fx + 30},${CY + CH + 30} ${fx + 64},${CY + CH + 34}" class="rail"/>`);
  add(`<text x="${fx + 70}" y="${CY + CH + 38}" class="vn">skipped, never paid for</text>`);

  const L = 7;
  const packet = (pathId, begin, dur, color) => {
    const a = begin / L, b = Math.min((begin + dur) / L, 1);
    add(`<circle r="4" class="pkt" fill="${color}" opacity="0"><animateMotion dur="${L}s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;${a.toFixed(3)};${b.toFixed(3)};1" calcMode="linear"><mpath href="#${pathId}"/></animateMotion><animate attributeName="opacity" dur="${L}s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;${a.toFixed(3)};${(a + 0.004).toFixed(3)};${(b - 0.004).toFixed(3)};${b.toFixed(3)};1"/></circle>`);
  };
  packet('rail', 0.0, 4.6, c.accent);
  packet('rail', 1.1, 4.6, c.accent);
  packet('skip', 1.6, 0.9, c.faint);
  packet('skip', 3.4, 0.9, c.faint);

  STAGES.forEach((st, i) => {
    const x = cx(i), last = i === STAGES.length - 1;
    add(`<rect x="${x}" y="${CY}" width="${CW}" height="${CH}" rx="14" fill="${last ? c.panelHi : c.panel}" stroke="${last ? c.accent : mix(45)}" stroke-width="${last ? 1.6 : 1.1}"${last ? ' filter="url(#glow)"' : ''}/>`);
    add(`<text x="${x + 16}" y="${CY + 26}" class="n">${st.n}</text>`);
    // Who does the work: MODEL is filled with the accent, CODE is outlined.
    let wx = x + CW - 14;
    [...st.who.split(' + ')].reverse().forEach((w) => {
      const tw = w.length * 6.6 + 14;
      wx -= tw;
      const model = w === 'MODEL';
      add(`<rect x="${wx}" y="${CY + 13}" width="${tw}" height="18" rx="9" fill="${model ? mix(22) : 'none'}" stroke="${model ? mix(70) : c.faint}"/>`);
      add(`<text x="${wx + tw / 2}" y="${CY + 25.5}" class="who" text-anchor="middle" fill="${model ? c.accent : c.soft}">${w}</text>`);
      wx -= 6;
    });
    add(`<text x="${x + 16}" y="${CY + 60}" class="h">${esc(st.title)}</text>`);
    st.subs.forEach((s, k) => add(`<text x="${x + 16}" y="${CY + 84 + k * 16}" class="s">${esc(s)}</text>`));
    // The number the stage is held to; the last one pulses green as a score lands.
    const my = CY + CH - 66;
    const pulse = last ? `<animate attributeName="stroke-opacity" dur="${L}s" repeatCount="indefinite" values="0.35;0.35;1;0.35" keyTimes="0;0.66;0.74;1"/>` : '';
    add(`<rect x="${x + 12}" y="${my}" width="${CW - 24}" height="52" rx="10" fill="${c.bg}" stroke="${last ? c.score : mix(30)}">${pulse}</rect>`);
    add(`<text x="${x + 24}" y="${my + 22}" class="v"${last ? ` style="fill:${c.score}"` : ''}>${esc(st.value)}</text>`);
    add(`<text x="${x + 24}" y="${my + 40}" class="vn">${esc(st.note)}</text>`);
  });

  add(`</svg>`);
  return out.join('\n');
}

// What a user does, left to right. ai: the step calls Claude. out: the step
// happens outside NextRole.
const JOURNEY = [
  { n: '1', title: 'Upload CV', subs: ['no signup,', 'read into a profile'], ai: true },
  { n: '2', title: 'Matches', subs: ['ranked for you,', 'with the reasons'], ai: true },
  { n: '3', title: 'Save', subs: ['to your board,', '3 a day'] },
  { n: '4', title: 'Résumé pack', subs: ['tailored and', 'fact-checked'], ai: true },
  { n: '5', title: 'Apply', subs: ["on the company's", 'own site'], out: true },
  { n: '6', title: 'Track', subs: ['Gmail replies', 'move the card'], ai: true },
  { n: '7', title: 'Prep', subs: ['interview', 'practice'], ai: true },
];

function buildJourney(c) {
  const JW = 1000, JH = 210, CW = 124, GAP = 15, X0 = 20, CY = 64, CH = 112;
  const cx = (i) => X0 + i * (CW + GAP);
  const out = [];
  const add = (s) => out.push(s);
  const mix = (pct) => `color-mix(in oklab, ${c.accent} ${pct}%, transparent)`;

  add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${JW} ${JH}" width="${JW}" height="${JH}" role="img" aria-labelledby="t d">`);
  add(`<title id="t">What a user does</title>`);
  add(`<desc id="d">Find, with no account: 1 upload a CV, read into a profile by Claude; 2 Matches, ranked for you with the reasons. Apply and track: 3 save to your board, 3 a day; 4 a tailored, fact-checked résumé pack; 5 apply on the company's own site, outside NextRole; 6 track, as Gmail replies move the card; 7 interview prep.</desc>`);
  add(`<defs><radialGradient id="floor" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="${c.accent}" stop-opacity="0.08"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></radialGradient></defs>`);
  add(`<style>
  text{font-family:${FONT}}
  .n{font-size:10px;font-weight:600;letter-spacing:.14em;fill:${c.accent}}
  .h{font-size:14.5px;font-weight:600;fill:${c.ink}}
  .s{font-size:11px;fill:${c.soft}}
  .cap{font-size:10px;font-weight:600;letter-spacing:.14em;fill:${c.faint}}
  .who{font-size:8.5px;font-weight:700;letter-spacing:.12em}
  .rail{fill:none;stroke:${c.faint};stroke-width:1.2;stroke-dasharray:2 5}
  @media (prefers-reduced-motion: reduce){.pkt{display:none}}
</style>`);
  add(`<rect width="${JW}" height="${JH}" fill="${c.bg}"/><rect width="${JW}" height="${JH}" fill="url(#floor)"/>`);

  const band = (x1, x2, label) => {
    add(`<path d="M${x1},44 V38 H${x2} V44" fill="none" stroke="${c.rule}" stroke-width="1.2"/>`);
    add(`<text x="${(x1 + x2) / 2}" y="28" class="cap" text-anchor="middle">${label}</text>`);
  };
  band(cx(0), cx(1) + CW, 'FIND · NO ACCOUNT');
  band(cx(2), cx(6) + CW, 'APPLY AND TRACK · ONE BOARD, KEPT CURRENT BY YOUR INBOX');

  const railY = CY + CH / 2;
  add(`<path id="jrail" d="M${X0 - 12},${railY} H${cx(6) + CW + 12}" class="rail"/>`);
  const L = 8;
  [0, 4].forEach((begin) => {
    const a = begin / L, b = (begin + 4) / L;
    add(`<circle r="4" class="pkt" fill="${c.accent}" opacity="0"><animateMotion dur="${L}s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;${a.toFixed(3)};${b.toFixed(3)};1" calcMode="linear"><mpath href="#jrail"/></animateMotion><animate attributeName="opacity" dur="${L}s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;${a.toFixed(3)};${(a + 0.004).toFixed(3)};${(b - 0.004).toFixed(3)};${b.toFixed(3)};1"/></circle>`);
  });

  JOURNEY.forEach((st, i) => {
    const x = cx(i);
    const stroke = st.out ? c.faint : mix(45);
    add(`<rect x="${x}" y="${CY}" width="${CW}" height="${CH}" rx="14" fill="${c.panel}" stroke="${stroke}" stroke-width="1.1"${st.out ? ' stroke-dasharray="4 4"' : ''}/>`);
    add(`<text x="${x + 14}" y="${CY + 24}" class="n">${st.n}</text>`);
    const tag = st.ai ? 'CLAUDE' : st.out ? 'OUTSIDE' : '';
    if (tag) {
      const tw = tag.length * 6.4 + 12;
      add(`<rect x="${x + CW - 12 - tw}" y="${CY + 12}" width="${tw}" height="17" rx="8.5" fill="${st.ai ? mix(22) : 'none'}" stroke="${st.ai ? mix(70) : c.faint}"/>`);
      add(`<text x="${x + CW - 12 - tw / 2}" y="${CY + 23.8}" class="who" text-anchor="middle" fill="${st.ai ? c.accent : c.soft}">${tag}</text>`);
    }
    add(`<text x="${x + 14}" y="${CY + 58}" class="h">${esc(st.title)}</text>`);
    st.subs.forEach((s, k) => add(`<text x="${x + 14}" y="${CY + 80 + k * 15}" class="s">${esc(s)}</text>`));
  });

  add(`</svg>`);
  return out.join('\n');
}

const BUILDS = { architecture: buildArchitecture, pipeline: buildPipeline, journey: buildJourney };
for (const [diagram, build] of Object.entries(BUILDS)) {
  for (const [name, theme] of Object.entries(THEMES)) {
    const file = path.join(root, `docs/images/${diagram}-${name}.svg`);
    fs.writeFileSync(file, build(theme));
    console.log('wrote', path.relative(root, file));
  }
}
