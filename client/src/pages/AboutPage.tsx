import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { CompanyAvatar } from '../components/CompanyAvatar';
import { scoreColor } from '../lib/format';

// The public story of the product and how it is built: what the README tells
// an engineer, told to anyone who reaches nextrole.cloud. Reached from the
// Landing hero and the footer, never from the main nav (that row is for what
// users do, not what they read once). Open to visitors without a CV —
// ONBOARDING_EXEMPT_PATHS in App.tsx.
//
// The three diagrams are the README's, dark copies written to public/about/
// by scripts/build-readme-diagrams.cjs: rerun it after changing one. The
// mockups below are drawn here from fictional companies (the demo seed's), so
// they stay sharp and on-theme rather than screenshots that go stale.

const SECTIONS = [
  { id: 'what', label: 'What it does' },
  { id: 'different', label: "Why it's different" },
  { id: 'built', label: "How it's built" },
  { id: 'facts', label: 'Key facts' },
  { id: 'who', label: 'Who built it' },
];

const REPO = 'https://github.com/ozShpigel/nextrole';

function ScoreRing({ score, size = 34 }: { score: number; size?: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${score} match`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ed-rule)" strokeWidth="2.5" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.32} fontWeight="700" fill={color}>{score}</text>
    </svg>
  );
}

// A tilted device frame, the way the product's own screens would sit on a desk.
function Frame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[18px] border border-[var(--ed-rule-strong)] bg-[var(--ed-panel)] shadow-[0_30px_80px_-30px_color-mix(in_oklab,var(--ed-accent)_45%,transparent)] ${className}`}>
      {children}
    </div>
  );
}

const MATCHES = [
  { company: 'Solace Fintech', role: 'Staff Software Engineer', score: 88, tilt: 'rotateY(12deg) translateZ(-20px)' },
  { company: 'Meridian Robotics', role: 'Senior Backend Engineer', score: 91, tilt: 'none' },
  { company: 'Stratus Cloud', role: 'Backend Engineer', score: 82, tilt: 'rotateY(-12deg) translateZ(-20px)' },
];

// On a phone the three cards are narrower and the side ones tuck behind the
// centre one, so the fan fits a 360px screen instead of being cut at its edges.
function MatchFan() {
  return (
    <div className="flex items-center justify-center sm:gap-2.5 [perspective:1100px] py-6">
      {MATCHES.map((m, i) => (
        <div
          key={m.company}
          style={{ transform: m.tilt }}
          className={`${i === 1 ? 'relative z-10 w-[9.5rem] sm:w-[10.5rem]' : 'w-[6.75rem] sm:w-[8.25rem]'} ${i === 0 ? '-mr-3 sm:mr-0' : ''} ${i === 2 ? '-ml-3 sm:ml-0' : ''} shrink-0 motion-safe:transition-transform motion-safe:duration-500`}
        >
          <Frame className={`${i === 1 ? 'p-3.5 sm:p-4 border-[var(--ed-accent)]' : 'p-3 sm:p-4'}`}>
            <div className="flex items-start justify-between">
              <CompanyAvatar name={m.company} size={i === 1 ? 34 : 28} shape="tile" />
              <ScoreRing score={m.score} size={i === 1 ? 40 : 32} />
            </div>
            <p className="mt-4 text-[11px] text-[var(--ed-ink-faint)] truncate">{m.company}</p>
            <p className={`mt-0.5 font-semibold leading-tight text-[var(--ed-ink)] ${i === 1 ? 'text-[15px]' : 'text-[12.5px]'}`}>{m.role}</p>
            {i === 1 && (
              <div className="mt-4 grid grid-cols-3 gap-1.5 text-center">
                {[['32', '35', 'Technical'], ['28', '30', 'Execution'], ['33', '35', 'Sustain.']].map(([v, max, k]) => (
                  <div key={k} className="rounded-lg border border-[var(--ed-rule)] py-1.5">
                    <p className="text-[12px] font-bold" style={{ color: scoreColor(+v, +max) }}>{v}</p>
                    <p className="text-[8.5px] text-[var(--ed-ink-faint)]">{k}</p>
                  </div>
                ))}
              </div>
            )}
          </Frame>
        </div>
      ))}
    </div>
  );
}

