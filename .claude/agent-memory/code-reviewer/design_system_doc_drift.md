---
name: design-system-doc-drift
description: docs/design-system.md and AGENTS.md's UI rules no longer fully match the shipped client code — specific known gaps, verified 2026-09-13
type: project
---

Two checked-in docs describe the client's design system as more
consistent with itself than the shipped code actually is. Confirmed via
full grep/read of `client/src` on 2026-09-13 (standing-code review, not a
diff):

1. **`STATUS_TONE` doesn't exist.** `docs/design-system.md` says
   "application statuses → `STATUS_TONE` in `components/Status.tsx` (also
   drives the Statistics breakdown bars)". Grep for `STATUS_TONE` across
   `client/src` returns nothing. The actual `Status.tsx` renders every
   status as the same neutral bordered pill (one exception: a solid
   "Accepted" badge) — a deliberate simplification per its own comment
   ("Status is informational, not the row's hero metric... every pipeline
   stage renders as the same neutral bordered pill so it never competes
   with the score"). This is *more* compliant with the "score ramp never
   for status" rule than the doc's own description, just not what the doc
   says is there.

2. **"Two font weights (400, 500)" is aspirational, not descriptive.**
   `font-semibold`/`font-bold`/`font-black` appear across nearly every
   editorial page (InterviewInsightsPage, ManualScorePage,
   InterviewPrepPage, MockInterviewPage, ResumePackPage, SettingsPage,
   ChipInput, CategoryToggleChips, QaCardGrid, NotFoundPage, Dashboard,
   App.tsx's nav wordmark — this list is representative, not exhaustive).
   Arbitrary type sizes well outside the stated 40/16/13 scale
   (`text-[0.62rem]` … `text-[clamp(2.4rem,6vw,4rem)]`) are equally
   pervasive. Given the breadth, this reads as a rule that predates the
   current "Forest Ledger" visual language (the doc's own history note:
   "originally a Glassdoor-inspired refresh... since pushed further into
   a starker noir palette") and was never updated to match, rather than
   isolated slips worth fixing file-by-file.

3. **`nginx.conf`'s Render-era comments are stale.** Comments about
   "Render free-tier cold starts" on the `/api/discovery` and
   `/api/discovery/health` locations predate the move off Render to a
   single Hetzner VPS (see `render-deployment-layout` memory,
   2026-08-17). No client code calls `/api/discovery/health` any more
   either (grepped `client/src`, zero hits) — the warm-up probe route is
   plumbing with no caller.

**Why:** these docs are read as ground truth ("Read AGENTS.md /
design-system.md first") by both humans and agents starting work in this
area — trusting them at face value on these three points will send a
future task down the wrong path (hunting for a `STATUS_TONE` map that
isn't there, treating a two-weight rule as a real constraint when
enforcing it would touch dozens of files, or preserving Render-specific
proxy behavior post-migration).

**How to apply:** when a task depends on one of these three claims,
verify against the current code first rather than the doc. If ever
asked to reconcile docs with reality, this is the checklist to start
from — plus the already-known `render-deployment-layout` drift.
