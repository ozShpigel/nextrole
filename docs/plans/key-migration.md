# Plan: the stored key, from `(boardToken, greenhouseJobId)` to `(boardKey, sourceJobId)`

Status: **2a, 2b and 2c built and verified in production** (2026-09-28). Phase 2 of docs/plans/multi-source-ingest.md.

## Why

Every row in `greenhouse_jobs` is identified by `(boardToken, greenhouseJobId: long)`
under the unique index `uniq_board_job`. Workday, Lever, Ashby and Comeet ids are
strings, and a board token alone does not say which source it belongs to. Phase 1
already made ids strings in the source contract; the handler converts them back
to a long only because the store still needs one.

## What is and is not affected

Measured by reading every use of the key:

| Where | Uses the key? |
|---|---|
| `JobStore` (every per-job and per-board query, the upsert, the close diff) | **yes** -- the whole change |
| `ai_batches` records (`jobIds`, longs) and `IngestBatcher` | **yes** -- an open batch spans the switch |
| `ai_pending_*` markers on job rows | no -- they hold a batch id, found through the key |
| The API (`GreenhouseJobRepository`, `PoolScanService`, `jobScores`) | **no** -- it refers to a posting by Mongo `_id` only |
| `greenhouse_runs` ledger, queue messages, `RemovedBoards` | no -- per board, not per job; they move to `boardKey` in phase 3 |

So nothing user-facing reads the key: no score, saved job or dismissal can be
orphaned by it.

## The new fields

| Field | Value for every existing row | Example |
|---|---|---|
| `boardKey` | `"greenhouse:" + boardToken` | `greenhouse:wizinc` |
| `sourceJobId` | `greenhouseJobId` as a decimal string | `"7184512"` |
| `source` | already written as `"greenhouse"` since the source began | -- |

New unique index `uniq_boardkey_job` on `(boardKey, sourceJobId)`, and
`idx_boardkey_open` on `(boardKey, closedAt)` replacing `idx_board_open`.

Existing rows are never otherwise rewritten: no content, vector, facts or date moves.

## Three releases, each verifiable before the next

### 2a -- expand (no read changes)

- Every upsert also writes `boardKey` and `sourceJobId`.
- On consumer startup, before consuming, one idempotent `updateMany` fills
  the two fields on rows that lack them, then creates the new indexes. It logs
  how many rows it filled. On the second start it fills 0.
- Reads, filters and the upsert match still use the old key. The old index stays.

**If the backfill or the index build fails, the consumer does not start** (it
crash-loops loudly, touching nothing), rather than consuming with half a key.

**Verify on the box before 2b** (all read-only):

```js
db.greenhouse_jobs.countDocuments({ boardKey: { $exists: false } })          // 0
db.greenhouse_jobs.countDocuments({ sourceJobId: { $not: /^[0-9]+$/ } })     // 0
db.greenhouse_jobs.countDocuments({})                                        // N
db.greenhouse_jobs.aggregate([{ $group: { _id: { k: "$boardKey", j: "$sourceJobId" } } }, { $count: "n" }])  // N
db.greenhouse_jobs.getIndexes()   // uniq_boardkey_job present, unique
```

Undo: `$unset` the two fields and drop the two new indexes. Nothing reads them yet.

### 2b -- switch

- `GreenhouseJob`, `IJobStore`, `JobStore` and `IngestBatcher` key on
  `(boardKey, sourceJobId: string)`. The handler's long conversion and its
  "not a number" drop go away: a string id is stored as it is.
- Greenhouse rows keep writing `boardToken` and `greenhouseJobId` too, so the
  old unique index still holds and 2b can be reverted by code alone.
- **Batches in flight across the deploy:** `ai_batches.jobIds` is read as either
  longs (written before 2b) or strings (after), both mapped to the string id;
  new records are written with strings. A batch submitted before the deploy
  and collected after it lands on the same rows.
- Per-board filters (`StoredHashes`, the close diff, the backfill selectors)
  move to `boardKey`. The ledger and queue stay on the token until phase 3.

**Verify:** a triggered run, as for phase 1:
- every board mostly `unchanged` and `0 to embed`. A key mismatch shows up as
  every posting treated as new, which would then fail loudly on the old unique
  index rather than duplicate.
- `countDocuments({})` unchanged.
- any open batch from before the deploy is collected (`ai_batches`, status).

### 2c -- drop the old index (built 2026-09-28, before the first non-Greenhouse source)

`uniq_board_job` and `idx_board_open` are dropped. They must go before phase 5:
a Workday row has no `greenhouseJobId`, and two of them on one board would
collide on `(boardToken, null)`. Until then they are a free extra guard, so they
stay.

The run ledger's old `uniq_day_board` goes with them (added by phase 3,
docs/plans/board-config.md): until it does, two boards sharing a token on
different sources cannot both have a row for the same day. The same release
stops writing `boardToken` on queue messages and ledger rows.

As built:

- The drops run on startup, in every database the ingest runs against
  (`LegacyIndexes.DropIfPresentAsync`): an already-gone index is the expected
  case, and a failed drop is logged, never fatal -- it only matters once a
  second source is added, and then it fails loudly on its own.
- The 2a backfill is removed with them. Its job was done (1,187 of 1,187 rows
  keyed, verified on the box), and its check -- every `sourceJobId` all digits --
  would have refused to start the consumer at the first Workday id.
- New rows no longer write `greenhouseJobId`; old rows keep it, read by nothing.
  Rows keep `boardToken`: it is a plain fact about the posting.
- Readers still accept the old shapes at no cost: a token-only queue message
  (a dead-letter replay), a batch record with numeric ids.

## Tests

- `JobStore` has no test against a real Mongo today, and it is where the change
  lives. Add an integration test, opt-in (`GREENHOUSE_KEYS_IT_MONGO`), against
  a scratch database **confirmed not to exist first**:
  - the backfill fills old-shaped rows exactly and a second pass fills 0;
  - an upsert after the backfill matches the existing row, and inserts no second row;
  - the close diff and `StoredHashesAsync` see the same rows under the new key.
- Unit: the batch record reads both id shapes; the handler stores a non-numeric
  id (the case phase 1 had to drop).

## Decisions (2026-09-28)

1. **The backfill runs at consumer startup**, not as a command run by hand:
   idempotent, a few thousand rows, and no deploy in which the code can run
   ahead of the data.
2. **2a and 2b ship separately**, so the backfill is verified by counts in
   production before any code depends on it.

The integration tests (`KeyBackfillIntegrationTests`) run against a throwaway
`mongo:7` container; how is in the test file's header.