function PackMock() {
  return (
    <div className="flex justify-center py-6 [perspective:1100px]">
      <div style={{ transform: 'rotateY(-10deg) rotateX(4deg)' }} className="w-[17rem]">
        <Frame className="p-5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ed-accent)]/60 bg-[var(--ed-accent)]/10 px-2.5 py-1 text-[9.5px] font-bold tracking-[0.14em] text-[var(--ed-accent)]">
            PACK READY
          </span>
          <div className="mt-4 flex items-center gap-3">
            <CompanyAvatar name="Solace Fintech" size={36} shape="tile" />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[var(--ed-ink)] leading-tight">Staff Software Engineer</p>
              <p className="text-[11px] text-[var(--ed-ink-faint)]">Solace Fintech · Remote</p>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-[var(--ed-rule)] bg-[var(--ed-paper)] p-3.5 space-y-2.5">
            <p className="text-[9.5px] font-bold tracking-[0.14em] text-[var(--ed-ink-faint)]">CHECKED AGAINST YOUR CV</p>
            {['Every skill is on your profile', 'No figure your CV never stated', 'Tailored to this posting'].map((t) => (
              <p key={t} className="flex items-center gap-2 text-[11.5px] text-[var(--ed-ink-soft)]">
                <Check size={13} className="text-[var(--ed-yes)] shrink-0" aria-hidden="true" />
                {t}
              </p>
            ))}
          </div>
          <div className="mt-4 rounded-full bg-[var(--ed-accent)] py-2 text-center text-[12px] font-semibold text-[var(--ed-paper)]">
            Download PDF
          </div>
        </Frame>
      </div>
    </div>
  );
}

const BOARD = [
  { col: 'Added', company: 'Northwind Labs', role: 'Platform Engineer' },
  { col: 'Ready', company: 'Solace Fintech', role: 'Staff Engineer' },
  { col: 'Applied', company: 'Meridian Robotics', role: 'Senior Backend' },
  { col: 'Interviewing', company: 'Stratus Cloud', role: 'Backend Engineer' },
];

function BoardMock() {
  return (
    <div className="flex justify-center py-6 [perspective:1200px]">
      <div style={{ transform: 'rotateY(10deg) rotateX(3deg)' }} className="w-full max-w-[30rem]">
        <Frame className="p-4">
          <p className="text-[13px] font-semibold text-[var(--ed-ink)]">Active</p>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {BOARD.map((b) => (
              <div key={b.col} className="min-w-0">
                <p className="text-[8px] sm:text-[8.5px] font-bold tracking-[0.04em] sm:tracking-[0.12em] uppercase text-[var(--ed-ink-faint)] truncate">{b.col}</p>
                <div className="mt-1.5 h-[2px] rounded bg-[var(--ed-accent)]/50" />
                <div className="mt-2 rounded-lg border border-[var(--ed-rule)] bg-[var(--ed-paper)] p-2">
                  <CompanyAvatar name={b.company} size={20} shape="tile" />
                  <p className="mt-1.5 text-[10px] font-semibold text-[var(--ed-ink)] leading-tight">{b.company}</p>
                  <p className="text-[9px] text-[var(--ed-ink-faint)] leading-tight">{b.role}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--ed-accent)]/40 bg-[var(--ed-accent)]/10 px-3 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--ed-accent)]" aria-hidden="true" />
            <p className="text-[10.5px] text-[var(--ed-ink-soft)]">
              Stratus Cloud replied in Gmail: <span className="text-[var(--ed-ink)]">interview requested</span>
            </p>
          </div>
        </Frame>
      </div>
    </div>
  );
}

function Feature({ title, body, visual, flip = false }: { title: string; body: ReactNode; visual: ReactNode; flip?: boolean }) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-2 md:gap-14 py-10 md:py-14">
      <div className={flip ? 'md:order-2' : ''}>
        <h3 className="text-[1.45rem] md:text-[1.7rem] font-semibold tracking-[-0.015em] text-[var(--ed-ink)]">{title}</h3>
        <div className="mt-4 text-[1rem] md:text-[1.06rem] leading-[1.75] text-[var(--ed-ink-soft)]">{body}</div>
      </div>
      <div className="min-w-0">{visual}</div>
    </div>
  );
}

// A diagram wider than a phone scrolls sideways inside its own box instead of
// shrinking to unreadable or pushing the page wide. Below md the box only
// shows its first third, so a caption says there is more.
function Diagram({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="mt-8">
      <div className="ed-scroll overflow-x-auto rounded-2xl border border-[var(--ed-rule)]">
        <img src={src} alt={alt} className="block w-full min-w-[46rem]" />
      </div>
      <p className="md:hidden mt-2 text-[0.78rem] text-[var(--ed-ink-faint)]" aria-hidden="true">
        Swipe to see the whole diagram &rarr;
      </p>
    </div>
  );
}

function SectionHead({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-32">
      <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-[var(--ed-accent)]">{eyebrow}</p>
      <h2 className="mt-3 text-[2rem] md:text-[2.6rem] font-semibold leading-[1.08] tracking-[-0.025em] text-[var(--ed-ink)]">{title}</h2>
      {children && <div className="mt-4 max-w-[44rem] text-[1.02rem] leading-[1.75] text-[var(--ed-ink-soft)]">{children}</div>}
    </div>
  );
}

