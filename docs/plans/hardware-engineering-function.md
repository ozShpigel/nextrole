# Plan: a `hardware_engineering` kind of work

Status: **built and deployed** (2026-09-28; KLA verified). Decided: as recommended, except the relabel -- Workday postings only (below). Facts version 3 followed the same day -- see "What the first deploy got wrong".

## Why

`JobFunctions` -- the fixed list of kinds of work the filters match on -- has no
category for hardware engineering. The facts prompt must pick from the list, so
it files mechanical, electrical, optics, process and integration roles under the
nearest software label. Measured on KLA's Israel site, the first Workday board
(`deploy/mongo/diagnose-board.js`, 2026-09-28):

| Title | Labelled |
|---|---|
| Mechanical Design Engineer, NPI Mechanical Engineer | `software_engineering` |
| Physicist - Electro Optics Engineer, Electronics Engineer | `software_engineering` |
| X-ray Integration Engineer, System HW Computer Engineer | `infrastructure` |
| Optical lab technician, Incoming Inspection | `qa` |

48 of KLA's 63 postings pass a software/infrastructure profile's filter; about
5-8 are software. The 26 Greenhouse boards are software companies, so it never
showed. NVIDIA (467 postings) and the next Workday companies -- Applied
Materials, Intel -- are hardware-heavy.

The cost is not the ranking (the vector search correctly places a mechanical
role far from a DevOps CV) but eligibility: a mislabelled role passes the
filters, takes a place in the candidate set, and costs an Evaluator call for a
certain "No" when a user reaches it. For a hardware engineer the opposite: no
label to match, so the filter cannot select their roles at all.

The Matches page stays ranked-only (decided 2026-09-28): this changes what is
eligible for the ranked list, not how much of the pool a user can see.

## The change

### 1. The list and its neighbours (`JobFunctions`)

- Add `hardware_engineering`: mechanical, electrical and electronics, optics and
  photonics, RF, chip design and verification (ASIC, FPGA, VLSI, layout),
  process and manufacturing engineering, integration and test of physical
  systems, and the lab technicians who support them.
- **Neighbours: none**, in either direction. A software or infrastructure
  profile does not accept it -- which is the whole point -- and a hardware
  profile accepts only hardware. A role that is both (embedded software,
  firmware, drivers) is labelled with both (a posting may carry two), so it
  reaches both.

### 2. The two prompts (`PromptSeeds`)

- **job-facts**: the new value in the list, with one line on the boundary --
  writing software, even for hardware, is `software_engineering`; embedded and
  firmware carry both; a role that designs, builds, integrates or tests the
  physical product is `hardware_engineering`.
- **CV normalisation**: the same value, so a hardware engineer's profile can
  hold it. Existing profiles are unchanged until they are next saved; a software
  profile never gains it.

Neither prompt has a code check that the boundary is drawn right -- there is no
exact one (AGENTS.md: a prompt rule with no check behind it). Recorded as
knowingly unchecked; measured instead (below).

### 3. Relabel what is stored: a facts version, Workday only

Postings read before this change keep their wrong labels until their facts are
read again. The existing facts re-read cannot select them: it looks for a
missing field (`must_have_groups`, `functions`), and it stops at
`extract_attempts < 3`, which rows already re-read once have used up.

- Store `facts_version` with every facts read (the prompt's version, like
  `parsed_with` for the parse).
- The re-read selector also takes open postings whose `facts_version` is
  missing or older. Its attempts ceiling applies only to the old
  missing-field reason: a version bump is a deliberate re-read, once per
  posting, and writing the version on every attempt -- facts or none --
  is what stops it repeating.
- It drains through the existing path: at most 100 per board per run, through
  the Batch API at half price. A board of 400 takes four daily runs.
- **Scoped by source, not by title** (`JobStore.FactsReReadSources`: Workday).
  Decided 2026-09-28 to avoid re-reading ~1,200 Greenhouse postings (~$2): those
  are software companies, a changed posting is read with the new prompt anyway,
  and everything Matches can show turns over within its 90-day window. Deleting
  and re-ingesting was considered and rejected: the same facts read, plus a
  re-embedding, and orphaned scores and saved jobs.

**Cost, estimated:** KLA's 63 plus NVIDIA's, about 530 postings, at roughly
$0.0015 per batched facts read (Haiku, ~2K tokens in, ~200 out): **about
$0.50-0.80 once**. Measured on the first runs by the batch lines.

Why by source and not by title: selecting "probably hardware" postings by title
words is exactly the weak proxy AGENTS.md warns against. The source is exact.

### Not in this change

- **Title rules in the pre-read filter** (skip "Mechanical Engineer" before any
  read when nobody wants hardware). Worth doing for NVIDIA, but its check
  (`CheckGuessesAsync`: "would hide a wanted posting") compares guesses to
  Claude's labels -- which need the new label first. A follow-up, measured.
- The Evaluator: unchanged. It never sees the label.

## Tests

- `JobFunctions`: the new value normalises; it is nobody's neighbour and has
  none; a posting labelled software + hardware passes a software profile and a
  hardware profile; hardware-only passes neither software nor infrastructure.
- Facts version: a read writes it; the selector takes a missing or older
  version regardless of attempts, and not a current one; a read that returns no
  facts still writes it (no loop).
- Prompts: every `JobFunctions.All` value is in both prompts' `functions`
  lists -- the list itself, not a mention elsewhere in the prompt (a test, so
  the lists cannot drift apart).

## Verify after deploy

- The batch lines show the re-read draining: `(… re-read)` counts per board.
- `diagnose-board.js` on KLA after its re-read: the mechanical, optics and
  integration roles labelled `hardware_engineering`; "Senior Software Engineer",
  "Software Developer", "R&D Software Engineer" and the algorithm roles still
  `software_engineering`. **That list is the acceptance check:** if a real
  software role lost its label, the boundary line in the prompt is wrong.
- The pool-wide eligible count for a DevOps profile drops (158 today).

## What the first deploy got wrong

- **The version was stamped at collect time.** A facts batch NVIDIA submitted
  under the old prompt was collected by the new code, which stamped
  `facts_version` 2 on 200 postings' old labels -- marking them current, so
  never re-read. Fixed: the version is recorded on the batch at *submit*
  (`AiBatchRecord.FactsVersion`, as `ParseVersion` is); a batch with none
  stamps nothing; only postings a read was sent for are stamped.
- **Physical inspection went to `qa`.** On KLA, "Incoming Inspection",
  "Process Engineer" and "Customer Acceptance Engineer" -- qa is a neighbour of
  software, so they stayed eligible. The facts prompt now says: inspecting,
  validating, characterising or accepting physical parts, boards, chips or
  machines is hardware, not qa.
- Both are **facts version 3**: every Workday posting is re-read once more
  (KLA's 63 again, a few cents), which also repairs the 200 without editing the
  database by hand. NVIDIA's run had also failed that day on a stub listing
  entry (docs/plans/workday-adapter.md), so its re-read had not started.

## Decisions (2026-09-28)

1. **Name and scope** as above, including chip design and lab technicians.
2. **No neighbours**; embedded work carries two labels.
3. **Re-read Workday postings once** (~$0.50-0.80); Greenhouse ages out.
