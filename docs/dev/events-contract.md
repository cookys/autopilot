# Events contract: `autopilot status events` and schema `autopilot.events/1`

> **Telemetry projection, not attestation.** The feed restates what autopilot's existing stores already hold. It is
> plain telemetry derived from sources it cannot influence: not a ledger, not signed, no hash chain, no witness. A
> consumer must not treat it as proof (ADR-0001, `docs/adr/0001-verification-over-attestation.md`).
> The command is read-only, makes no model call and never writes a source store.

This document is the contract. The machine-readable shape is `schemas/events.schema.json`
(registry keys `events_contract_doc` and `events_schema` in `scripts/lib/repo-layout.js`). Plan:
`docs/plans/2026-11-02-oc-a1-events-contract.md`. Status of the phases: this document and the schema are phase E1; the
readers (E2), merge and cursor (E3) and the CLI wiring (E4) implement what is written here.

## The command

```
autopilot status events [--since <cursor|ISO-8601|0>] [--limit N] [--kinds k1,k2,...] [--project <project_key>]
                        [--review-ledger <dir>]... [--json]
```

- `--since` omitted or `0`: from the beginning of what the sources still hold, in pages of `--limit` (default 1000, max 10 000).
- `--since <ISO-8601>`: first call by wall time (events with `ts >=` it). `-` reads the cursor from stdin (one line). Any other value is a cursor; one that does not decode or has an unknown `v` exits 2 with `bad_cursor`.
- `--project <project_key>`: optional; must equal the key of `cwd`'s own repo, any other key exits 2. Events of other repos are never returned; host-wide sources (costs file, manifests dir) are filtered to the project.
- `--json` prints one JSON object (the envelope). Without it a compact table (kind, ts, id prefix, one-line summary) and a `next cursor:` line; warnings go to stderr.
- Exit codes are 0 and 2 only. Exit 2 is a usage, `bad_cursor` or `project_unresolved` error; under `--json` it prints the error object `{"schema":"autopilot.events/1","error":{"code":...}}`, the second top-level shape of the schema. A source problem is never an exit code: it is a warning.
- An absent default decision ledger or dispatch runs dir is state `absent` with no warning (a fresh repo is normal).

## Envelope

```json
{
  "schema": "autopilot.events/1",
  "generated_at": "2026-11-02T08:00:00.000Z",
  "project": { "project_key": "<16 hex>", "repo_name": "<basename of the repo root>" },
  "events": [],
  "cursor": "<opaque>",
  "has_more": false,
  "sources": [ { "name": "cost", "state": "ok|absent|degraded", "rows_read": 0, "rows_skipped": 0, "rows_filtered": 0, "redactions": 0 } ],
  "warnings": [ { "source": "cost", "code": "source_absent", "detail": "<short; basenames only>", "count": 1 } ]
}
```

| field | type | meaning |
|---|---|---|
| `schema` | string, const `autopilot.events/1` | consumers pin this value |
| `generated_at` | UTC `.sssZ` string | data age of this page |
| `project.project_key` | 16 hex | `sha256(repo_identity)[0:16]`, as `src/status/project-key.js` computes it |
| `project.repo_name` | string | basename of the repo root |
| `events` | array | the page, ascending by `(ts, id)` |
| `cursor` | string | opaque, pass it back verbatim as `--since` |
| `has_more` | boolean | more events are available after this page |
| `sources[]` | `name`, `state` (`ok`, `absent`, `degraded`), `rows_read`, `rows_skipped`, `rows_filtered`, `redactions` | one entry per reader |
| `warnings[]` | `source`, `code`, `detail`, `count` | aggregated per source and code; `detail` carries basenames only, never a path |

Warning codes defined today (an open set): `source_absent`, `line_unparseable`, `file_unreadable`, `line_too_long`,
`schema_mismatch`, `ts_invalid`, `cursor_hint_stale`, `window_overflow`, `git_unavailable`, `source_failed`,
`duplicate_id`, `internal_error`, `findings_missing` (a review chain entry whose `g<N>/findings.json` does not exist; the event is kept without `findings_total`), `status_state_conflict` (a `run.stage` row carrying both `status` and `state` with different values; `status` wins). A configured source that is absent gives one aggregated `source_absent` warning
(state `absent`); an absent optional discovery candidate (a rotated `.N` segment, a manifest-named ledger that was
reaped, an unset env list) gives no warning; an empty file gives state `ok` and no warning; every other problem gives
one aggregated warning naming source and code.

