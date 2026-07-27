# Demo clip recording

Short, silent, single-purpose GIFs — one clip per feature, generated from a
small script checked into the repo, recorded against safe fictional seeded
data. Modeled on [charmbracelet/gum's README](https://github.com/charmbracelet/gum):
one tiny clip per feature, embedded directly under the heading it illustrates,
no captions (the heading *is* the caption).

This replaces re-recording a long combined GIF against the live personal dev
database every time the UI changes: re-recording one clip is "rerun the
script," not "re-litigate a recording session."

**Scope note:** this directory only produces the clips. `README.md` at the
repo root and `docs/images/demo.gif` (the existing combined GIF) are untouched
here — swapping the README over to per-feature clips is a separate follow-up.

## How it's organized

```
docs/demos/
  playwright.config.ts   Recording-only Playwright config (see below)
  specs/                 One .spec.ts per clip — navigate, act, let it render
  render-gif.sh          webm -> optimized GIF (ffmpeg, two-pass palette)
  record.sh              One command: run a spec, encode its video to a GIF
  output/                Recorded clips land here (output/<name>.gif is
                          committed for now; raw .webm + test-results/ are
                          gitignored). A later pass moves finished GIFs into
                          docs/images/ once the README is restructured.
```

This is **not** `/e2e`. `/e2e/playwright.config.ts` runs assertions against
disposable `job-tracker-test`/`jobmatch-test` databases that `global-setup.ts`
drops on every run. This config instead points the app at a **persistent**
seeded database (never dropped) so a clip stays reproducible across sessions,
and sets `DemoMode=true` so the recording matches what a real public-demo
visitor sees (read-only banner, writes blocked). It reuses `/e2e`'s
`@playwright/test` version but has its own `node_modules` — the two configs
serve different purposes and shouldn't share a test run.

## One-time setup: the demo-recording databases

Two new databases on the **same Atlas cluster** the app already uses — never
the live personal DBs (`job-tracker`/`jobmatch`) and never the e2e test DBs
(`job-tracker-test`/`jobmatch-test`, which get dropped):

- `job-tracker-demo-recording` — applications, interviews, discovery data
- `jobmatch-demo-recording` — the candidate profile

Both seed commands are idempotent — safe to rerun any time (e.g. after
changing the sample profile or wanting fresh timestamps).

### 1. Seed the fictional persona + tracked applications/interviews

From the repo root, with `MongoDB__ConnectionString` set to the **same**
connection string already in `server/api/src/Api/.env` (same cluster, just
different DB names below):

```bash
MongoDB__ConnectionString="<same cluster connection string as server/api/src/Api/.env>" \
MongoDB__DatabaseName="job-tracker-demo-recording" \
MongoDB__ProfileDatabase="jobmatch-demo-recording" \
dotnet run --project server/api/src/Seeder
```

Seeds the sample persona profile + interview-prep, a handful of fictional
tracked applications across varied statuses, and one discovery run with
scored jobs (`server/api/src/Seeder/Program.cs`).

### 2. Seed the fictional search pool (scraper)

The Search page's vector search needs embedded job postings. With the
scraper's own `OPENAI_API_KEY` (reuse the one in `server/scraper/.env` —
needed once, to embed ~30 fictional postings) and `MONGODB_DATABASE_NAME`
pointed at the recording DB:

```powershell
$env:MONGODB_DATABASE_NAME = "job-tracker-demo-recording"
cd server/scraper
.\.venv\Scripts\python.exe -m app.cli seed-demo-jobs
```

This embeds and inserts the fictional postings in
`server/scraper/app/services/demo_seed.py` (~30 postings spanning strong
matches, partial matches, culture red flags, and clear mismatches — enough
for the advisor to make real ranking decisions). `MONGODB_CONNECTION_STRING`
and `OPENAI_API_KEY` come from `server/scraper/.env` as usual; only the
database name is overridden.

Because the seeded jobs' `discovered_at` needs to stay inside the Search
page's days-back window, the scraper refreshes it automatically on every
startup when `DEMO_MODE=true` (`refresh_seed_timestamps`, called from
`app/main.py`) — which the recording config always sets, so this is
self-maintaining.

## Recording a clip

```bash
cd docs/demos
npm install              # first time only
npx playwright install chromium   # first time only, if not already cached
./record.sh search       # runs specs/search.spec.ts, writes output/search.gif
```

`record.sh` runs the named spec against `playwright.config.ts`'s `webServer`s
(API on :5002, scraper on :8000, client on :5173 — all pointed at the
demo-recording DBs with `DemoMode=true`, mirroring `/e2e`'s `webServer`
structure), grabs the resulting `.webm` from Playwright's built-in
`recordVideo`, and hands it to `render-gif.sh` for a two-pass
palettegen/paletteuse encode — cropped to the actual content area (fixed
viewport == recorded video size, so no letterboxing), no caption strip, no
`drawtext`.

Like `/e2e`, `reuseExistingServer` is on outside CI: if you already have dev
servers running on those ports, **stop them first** (or point your own dev
servers at the demo-recording DBs) — otherwise the recording config spawns
its own, pointed at the recording DBs as configured above.

To add a new clip: write `specs/<name>.spec.ts` (short, single-purpose — one
interaction, no captions needed since the clip sits directly under the
feature's heading), then `./record.sh <name>`.
