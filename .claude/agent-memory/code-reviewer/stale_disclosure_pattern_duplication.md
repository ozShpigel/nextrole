---
name: stale-disclosure-pattern-duplication
description: ActivePage.tsx and ApplicationList.tsx each hand-roll a "stale/closed items" disclosure for the same underlying concept — divergence has grown from wording to full markup/visual treatment
type: project
---

Two components implement the same collapsible-disclosure UI concept for
"applications that have gone quiet," independently:

- `client/src/pages/ActivePage.tsx` — Applied column, `appliedStale`
  group (threshold `APPLIED_STALE_DAYS = 14`, top of file, ~line 40).
  As of 2026-09-13 (lines ~351-375): a bordered/rounded box
  (`rounded-lg border ... bg-[var(--ed-panel)]/30`) with an `Archive`
  lucide icon in a small square swatch, label "Archived", count "{N}
  archived", and a `ChevronDown` that rotates via `group-open:rotate-180`.
- `client/src/components/ApplicationList.tsx` — "No Reply Yet" section,
  `ghosted` group (threshold `GHOST_DAYS = 30`, ~line 37) plus a second,
  separate "The Archive" disclosure for closed processes (~line 324).
  Both still use the original minimal treatment: plain inline
  `<summary className="... inline-flex items-baseline gap-...">` with an
  `aria-hidden` `▸` text glyph rotating via `group-open:rotate-90`, e.g.
  "Probably ghosted · {N} silent {GHOST_DAYS}d+" / "The Archive · {N}
  closed".

Originally (2026-08-21/23) this was only a wording difference (ActivePage
simplified `OLDER · N silent {DAYS}d+` to plain `{N} more` for tone).
By 2026-09-13, ActivePage's version has diverged structurally too — a
bordered card + icon swatch + `ChevronDown`/rotate-180, vs.
ApplicationList's plain inline `▸`/rotate-90 — so a shared
`<StaleDisclosure>` extraction now has two genuinely different target
designs, not just two copies of one design with different labels.

**Why:** each edit to one of these files has, twice now, left the other
untouched — suggests they're not being thought of as the same component
by whoever touches them, even though the underlying "fold away what's
gone quiet" affordance is identical.

**How to apply:** if either file's disclosure is touched again, check
the other one and ask whether the divergence is intentional (ActivePage
is a kanban card list, ApplicationList is a dense table — different
visual weight may genuinely be warranted there) before assuming
consolidation is still the goal. Don't assume the 2026-08-23 memory's
"just wording" framing still holds — verify current markup, it moves.