## Project and failure rules

1. The project is resolved with `scopeFromCwd`. If `cwd` is outside a git repo, git is not on `PATH`, or resolution fails, the command exits **2** with code `project_unresolved` (stderr line; with `--json` stdout is `{"schema":"autopilot.events/1","error":{"code":"project_unresolved"}}`). There is no project to report on, which is an environment error, not a source problem, so `project_key` stays a required non-null string in the envelope.
2. A source problem is exit 0 with a warning.
3. A failure outside the per-reader try/catch (merge, cursor encode/decode of a valid cursor, envelope build) is caught by one top-level catch: exit **0**, `events: []`, `has_more: false`, the **input cursor returned unchanged** (so a consumer retries from the same place and loses nothing), every source `degraded`, one warning `internal_error` (error name only, no stack or path). The command never ends in Node's uncaught-exception exit 1.

## Event

```json
{ "id": "<kind>:<stable key>", "kind": "<kind>", "ts": "2026-11-02T08:00:00.000Z", "ts_basis": "source|mtime",
  "source": "dispatch_manifest|costs|review_ledger|git_trailer|decision_ledger|run_ledger",
  "project_key": "<16 hex>", "root_run_id": "<id>|null", "run_id": "<id>|null", "data": {} }
```

- **`ts`** is UTC with millisecond precision (`Z`). `ts_basis` is `source` unless the review reader had to fall back to a file mtime (`mtime`).
- **Timestamp grammar** (`src/status/events/instant.js:parseInstant`, one function for every source): an RFC 3339 instant `YYYY-MM-DDTHH:MM:SS[.f{1,9}](Z|+HH:MM|-HH:MM)`, second or finer precision, with the calendar fields surviving a UTC round trip (`02-30` and `24:00` are rejected), normalised to UTC `.sssZ` (sub-millisecond digits truncated). Lenient `Date.parse` forms ("Nov 2", a space separator, a date only, epoch numbers) are rejected. A timestamp outside the grammar drops that event with warning `ts_invalid`; the feed never invents a time.
- **`id`** is `<kind>:` plus a key derived only from record content, never from file position, mtime or read order. The same record read from a live file or from `.1` after rotation has the same id.
- **Order**: ascending by `ts`, ties by `id` (bytewise). Total and deterministic.
- **`root_run_id` / `run_id`** are filled when the record carries them, else `null`; never derived.
- **Open sets**: `kind`, `source`, `warnings[].code` and `row_kind` are plain strings in the schema; the lists in this document are the values defined today. A consumer skips an unknown `kind` and tolerates an unknown code, source or `row_kind`. Adding a kind, code or optional field is additive under `/1`; removing or retyping one needs `/2`. There is no "/1.1": the pinned string stays `autopilot.events/1`.
- **Optional fields** (marked `?`) are omitted when the source holds no value; a consumer treats absent and `null` alike.
- `repo_identity` (an absolute path) is internal only and never appears in the envelope or in `data`.

Conventions the id rules use: the *raw line* of a JSONL record is the bytes between newlines, excluding the `\n`;
the *canonical row* is the key-sorted compact JSON (`JSON.stringify` of every value, keys sorted at every depth) of the
parsed row; ordinals `n` start at 1.

## The 8 kinds

This table is the contract; `data` lists every field. `?` = may be null or absent; free text is length-capped.

