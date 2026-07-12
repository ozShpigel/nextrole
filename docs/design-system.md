# Design System — Editorial Broadsheet

The frontend uses a custom **Editorial Broadsheet** theme — warm paper, hairline rules, Fraunces display serif — layered over shadcn/ui. It is a **scoped sub-theme** (not a global override) defined in `client/src/index.css` under the `.editorial` class, with both light and dark variants (`.dark .editorial`), so it follows the global theme toggle.

- **Tokens** (`--ed-*` CSS vars): `--ed-paper`, `--ed-panel`, `--ed-ink`, `--ed-ink-soft`, `--ed-ink-faint`, `--ed-rule`, `--ed-rule-strong`, `--ed-accent` (vermillion), `--ed-accent-deep`, `--ed-yes` (sage), `--ed-no` (oxblood), `--ed-gold` (ochre). Semantic mapping: success→`--ed-yes`, error/destructive→`--ed-no`, warning→`--ed-gold`, accent/primary→`--ed-accent`.
- **Usage**: inside an editorial page, style with these tokens via Tailwind arbitrary values — `text-[var(--ed-ink)]`, `border-[var(--ed-rule)]`, `bg-[var(--ed-panel)]/40`, and `color-mix(in oklab, var(--ed-yes) 10%, transparent)` for tints — **not** the neutral shadcn tokens (`text-foreground`, `bg-card`, `text-muted-foreground`, …).
- **Helpers** (in `index.css`): `.editorial-grain` (paper grain overlay), `.ed-display` (Fraunces, loaded in `index.html`), `.ed-rise` (staggered entry), `.ed-fill` (ruled-meter fill via inline `--p`).
- **Page pattern**: wrap in `<div className="editorial editorial-grain min-h-screen"><div className="relative z-[1] max-w-… mx-auto …">…</div></div>`; lead with a masthead (dateline rule + `ed-display` title with an italic vermillion accent word + `border-double` rule) and italic/numbered `ed-display` section heads over heavy rules.
- **Scope caveat**: `var(--ed-*)` only resolves **inside** the `.editorial` subtree. The global nav (`App.tsx`) stays neutral by design. **Do not** put `--ed-*` styling on anything rendered in a React **portal** (shadcn `Dialog`/`Select` content mounts at `document.body`, outside `.editorial`) or on a component shared with a non-editorial host.
- **Covered pages** (all editorial): Home (`LandingPage`), Discovery, Run detail, Search Matches (`SearchPage`), Tracker (Dashboard/Applications/Statistics/Add), Application detail, Score a Job, Interview Prep, Practice Interview, Settings. Shared primitives: a local editorial `Button`, `SectionHeader`, and status **stamps** (sharp, uppercase, tinted, 2px left tone-bar).
- **Status colors are centralized**: application statuses → `STATUS_TONE` in `components/Status.tsx` (also drives the Statistics breakdown bars); discovery run statuses → `statusTone`/`statusDotColors`/`statusBadgeColors` in `lib/discovery.ts`. Both map the pipeline onto the `--ed-*` tones — extend these maps rather than re-coloring badges inline.
- **Reference**: `design-prototypes/editorial-broadsheet.html` is a self-contained mockup of the look.

## RTL / bidi content

The frontend is an English LTR SPA, but content can be mixed Hebrew RTL (AI summaries, prompts, interview text) — render those nodes with `dir="rtl"`/`dir="auto"`.
