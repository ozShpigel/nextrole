# Plan: boards, not companies -- `boards.json`, and everything per board on the board key

Status: **built and verified in production** (2026-09-28; the deploy needed #131, see below). Phase 3 of docs/plans/multi-source-ingest.md.
Phases 1 and 2 are built and verified in production.

## Why

After phase 2 the stored jobs are keyed `(boardKey, sourceJobId)`, but
everything *around* a job still says "Greenhouse token":

| Where | Today | Problem with a second source |
|---|---|---|
| `config/companies.json` | a list of Greenhouse tokens + `company_domains` | no way to say which source a board is on, or give Workday its host/tenant/site |
| `IJobSource.ListAsync(string boardToken)` | a bare token | Workday needs more than a token |
| Queue message `CompanyMessage` | `boardToken` | the consumer cannot tell `greenhouse:nvidia` from `workday:nvidia` |
| Run ledger `greenhouse_runs` | unique `(day, boardToken)` | two boards with one token collide |
| `RemovedBoards` | open counts grouped by `boardToken` | a Workday board would look "removed" from a Greenhouse list |
| Logo | `company_domains[token]` | per token, not per board |

Read-only for everything outside the ingest: the API never reads this file or
the ledger (checked: `greenhouse_runs` is read only by `RunLedger` and
`DemandTriggers`, and the triggers count by run id, not by board).

## The file

```json
{
  "boards": [
    { "source": "greenhouse", "token": "wizinc", "domain": "wiz.io" },
    { "source": "greenhouse", "token": "similarweb", "domain": "similarweb.com" }
  ],
  "served_locations": [ ... ],
  "embed_batch_token_budget": 100000,
  "max_batch_items": 128
}
```

- A board is `{ source, token, domain?, name? }`. `name` is optional and unused by
  Greenhouse (the board returns `company_name`); Workday will need it, because
  its postings carry a legal-entity name.
- **Fatal at load, as every config mistake is today:** an unknown `source`; a
  token that breaks that source's rule (Greenhouse: letters, digits, `-`, `_`);
  two boards with one `boardKey`; one domain on two boards (#125, unchanged).
- **The old shape still loads.** A file with `companies` + `company_domains` is
  read as Greenhouse boards, so a path set explicitly to the old file keeps
  working. A file with both `boards` and `companies` is fatal: two lists
  that can disagree.
- Renamed to `config/boards.json` (and `boards.dev.json` for local runs); the
  default path follows. `Boards__ConfigPath` is the setting, `Companies__ConfigPath`
  still honoured.

**One thing to check on the box before merging:** `deploy/.env.example` says
`Companies__ConfigPath` is left at its default there. If the box's
`.env.greenhouse` sets it to `/app/config/companies.json` explicitly, the renamed
image no longer has that file and the ingest refuses to start (loudly, nothing
touched). One read-only command settles it:
`grep -c ConfigPath /srv/nextrole/.env.greenhouse` -- `0` means safe.

## Code

- `BoardConfig` record: `Source`, `Token`, `Domain?`, `Name?`, `Key` (`source:token`).
- `IJobSource.ListAsync(BoardConfig board, ...)`, `DetailAsync(BoardConfig board, ...)`.
- `BoardHandler.HandleBoardAsync(BoardConfig board)`, picking the source from a
  registry by `board.Source`. Today the registry holds one source.
- Logo from `board.Domain`.
- **Queue message** gains `boardKey`; `boardToken` is still written for one
  release. The consumer looks the board up in the config by key. A message with
  only a token (published before the deploy, or replayed from the dead-letter
  queue) is read as `greenhouse:<token>`. A key no longer in the config (removed
  between publish and consume) is logged and acknowledged, not retried forever.
- **Run ledger** keyed `(day, boardKey)`:
  - on startup (publisher and consumer both run it), rows without `boardKey`
    get `greenhouse:<token>`, like 2a;
  - new unique index `uniq_day_boardkey`, **partial** on `boardKey` existing,
    so a row an old process writes mid-deploy cannot collide on a missing field;
  - rows carried `boardToken` too until 2c, which dropped the old
    `uniq_day_board` index with the old job indexes.
- **`RemovedBoards`** compares the config's board keys with open postings
  grouped by `boardKey`, and closes by board key. Its guard (refuse to close
  more than half the open pool at once) is unchanged.
- Log lines keep saying `Board wizinc`; the key appears where it disambiguates
  (the removed-boards line, ledger errors).

One release: every step reads the old shape as well as the new, and the only
data change is a startup backfill of a small operational collection.

## Tests

- Config: the new shape; the old shape as Greenhouse boards; both at once is
  fatal; unknown source; duplicate key; the shipped `boards.json` and
  `boards.dev.json` both load (as `companies*.json` do today).
- Message: a token-only message resolves to the Greenhouse board, the key wins
  over the token, a message naming no board has no key (`CompanyMessageTests`).
  The consumer's own ack-and-ledger path for an unknown key is **not**
  unit-tested: it is bound to a RabbitMQ channel. It is checked on the box.
- `RemovedBoards`: grouped and closed by key; a board on another source with the
  same token is not "removed".
- Ledger, against the disposable Mongo: old rows backfilled, a second pass fills
  nothing, the partial index builds with an unkeyed row present.

## Verify after deploy

- `publish` publishes 26 and exits 0; the removed-boards step logs nothing.
- The run looks like today's: mostly `unchanged`, ~0 `to embed`.
- `greenhouse_runs` for the day: 26 rows with `boardKey`, all `done`
  (a read-only check added to `deploy/mongo/`).

## Decisions (2026-09-28)

1. **Renamed to `boards.json`**; the old shape and the old setting keep loading.
2. **`boardToken` was still written** on queue messages and ledger rows until 2c,
   so every step stayed reversible by code alone, as in phase 2.

## What the deploy missed (#131)

The ingest's own `appsettings.json` still set `Companies:ConfigPath` to
`companies.json`. That setting is honoured as a fallback and outranks the new
default, so after the rename the publisher and the consumer refused to start --
loudly, nothing written. The box check above looked only at `.env.greenhouse`,
and the shipped-file tests loaded `boards.json` by name. Fixed by pointing the
setting at `boards.json` and adding a test that resolves the path the way the
process does (`BoardsConfig.PathFrom`, from the shipped appsettings).

## Limit until 2c (resolved by 2c)

The ledger keeps the old `uniq_day_board` index, so two boards sharing a token
on different sources cannot both have a row for one day. Tested
(`RunLedgerIntegrationTests`): the second board never takes over the first's
row, and after the index is dropped each has its own. 2c drops it before the
first non-Greenhouse source.