| kind | source and reader | `id` key | `data` fields |
|---|---|---|---|
| `dispatch.started` | manifest `<runsDir>/<safe_id>.manifest.json`, written by `scripts/dispatch-hetero.sh:write_manifest` (and the review dispatchers); dir from `scripts/lib/runtime-paths.js:runsDir`. `ts` = `started_at`. `source` = `dispatch_manifest` | `run_id` | `run_id`, `role`, `runner`, `model`, `branch`, `base_sha`, `parent_run_id?`, `depth?`, `timeout_seconds?` |
| `dispatch.ended` | same manifest once `ended_at` and `final_status` are set (`manifest_finalize`). `ts` = `ended_at`. A running or dead-pid manifest yields no ended event (liveness is the watcher's job, `scripts/dispatch-status.js`). `source` = `dispatch_manifest` | `run_id` | `run_id`, `final_status`, `duration_s` (`ended_epoch - started_epoch`), `role`, `runner`, `model` |
| `cost.turn` | `costs.jsonl` (all rows of one Stop-hook batch share one `ts`) from `scripts/lib/brain-spend.js:costsFileOf`; rows written by `hooks/cost-tracker.js` (`ts, session, model, sidechain?, agent_id?, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cwd`). Project filter by `cwd` -> `git rev-parse --git-common-dir`, memoised (per distinct cwd, inside one call); a cwd that no longer exists is matched by path prefix against the project's worktree paths (`git worktree list --porcelain` plus manifests' `worktree` fields), so rows of a reaped dispatch worktree stay in the feed (worktree fallback); a cwd matching neither (including cwds of other repos' deleted worktrees, which cost.jsonl holds host-wide) is counted in `sources[].rows_filtered` only, with no warning and no state change, so it cannot fire on every cold read forever. `source` = `costs` | `sha256(raw line)[0:24]` + `#n`, n = ordinal of this line among byte-identical lines **counted from the start of the read**. Identical lines share one `ts`, and a hint (E3) never starts after the first line whose `ts` is inside the resume window, so every identical line a window can emit is read by both hinted and unhinted reads and gets the same n (identical rows stay distinct and stable; sum of `cost_usd` equals the file sum, as `cost-digest.js` computes it) | `session`, `model`, `tier` (`scripts/cost-digest.js:tierOf`), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `sidechain` (bool), `agent_id?` |
| `review.collected` | review ledger dirs `<ledger>/review-<phase>/chain.json` (array written by `scripts/hetero-review-loop.js:saveChainEntryLocked`), one event per chain entry. `ts` = entry `collected_at` (E2 writer), else mtime of `g<N>/findings.json` (`ts_basis:"mtime"`). `source` = `review_ledger` | `<phase_base12>:<phase>:g<generation>`, `phase_base12` = first 12 hex of `sha256(base)` of the lowest-generation chain entry (the phase base, persisted as `phase-<phase>.base`, constant across generations, preserved by an archive copy, and different for two unrelated ledgers that reuse a phase name; the same phase and base is the same review series) | `phase`, `phase_base12`, `generation`, `base`, `head`, `seats` (`[{id,status}]`), `reviewed_seats`, `total_seats`, `findings_total?`, `findings_by_severity?` (both from `g<N>/findings.json`; when that file does not exist the event is **still produced**, without these two fields, and the reader adds one warning `findings_missing`: an event is never dropped for a missing findings file) |
| `review.finalized` | same entry once `status == "finalized"`. `ts` = `finalized_at`, else mtime of the dispositions snapshot. `source` = `review_ledger` | same as `review.collected` | `phase`, `phase_base12`, `generation`, `verdict?` (from `receipt-<phase>.json` when present), `open_findings?` (count), `reviewed_seats`, `total_seats`, `dispositions_sha256` |
| `qc.verdict` | one `git log --format=%H%x1f%cI%x1f%(trailers:key=QC-Verdict,valueonly,separator=%x1e) --branches HEAD` of the project; one event per commit carrying a `QC-Verdict` trailer (the trailer name `scripts/lib/qc-evidence.sh:qc_has_evidence` greps). `ts` = committer date. `source` = `git_trailer` | commit sha | `commit`, `verdict` (trailer value, first line, <= 64 chars; `PASS` is the only value the gate accepts, others are reported verbatim), `subject` (<= 120 chars, redacted), `basis` (`self_reported`: a trailer is text a model can write) |
| `decision.row` | decision ledgers: default `<git-common-dir>/autopilot/ledger/decisions.jsonl` and `<git-common-dir>/autopilot/work-orders/<root>/decision-ledger.jsonl`, rows per the `scripts/decision-ledger.js` header; filter `row.repo_identity == project` (a row without it in the per-repo default file is included, as `decisions-sidecar.js` does). `ts` = row `ts`. `source` = `decision_ledger` | `<decision_id or target_decision_id>:<row_kind>:` + `sha256(canonical row)[0:12]`, or `sha256(canonical row)[0:24]` when neither id exists. Repeated rows with the same `decision_id` and kind but different content/`ts` (`--dedupe` is optional in `decision-ledger.js`) are **distinct events**; byte-identical rows collapse into one (documented under-count) | `basis` (always `self_reported` for every `row_kind`: the ledger has no authenticated writer, `decision-ledger.js append --kind veto\|ladder` succeeds for any caller and its header says "nothing verifies the ledger itself", so who wrote a row is a convention, not an observation; a veto's real effect is enforced by `check-blueprint-conformance.js`, not by this feed), `row_kind` (`decision\|dispatch\|pick\|refreeze\|veto\|note\|hypothesis\|unknown\|ladder`, unknown values kept verbatim), `decision_id?`, `round?`, `class?`, `reversibility?`, `rationale?` (<= 240 chars, redacted, truncation marked), `target_decision_id?` (veto), `rung?`, `result?` (ladder) |
| `run.stage` | run-ledger JSONL(s): paths from manifests' `ledger` field and work-order paths (`src/engine/work-order.js`, `paths.ledger`), read as the rotation-aware set `<p>.N … <p>.1, <p>` (`run-ledger.sh:ledger_scan_files`). Only rows with `kind:"stage"` are events; `heartbeat`, `journal`, `resource`, `directive*`, `worker_event*`, `coordination` rows are counted in `rows_filtered` (volume; the watcher owns liveness). `source` = `run_ledger` | `sha256(canonical row)[0:24]` | `run_id`, `stage`, `generation`, `status?` (`row.status` whenever the row has a `status` property, even an empty string; only when the property is absent, `row.state`; the chosen value is kept as it is; when both properties exist with different values `status` wins and the reader adds one warning `status_state_conflict`), `reason?` (<= 120 chars, redacted), `basis` (`self_reported`: `run-ledger.sh stage-*` is a plain CLI any process can call, so a stage row is a claim by whoever appended it) |

Not exposed on purpose: `repo_identity`, `prompt_file`, `log_path`, `worktree`, `lock_path`, `cwd`, rationale beyond the cap.
Free-text fields (`rationale`, `subject`, `reason`) pass a deterministic redaction at read time (`redact.js`: the
patterns of `scripts/lib/personal-data-redact.js` plus private-key headers and common token prefixes, replaced by
`[redacted]`), counted in `sources[].redactions`.

`basis` is an open set: today only `self_reported` exists. A value that renders as observed state must be listed as
observed in this document; none is listed yet.

### Review ledger layout (what the review reader walks)

A **live ledger** is the directory given to `hetero-review-loop.js --ledger`: `phase-<phase>.base`, `receipt-<phase>.json`
and, per phase, `review-<phase>/chain.json` plus `review-<phase>/g<N>/{range,findings,dispositions}.json`, `seat-*.json`
and `diff.txt`. `chain.json` is an array with one entry per generation; the reader emits one `review.collected` per entry
and one `review.finalized` per entry whose `status` is `finalized`. An entry without a `head` (an aborted generation)
reviewed nothing and is not an event.

The **archive** (`scripts/lib/review-ledger-copy.js`, opt-in via `review_ledger_archive.dir` or
`AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR`; env wins over the operator config) is laid out as

```
<archive>/<bucket>/<YYYY-MM>/<ledger-id>/
    archive.json                 source_realpath, repo_identity, first_collect_at, phase_keys, ...
    chain.json                   all archived phases merged, each entry carries `phase` (not read by the feed)
    receipt-<phase>.json         beside the review-* dirs, as in a live ledger
    review-<phase>/chain.json
    review-<phase>/g<N>/{range,findings,dispositions}.json, seat-*.json, [diff.txt]
<archive>/<bucket>/.ledger-id.lock    a dot entry, skipped
```

`<bucket>` is `<repo basename>-<first 8 hex of sha1(repo_identity)>`, `<ledger-id>` is `<date>-<bucket>-<8 hex>`. Each
`<ledger-id>` directory is itself a ledger root, so the reader treats it exactly like a live ledger, and skips it when its
`archive.json` names another `repo_identity`. The archive does **not** copy `phase-<phase>.base`: the review id therefore
takes the phase base from the lowest-generation `chain.json` entry (`base`), which an archive copy keeps, so a copy of a
live ledger gets the same `phase_base12` and its events collapse into the live ones by id.

## Ordering and ids

- Ascending `(ts, id)`, ids compared bytewise, within a page and across pages. The one exception is a row that arrived late (its `ts` earlier than the cursor watermark but within the slack): it is delivered once, in the next page (rules in the cursor section).
- Ids are content-only. Two readers producing one id is a bug (warning `duplicate_id`, one event kept).
- Equal-content rows: `cost.turn` rows stay distinct through the `#n` suffix; `decision.row` rows that are byte-identical collapse into one event (documented under-count).

## Cursor

The cursor is opaque: a consumer passes `cursor` back verbatim as `--since` (or on stdin with `--since -`) and never
parses it. An empty page returns the input cursor unchanged (only `generated_at` moves). A cursor of another project, one
that does not decode, one with an unknown `v` or a malformed field, or one longer than 64 KiB exits 2 with `bad_cursor`.
What follows is for implementers; the encoding may change inside `/1` only while a cursor of `v: 1` keeps decoding.

Encoding: `base64url(JSON)` of

```json
{ "v": 1, "t": "<watermark ISO ms>", "s": 300000, "w": [["<12 hex of sha256(id)>", 1793000000000]], "f": 0, "e": null, "h": { "<source>:<12 hex head hash>": 12345 }, "p": "<project_key>" }
```

- `t` is the `ts` of the last returned event. `s` is the slack in ms (default 300000), the late-row tolerance. `w` holds one
  `[id hash, ts in epoch ms]` pair per **delivered** event with `ts >= t - s`. `p` binds the cursor to a project.
- **Coverage floor `f`** (ms) is the lowest `ts` that `w` is complete for. Every read uses the floor `L = max(t - s, f)`. `f` only
  moves forward: next `f = max(f, newT - s_page)`, where `s_page` is the slack the page actually kept. So a window never
  reopens history whose ids were pruned from `w`.
- **Filter.** Every source is re-read from `L`, the events are merged, and an event is dropped iff its id hash is in `w`, or its
  `ts < L`, or it is covered by `e` (below). The rest is returned in `(ts, id)` order. There is no `<= (t, last id)` comparison:
  `w` already holds every delivered id inside the window, so a late row with `ts` in `[t - s, t)` that was not delivered passes
  the filter and is delivered once, and a row delivered on an earlier page is not repeated.
- **Next `w`** is the previous `w` pruned to pairs with `ts >= f'` (the new floor) united with this page's ids with `ts >= f'`,
  where `newT` is the last returned event's `ts`. An empty page keeps the cursor as it was.
- **Late rows** are delivered once, in the next page, therefore after later-`ts` events of the previous page; this is the only
  ordering exception. A row arriving more than `s` after its `ts` is out of contract.
- **`--since <ISO>`** (and `0`, and omitted) builds a synthetic cursor `{t: ISO + s, s, w: [], f: 0}`, so the lower bound `t - s`
  is exactly the requested instant (`0`: the start of time). `--kinds` and `--limit` are applied after the filter; an event
  excluded by `--kinds` is not in `w`, so it can still arrive under a later call that asks for its kind (inside the window).
- **Hints `h`** are per-file byte offsets keyed by the head hash (`sha256(first 256 bytes)[0:12]`), an optimisation only:
  deleting `h` yields the identical ids and order, only slower. Each event carries its source byte offset internally. For a
  file, the next hint is the smallest of the start offset of any line that was read but not delivered (cut by `--limit` or the
  page cap) and the start offset of the first line whose `ts >= f'`; with neither, the end of what was read. A hint is
  therefore never past an undelivered line or past a line the next window can still emit, which also keeps the `cost.turn`
  `#n` rule true. It stays valid across append (the offset grows), rotation (the head hash follows the file to `.1`) and
  manifest reaping. Hints exist only for files of at least 64 KiB and a hint that does not match its file's head hash is
  ignored with warning `cursor_hint_stale`.
- **Size bound.** `w` is capped at 1 000 pairs (about 46 KB as base64url) and `h` at 16 entries (largest file first), so a
  cursor is at most 64 KiB, far below the 128 KiB single-argument limit; it may also be passed on stdin (`--since -`).
  `s` is recomputed on every page and never carried forward: each page starts from the default 300 000 ms and halves it
  (150 000, 75 000, ... 0) only as far as this page's `w` needs to fit the cap. Such a page carries warning `window_overflow`
  (late rows older than `newT - s` are out of contract for that page only). The default `s` comes back as soon as `newT` moves
  past `f` by the default slack, never by reopening pruned history.
- **Termination.** With `s` down to 0 only the final `ts` group could remain. If that single group still exceeds the cap, the
  page is cut before the group when it is not the first group of the page. Otherwise (one `ts` instant holds more than 1 000
  events, for example a cost batch) the cursor leaves that group out of `w` and carries `e` = `[ts of the group, greatest
  delivered id]` (bytewise order within a `ts` group is by `id`), and keeps it, whatever `t` becomes, until the group's `ts`
  falls below the floor `L`; the filter then also drops events with `ts == e[0]` and `id <= e[1]`. In that single case a late
  row at exactly that instant with a smaller id is out of contract. In-order events are never duplicated or lost.

### Reader context (`ctx.project`)

`index.js` resolves the project once (`git rev-parse --git-common-dir`, symlinks resolved) and hands every reader the same
shape, so no reader derives it again: `{ project_key, repo_identity, repo_name, root, common_dir }`. `repo_identity` is
`git-common-dir:<common_dir>`, `repo_name` is the repository's directory name, `root` is the work tree (null in a bare
repository) and `common_dir` is the absolute git common directory. A reader also gets `ctx.env`, `ctx.home`, `ctx.now` and
`ctx.reviewLedgers` (the repeated `--review-ledger` values), and a window `{ sinceTs: L, slackMs: 0, hints: h }`: the cursor
has already folded the slack into `L`. A reader returns `{ events, warnings, stats }`, plus `files` for a JSONL source (what it
consumed, so the cursor can place hints). Any reader failure is `source_failed` and state `degraded` for that source only.
The `cwd` to common-directory memo of the cost reader lives inside one `collectEvents` call, never at module level.

## Versioning

`/1` is additive-only. A new kind, warning code, source value or optional field is allowed; a removed or retyped field
needs `/2`. A new kind needs a row in the kinds table, a schema branch and a fixture record in one commit.

## Consumer table

What the downstream consumers read. A field a consumer reads that is not in this table is not part of the contract
for that consumer.

| consumer | reads (kind.field) |
|---|---|
| C1 `hangar console project <name>`, C2 per-project overview | `dispatch.started/ended` (`run_id`, `role`, `runner`, `model`, `final_status`, `duration_s`) for started/ended counts and last activity (max `ts`). The absence of `dispatch.ended` means "not ended", not "running": C1 takes liveness from `autopilot status runs --json`, never from this feed; `cost.turn` (`cost_usd`, `input_tokens`, `output_tokens`, `tier`, `model`, `session`) for cost and tokens today (UTC day); `review.finalized` (`phase`, `generation`, `verdict`, `open_findings`, `reviewed_seats`, `total_seats`) and `review.collected` (`findings_total`, `findings_by_severity`) for review stats; `qc.verdict` (`commit`, `verdict`, `basis`) |
| C1 `decisions`, C2 decisions panel | `decision.row` (all self-reported; a panel labels vetoes "recorded veto") (`row_kind`, `decision_id`, `class`, `reversibility`, `rationale`, `target_decision_id`) to list autonomous decisions and vetoes (open operator cards come from fleet, not here) |
| A4 anomaly cards | `cost.turn.cost_usd` and `dispatch.ended.duration_s` against the median of the previous N same-`role`/`model` events (cost or time N x median); `dispatch.started` count per source and window for burst; `dispatch.started` repeats per `parent_run_id` lineage and `decision.row` `row_kind=ladder` for ">2 retries"; quota % is not in A1 (a later `quota.observed` kind would be an additive change) |
| G1 dashboard | every `data.basis=self_reported` value (`qc.verdict`, **all** `decision.row` including veto and ladder, `run.stage`) must not be rendered as verified state (fail closed: only a `basis` value listed as observed in this document renders as observed; an unknown or missing `basis` renders as "recorded"): show it as "recorded" or "claimed", never as observed; events without `basis` (`dispatch.*`, `cost.turn`, `review.*`) are written by autopilot tooling and are telemetry, not attestation (ADR-0001), and `basis` is an open set (an `observed` value may be added later, additively); `review.finalized.verdict`, `qc.verdict.verdict`, `dispatch.ended.final_status`, `cost.turn.cost_usd`, `run.stage.stage`, plus the rows above; hangar's dashboard source table maps each rendered field to a row of this table |
| all | envelope `schema`, `generated_at` (data age), `cursor`, `has_more`, `sources[].state`, `warnings[]` |

## Examples

Generated from the fixture (`scripts/lib/events-fixture.js`) by `scripts/status-events.test.js`, which fails if one of
them drifts. Placeholders: the tempdir is `<tmp>`, `project_key` is `<project_key>`, `repo_name` is `<repo>`,
`generated_at` is `<now>`, and the id hash of `cost.turn` and `decision.row` (computed over a row that embeds the
tempdir) is `<sha>`. Optional fields the source does not hold are omitted.

### Example: envelope

```json
{
  "schema": "autopilot.events/1",
  "generated_at": "<now>",
  "project": {
    "project_key": "<project_key>",
    "repo_name": "<repo>"
  },
  "events": [
    {
      "id": "dispatch.started:fx-run-done",
      "kind": "dispatch.started",
      "ts": "2026-11-01T08:10:00.000Z",
      "ts_basis": "source",
      "source": "dispatch_manifest",
      "project_key": "<project_key>",
      "root_run_id": "fx-root-1",
      "run_id": "fx-run-done",
      "data": {
        "run_id": "fx-run-done",
        "role": "implementer",
        "runner": "codex",
        "model": "gpt-fx-1",
        "branch": "dispatch/fx-done",
        "base_sha": "576de6de3fd53f2b783385fbee0744fe92051d53",
        "depth": 0,
        "timeout_seconds": 600
      }
    },
    {
      "id": "cost.turn:<sha>#1",
      "kind": "cost.turn",
      "ts": "2026-11-01T08:12:00.000Z",
      "ts_basis": "source",
      "source": "costs",
      "project_key": "<project_key>",
      "root_run_id": null,
      "run_id": null,
      "data": {
        "session": "s-fx-1",
        "model": "claude-sonnet-5-5",
        "tier": "hands",
        "input_tokens": 1200,
        "output_tokens": 300,
        "cache_read_tokens": 8000,
        "cache_write_tokens": 500,
        "cost_usd": 0.0123,
        "sidechain": false
      }
    }
  ],
  "cursor": "<opaque>",
  "has_more": true,
  "sources": [
    {
      "name": "dispatch",
      "state": "ok",
      "rows_read": 3,
      "rows_skipped": 0,
      "rows_filtered": 1,
      "redactions": 0
    },
    {
      "name": "cost",
      "state": "degraded",
      "rows_read": 7,
      "rows_skipped": 1,
      "rows_filtered": 1,
      "redactions": 0
    },
    {
      "name": "review",
      "state": "ok",
      "rows_read": 2,
      "rows_skipped": 0,
      "rows_filtered": 1,
      "redactions": 0
    },
    {
      "name": "qc",
      "state": "ok",
      "rows_read": 3,
      "rows_skipped": 0,
      "rows_filtered": 1,
      "redactions": 0
    },
    {
      "name": "decision",
      "state": "ok",
      "rows_read": 8,
      "rows_skipped": 0,
      "rows_filtered": 1,
      "redactions": 1
    },
    {
      "name": "runledger",
      "state": "ok",
      "rows_read": 5,
      "rows_skipped": 0,
      "rows_filtered": 3,
      "redactions": 0
    }
  ],
  "warnings": [
    {
      "source": "cost",
      "code": "ts_invalid",
      "detail": "costs.jsonl",
      "count": 1
    }
  ]
}
```

### Example: dispatch.started

```json
{
  "id": "dispatch.started:fx-run-done",
  "kind": "dispatch.started",
  "ts": "2026-11-01T08:10:00.000Z",
  "ts_basis": "source",
  "source": "dispatch_manifest",
  "project_key": "<project_key>",
  "root_run_id": "fx-root-1",
  "run_id": "fx-run-done",
  "data": {
    "run_id": "fx-run-done",
    "role": "implementer",
    "runner": "codex",
    "model": "gpt-fx-1",
    "branch": "dispatch/fx-done",
    "base_sha": "576de6de3fd53f2b783385fbee0744fe92051d53",
    "depth": 0,
    "timeout_seconds": 600
  }
}
```

### Example: dispatch.ended

```json
{
  "id": "dispatch.ended:fx-run-done",
  "kind": "dispatch.ended",
  "ts": "2026-11-01T08:25:00.000Z",
  "ts_basis": "source",
  "source": "dispatch_manifest",
  "project_key": "<project_key>",
  "root_run_id": "fx-root-1",
  "run_id": "fx-run-done",
  "data": {
    "run_id": "fx-run-done",
    "final_status": "success",
    "duration_s": 900,
    "role": "implementer",
    "runner": "codex",
    "model": "gpt-fx-1"
  }
}
```

### Example: cost.turn

```json
{
  "id": "cost.turn:<sha>#1",
  "kind": "cost.turn",
  "ts": "2026-11-01T08:12:00.000Z",
  "ts_basis": "source",
  "source": "costs",
  "project_key": "<project_key>",
  "root_run_id": null,
  "run_id": null,
  "data": {
    "session": "s-fx-1",
    "model": "claude-sonnet-5-5",
    "tier": "hands",
    "input_tokens": 1200,
    "output_tokens": 300,
    "cache_read_tokens": 8000,
    "cache_write_tokens": 500,
    "cost_usd": 0.0123,
    "sidechain": false
  }
}
```

### Example: review.collected

```json
{
  "id": "review.collected:7cf288e31760:E1:g1",
  "kind": "review.collected",
  "ts": "2026-11-01T09:00:00.000Z",
  "ts_basis": "source",
  "source": "review_ledger",
  "project_key": "<project_key>",
  "root_run_id": null,
  "run_id": null,
  "data": {
    "phase": "E1",
    "phase_base12": "7cf288e31760",
    "generation": 1,
    "base": "576de6de3fd53f2b783385fbee0744fe92051d53",
    "head": "9403e1b493da7cd7b5964d2c5eaeb4ba3fb59cbf",
    "seats": [
      {
        "id": "seat-a",
        "status": "reviewed"
      },
      {
        "id": "seat-b",
        "status": "reviewed"
      }
    ],
    "reviewed_seats": 2,
    "total_seats": 2,
    "findings_total": 2,
    "findings_by_severity": {
      "Major": 1,
      "Minor": 1
    }
  }
}
```

### Example: review.finalized

```json
{
  "id": "review.finalized:545dd77e083f:E1:g1",
  "kind": "review.finalized",
  "ts": "2026-11-01T09:20:00.000Z",
  "ts_basis": "source",
  "source": "review_ledger",
  "project_key": "<project_key>",
  "root_run_id": null,
  "run_id": null,
  "data": {
    "phase": "E1",
    "phase_base12": "545dd77e083f",
    "generation": 1,
    "verdict": "SHIP-AS-IS",
    "open_findings": 0,
    "reviewed_seats": 2,
    "total_seats": 2,
    "dispositions_sha256": "e6d592d2c3d8b6e0c97f1d41cb1d52ce9c682c90f48b5d587285725b759b3c70"
  }
}
```

### Example: qc.verdict

```json
{
  "id": "qc.verdict:c32883fa590c3f1538a0743f77a41faae4dc5520",
  "kind": "qc.verdict",
  "ts": "2026-11-01T08:30:00.000Z",
  "ts_basis": "source",
  "source": "git_trailer",
  "project_key": "<project_key>",
  "root_run_id": null,
  "run_id": null,
  "data": {
    "commit": "c32883fa590c3f1538a0743f77a41faae4dc5520",
    "verdict": "PASS",
    "subject": "feat: add thing",
    "basis": "self_reported"
  }
}
```

### Example: decision.row

```json
{
  "id": "decision.row:D-001:decision:<sha>",
  "kind": "decision.row",
  "ts": "2026-11-01T08:05:00.000Z",
  "ts_basis": "source",
  "source": "decision_ledger",
  "project_key": "<project_key>",
  "root_run_id": null,
  "run_id": null,
  "data": {
    "basis": "self_reported",
    "row_kind": "decision",
    "decision_id": "D-001",
    "round": 1,
    "class": "routine",
    "reversibility": "two-way",
    "rationale": "pick the smaller option"
  }
}
```

### Example: run.stage

```json
{
  "id": "run.stage:9ec7cfc3707e6ec9b8d0456b",
  "kind": "run.stage",
  "ts": "2026-11-01T08:11:30.000Z",
  "ts_basis": "source",
  "source": "run_ledger",
  "project_key": "<project_key>",
  "root_run_id": null,
  "run_id": "fx-run-done",
  "data": {
    "run_id": "fx-run-done",
    "stage": "implement",
    "generation": 1,
    "basis": "self_reported",
    "status": "running"
  }
}
```
