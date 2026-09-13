---
name: effect-guard-resets-on-failure
description: A useState-based effect guard that resets to its pre-call value in a .finally() on failure re-arms the effect and auto-retries an AI-billed mutation with no user action — confirmed in ApplicationDetailPage's useHebrewDisplay, 2026-09-13
type: feedback
---

Found a variant of the codebase's known "mutation-in-effect" bug class that
isn't StrictMode-related at all: `client/src/pages/ApplicationDetailPage.tsx`
(`useHebrewDisplay`, ~line 265-290) guards a Claude-billed translate call with
`useState` flags (`hebrew`, `translating`) checked in the effect's own
condition, dependency-array included:

```js
useEffect(() => {
  if (lang !== 'he' || !english || hebrew || translating) return;
  setTranslating(true);
  translate().then(setHebrew).catch(e => alert(...)).finally(() => setTranslating(false));
}, [lang, english, hebrew, translating]);
```

On success, `hebrew` becomes truthy and blocks re-entry permanently — fine.
On **failure**, `hebrew` stays null and `finally` resets `translating` to
false, which is a dependency, so the effect re-runs, re-passes the guard, and
re-fires the mutation automatically. No StrictMode, no double-mount, no user
click required for the second attempt — just the state settling. `alert()`
being synchronous throttles the loop to "one extra billed call per dialog
dismissal," but it's still an unbounded automatic retry of a billed AI call
on a transient failure (and this page never calls `useDemoMode()`, so it
loops on the public demo's 403 too).

**Why this matters beyond this one call site:** the codebase's documented
ref-guard rule (AGENTS.md, `client/IMPLEMENTATION.md:59`) frames the danger
as StrictMode's double-invoke-on-mount. That framing doesn't cover this
shape: *any* effect whose own state guard is reset by the async call's own
failure path can retry itself indefinitely, independent of StrictMode. A
`useRef` guard set before the call and never cleared on failure closes both
holes at once; converting to a `useQuery` with `retry: false` does too (and
is the pattern already used for `usePoolScan` for the identical class of
problem).

**How to apply:** when auditing an effect-driven mutation, don't stop at "is
there a ref guard for StrictMode" — trace what the `catch`/`finally` does to
the guard state. If failure resets a dependency the effect's own condition
reads, it can self-retry with no user action.