const FACTS = [
  { value: '7', label: 'server-side checks on every score' },
  { value: '22/24', label: 'on a hand-labelled golden set' },
  { value: '545', label: 'backend tests' },
  { value: 'Every merge', label: 'deploys to production' },
];

const DECISIONS = [
  ['Score on demand, not at ingest', 'A score is about one person, so only what someone looks at costs anything.'],
  ['Company job boards, not scraping', "Each board's completeness can be proven, so a failed fetch never closes live jobs."],
  ['Vector search inside the database', 'One database to run. It shortlists; it never scores.'],
];

export default function AboutPage() {
  return (
    <div className="editorial editorial-grain min-h-screen overflow-x-clip">
      <div className="relative z-[1]">
        {/* Hero */}
        <header className="mx-auto max-w-[72rem] px-4 sm:px-8 pt-14 md:pt-20 pb-12">
          <p className="text-[0.95rem] font-medium text-[var(--ed-accent)]">About NextRole</p>
          <h1 className="mt-4 max-w-[46rem] text-[2.6rem] md:text-[4.2rem] font-semibold leading-[1.02] tracking-[-0.035em] text-[var(--ed-ink)]">
            An AI job search, from CV to offer.
          </h1>
          <p className="mt-6 max-w-[42rem] text-[1.15rem] md:text-[1.3rem] font-medium leading-[1.5] text-[var(--ed-ink)]">
            It finds open roles that fit your CV, tailors a résumé for each one, and tracks every application to the offer.
          </p>
          <p className="mt-5 max-w-[42rem] text-[1rem] md:text-[1.06rem] leading-[1.75] text-[var(--ed-ink-soft)]">
            Job hunting is scattered. Postings live on many company sites, keyword alerts match words instead of people, and once you
            apply, progress hides in email threads and a spreadsheet you stop updating. NextRole is the one place that finds the roles
            that fit you and keeps track of them until the offer.
          </p>
        </header>

        {/* Section bar */}
        <nav aria-label="On this page" className="sticky top-14 z-20 border-y border-[var(--ed-rule)] bg-[var(--ed-paper)]/80 backdrop-blur-[16px]">
          {/* Below md the links overflow and scroll; the fade at the right edge says so. */}
          <div className="ed-scroll mx-auto max-w-[72rem] px-4 sm:px-8 flex gap-6 overflow-x-auto [mask-image:linear-gradient(to_right,black_82%,transparent)] md:[mask-image:none]">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="shrink-0 py-3.5 text-[0.88rem] font-medium text-[var(--ed-ink-soft)] transition-colors hover:text-[var(--ed-ink)]"
              >
                {s.label}
              </a>
            ))}
          </div>
        </nav>

        <main className="mx-auto max-w-[72rem] px-4 sm:px-8">
          {/* What it does */}
          <section className="pt-16 md:pt-24">
            <SectionHead id="what" eyebrow="What it does" title="What NextRole does" />
            <Feature
              title="AI job matching"
              body={<>Upload your CV and NextRole ranks open roles from company job boards against it, with a score, a verdict and the reasons on every job. The boards are read every day, so your matches are roles that are still open.</>}
              visual={<MatchFan />}
            />
            <Feature
              flip
              title="Tailored résumés, checked before you see them"
              body={<>For each role you pick, NextRole writes a résumé from your real experience. Before you see it, code checks it against your CV: a skill you don't have is removed, and a figure you never stated blocks the pack.</>}
              visual={<PackMock />}
            />
            <Feature
              title="One board, from saved to interviewing"
              body={<>Every application moves through one board: Added, Ready, Applied, Interviewing. Replies in Gmail can move the card for you (rolling out), and the Prep tab gets you ready for the interview itself.</>}
              visual={<BoardMock />}
            />
            <Diagram src="/about/journey.svg" alt="What a user does, in seven steps: upload a CV, see matches, save to the board, get a résumé pack, apply on the company's site, track replies, prep for the interview." />
          </section>

          {/* Why it's different */}
          <section className="pt-20 md:pt-28">
            <SectionHead id="different" eyebrow="Why it's different" title="The model judges. Code verifies.">
              AI is confident even when it's wrong, and a wrong match looks exactly like a right one. So Claude makes the judgement,
              and code checks it against your CV and the posting, using data the model didn't write, before you see it.
            </SectionHead>
            <Diagram src="/about/pipeline.svg" alt="The path a posting takes: fetch, filter, extract, retrieve, then score and verify. Each stage is done by code or by the model; the last is both: Claude judges, then seven checks in code override it." />
            <ul className="mt-10 grid gap-4 md:grid-cols-2">
              {[
                ['Code overrides the model.', 'Every rule the model was caught breaking — ignoring score caps, claiming skills a CV lacks, answering yes past a dealbreaker — moved out of the prompt and into code.'],
                ['Measured, not assumed.', 'An eval harness runs 24 hand-labelled postings through the real scoring path: 22/24, stable across runs.'],
              ].map(([h, b]) => (
                <li key={h} className="rounded-2xl border border-[var(--ed-rule)] bg-[var(--ed-panel)] p-6">
                  <p className="font-semibold text-[var(--ed-ink)]">{h}</p>
                  <p className="mt-2 text-[0.95rem] leading-[1.7] text-[var(--ed-ink-soft)]">{b}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* How it's built */}
          <section className="pt-20 md:pt-28">
            <SectionHead id="built" eyebrow="How it's built" title="One API, one key, one VPS.">
              Every service goes through one API, the only one that talks to Claude. .NET 10 · React · MongoDB Atlas with vector
              search · RabbitMQ · Claude · Docker on one Hetzner VPS, where every merge to main deploys.
            </SectionHead>
            <Diagram src="/about/architecture.svg" alt="Architecture: users, Gmail and company job boards feed services on one VPS; everything goes through the API, the only Claude caller; on the right Anthropic, Voyage and MongoDB Atlas." />
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {DECISIONS.map(([h, b]) => (
                <div key={h} className="rounded-2xl border border-[var(--ed-rule)] p-6">
                  <p className="font-semibold text-[var(--ed-ink)]">{h}</p>
                  <p className="mt-2 text-[0.95rem] leading-[1.7] text-[var(--ed-ink-soft)]">{b}</p>
                </div>
              ))}
            </div>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="mt-8 inline-block text-[1rem] font-medium text-[var(--ed-accent)] hover:underline">
              Read the engineering write-up &rarr;
            </a>
          </section>

          {/* Key facts */}
          <section className="pt-20 md:pt-28">
            <SectionHead id="facts" eyebrow="Key facts" title="By the numbers" />
            <dl className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4">
              {FACTS.map((f) => (
                <div key={f.label} className="rounded-2xl border border-[var(--ed-rule)] bg-[var(--ed-panel)] p-6">
                  <dt className="sr-only">{f.label}</dt>
                  <dd className="text-[1.9rem] md:text-[2.3rem] font-semibold tracking-[-0.03em] text-[var(--ed-ink)] leading-none">{f.value}</dd>
                  <dd className="mt-3 text-[0.9rem] leading-[1.5] text-[var(--ed-ink-soft)]">{f.label}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Who built it */}
          <section className="pt-20 md:pt-28 pb-24">
            <SectionHead id="who" eyebrow="Who built it" title="Built by one engineer" />
            <div className="mt-10 max-w-[44rem] rounded-2xl border border-[var(--ed-rule)] bg-[var(--ed-panel)] p-7 md:p-8">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 shrink-0 rounded-full border border-[var(--ed-accent)]/50 bg-[var(--ed-accent)]/10 flex items-center justify-center text-[1.1rem] font-semibold text-[var(--ed-accent)]">
                  OS
                </div>
                <div>
                  <p className="text-[1.25rem] font-semibold text-[var(--ed-ink)]">Oz Shpigel</p>
                  <p className="mt-0.5 text-[0.72rem] font-semibold tracking-[0.16em] uppercase text-[var(--ed-accent)]">Platform Engineer</p>
                </div>
              </div>
              <p className="mt-5 text-[1rem] leading-[1.75] text-[var(--ed-ink-soft)]">
                I build internal platforms: fourteen years across backend, DevOps and platform engineering, most recently at Payoneer,
                where 700+ developers manage feature flags through the self-service layer I built. NextRole is where I put LLMs into
                production the same way: designed, built and run end to end.
              </p>
              <div className="mt-6 flex flex-wrap gap-5 text-[0.95rem] font-medium">
                <a href="https://www.linkedin.com/in/ozshpigel" target="_blank" rel="noopener noreferrer" className="text-[var(--ed-accent)] hover:underline">LinkedIn &rarr;</a>
                <a href={REPO} target="_blank" rel="noopener noreferrer" className="text-[var(--ed-accent)] hover:underline">GitHub &rarr;</a>
              </div>
            </div>
            <Link to="/" className="mt-14 inline-block text-[1rem] font-medium text-[var(--ed-ink-soft)] hover:text-[var(--ed-ink)]">
              &larr; Back to NextRole
            </Link>
          </section>
        </main>
      </div>
    </div>
  );
}
