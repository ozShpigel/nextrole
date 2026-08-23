---
name: stale-disclosure-pattern-duplication
description: ActivePage.tsx and ApplicationList.tsx each hand-roll an identical details/summary "stale items" disclosure — watch for drift between them
type: project
---

Two components implement the same collapsible-disclosure UI pattern for
"applications that have gone quiet," independently, with copy-pasted
Tailwind classes:

- `client/src/pages/ActivePage.tsx` — Applied column, `appliedStale`
  group (threshold `APPLIED_STALE_DAYS = 14`, defined at top of file).
- `client/src/components/ApplicationList.tsx` — "No Reply Yet" section,
  `ghosted` group (threshold `GHOST_DAYS`, label "Probably ghosted").

Both use a native `<details className="... group">` /
`<summary className="cursor-pointer list-none inline-flex items-baseline
gap-[...] py-[...] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink-soft)]
transition-colors">` with an `aria-hidden` `▸` glyph that rotates via
`group-open:rotate-90`.

On 2026-08-21/23 the user simplified ActivePage's summary text from
`OLDER · N silent {DAYS}d+` (uppercase label + jargony "silent") down to
plain `{N} more`, because the old copy read as unprofessional. They did
**not** touch ApplicationList.tsx, which still shows `Probably ghosted ·
{N} silent {GHOST_DAYS}d+` — so the two now have visibly different tones
for what is conceptually the same "gone quiet, folded away" affordance.

**Why:** confirms the "unprofessional/jargony" objection was about the
*wording*, not the disclosure pattern itself — ApplicationList's copy
wasn't flagged, possibly just not noticed yet, or the "Probably ghosted"
framing there is intentionally kept (it's a section label, not a
factoid line, and doesn't use ALL-CAPS tracking).

**How to apply:** if the user later asks to touch either file's stale/
ghost disclosure again, check the other one too and ask whether they
want the wording made consistent, rather than assuming the first edit
was the final word on tone for both. If a future extraction of a shared
`<StaleDisclosure>` component ever comes up, this is the pairing to
consolidate.
