# Plan: the pre-read filter in two stages -- before and after the detail

Status: **built and verified in production** (2026-09-28; every board `0 after the detail`). Phase 4 of docs/plans/multi-source-ingest.md.
Phases 1-3 are built and verified in production. Decided: stage 2 applies the whole rule.

## Why

`BoardHandler` today reads every posting in full (`DetailAsync`, unless the
listing already carried the detail), hashes it, and only then asks the
pre-read filter whether a *new* posting is worth paying for.

For Greenhouse that order costs nothing: one call returns every posting with its
body, so `DetailAsync` is never called. For Workday it is the expensive part.
Its listing has a title, a location text and a fuzzy age ("Posted 30+ Days
Ago"); the body, the exact date and the full location list are one request per
posting. NVIDIA's Israel site alone is ~425 postings, most of which the filter
would then skip -- so the order has to be: decide what can be decided from the
listing, fetch the rest, decide again.

## The flow

```
listing
  -> stage 1  (new postings only, the LISTING's data)       ... skipped: no detail request
  -> detail   (everything stage 1 kept, and every stored posting, as today)
  -> hash skip
  -> stage 2  (new postings only, the DETAIL's data)         ... skipped: no embedding, no read
  -> embed, store, reads, close diff   (unchanged)
```

- **Stage 1** is today's rule (`Prefilter.Decide`) on the listing's
  `ListedPosting`. A rule with nothing to go on passes, as it already does: no
  date is read, a location that resolves to nothing is read. So a Workday
  posting with no exact date and "3 Locations" always passes stage 1.
- **Stage 2** is the same rule again, on the detail's `ListedPosting` -- which now
  has the exact posting date and the full location list. It catches what stage 1
  could not see. The plan named only the age rule for stage 2; applying the whole
  rule is the same code and strictly more accurate, never less: stage 2 only ever
  sees postings stage 1 kept.
- **Only new postings are ever filtered**, at either stage, exactly as today. A
  stored posting was already paid for; skipping it would stop its presence touch
  and leave it to the close diff.
- **Closing is unaffected.** Stage-1 skips are still in the listing, so the close
  diff sees them; they were never stored, so there is nothing to close.
- `Greenhouse:Prefilter` modes are unchanged: `log` decides and logs at both
  stages and skips nothing -- including no detail request skipped.
- The demand reads (wanted functions, learned locations) happen once per board
  run and serve both stages.
- The check lines (`CheckGuessesAsync`, the location check) run on stored
  postings from the listing's data, as today.
- One log line per board, as today, with each stage's count:
  `pre-read filter (On) -- 91 of 91 new posting(s) skipped (91 from the listing, 0 after the detail): ...`

**For Greenhouse this changes nothing.** The detail is the listing, so stage 2
sees exactly what stage 1 saw and decides the same; every count and every
stored row is identical. A test pins that.

**Not in this phase:** detail requests are sequential. Bounded concurrency and
politeness per source (`SourceLimits`) come with the Workday adapter, the first
source that makes detail requests at all. Also not here: whether a *stored*
Workday posting is re-read daily -- the Workday plan's "present in the list =
unchanged" trade belongs to that adapter.

## Tests

Driven through a fake source whose listing carries no detail:

- a posting stage 1 skips gets no detail request (`DetailCalls`);
- a posting whose listing has no date but whose detail is older than the limit
  is fetched, then skipped at stage 2: not stored, not embedded;
- `log` mode requests every detail and skips nothing;
- a stored posting stage 1 would skip is still read and touched;
- the Greenhouse path: the same board run gives the same counts as before.

## Verify after deploy

The run looks exactly like the last one: the same `prefiltered` counts per
board, mostly `unchanged`, ~0 `to embed`.
