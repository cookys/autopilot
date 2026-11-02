# Plan — A1 Events contract: `autopilot status events --since <cursor> --json` and schema `autopilot.events/1`

> Status: draft for plan review · Owner: operator (decisions), fleet session (coordinates), autopilot (owns the code) ·
> Branch: `plan/oc-a1-events` · Size: M (four phases E1–E4, each shippable alone) ·
> Frame: deliverable D3 phase A1 of the operator-console plan (`docs/plans/2026-11-01-operator-console.md` in the fleet repo, approved 2026-11-01). It is the read-only, model-free event feed that the console (D5 C1/C2), the anomaly cards (D3 A4) and the dashboard (D6 G1) consume. autopilot = project management; the feed only restates what its existing stores already hold.

## 0. Context / thesis

The operator console must show cost, review stats, decisions, dispatch activity and QC verdicts "without asking a model" (master KR6, KR7: every displayed field maps to a named exported event source, 0 model calls). autopilot already records all of it in six stores written by different tools in different formats. Today they are read only by the per-project runs watcher (`src/status/runs-watch.js`), which publishes *latest-state* sidecars under the live dir, not a history. A consumer that wants "what happened since I last looked" has no single, resumable, de-duplicated stream.

A1 adds that stream as a **projection**: `autopilot status events` reads the existing stores, normalises each record to one envelope, merges them in a total order, and returns a page plus an opaque cursor. It writes nothing, adds no store, and attests nothing.

Constraints inherited from the repo:

- ADR-0001 (`docs/adr/0001-verification-over-attestation.md`) and CLAUDE.md "Don't": no trust machinery (hash chains, event ledgers, witness receipts). The feed is **plain telemetry derived from sources it cannot influence**; it is not a ledger, not signed, and a consumer must not treat it as proof (stated in the schema doc header and CLI help).
- The 3.0.0 relayout is in flight (`docs/plans/2026-10-31-repo-relayout-3-0-0.md`; registry `scripts/lib/repo-layout.js`, stage `bootstrap`, commit `f3a152901 refactor(layout): readers take repo paths from the layout registry`). Every repo-relative path the new code uses comes from `repoLayout.path(key)`; no literal `docs/...` string. The new files register their own keys (E1).
- Existing readers are reused, never copied: manifest dir via `scripts/lib/runtime-paths.js:runsDir`; costs via `scripts/lib/brain-spend.js:costsFileOf` and `scripts/cost-digest.js:tierOf`; decision ledger default and per-root ledger as read by `src/status/decisions-sidecar.js`; repo scope via `src/status/project-key.js:scopeFromCwd`; run-ledger rotation view with the semantics of `scripts/run-ledger.sh:ledger_scan_files` (`<ledger>.N … <ledger>.1, <ledger>`).

## 1. Problem

1. Six sources, six formats, no common time order or identity: JSON manifests (rewritten atomically as a run progresses), one host-wide append-only `costs.jsonl`, `chain.json` arrays inside per-phase review ledger dirs (rewritten in place), git commit trailers, an append-only decision JSONL, a rotating run-ledger JSONL.
2. The live review summary (`<live>/review-rounds/<project_key>.json`, `scripts/hetero-review-loop.js:publishRoundSummary`) is overwritten per round and lives on tmpfs: no history. Review chain entries carry no timestamp.
3. A polling consumer needs "since last time" without duplicates and without re-reading a 100k-row costs file each tick, and must survive rotation (`run-ledger.sh` renames the live segment to `.1`; manifests are reaped by `dispatch-status.js --reap`).
4. An unreadable line, an absent source or a half-written record must degrade the feed, not crash the console.

## 2. OKR / KRs

**Objective**: one command gives every consumer a complete, ordered, resumable, duplicate-free stream of autopilot's observable project activity, with zero model calls.

| KR | Threshold | Verified by |
|---|---|---|
| KR-A1.1 coverage | A fixture repo (built by the test) yields **each of the 8 event kinds exactly once**, ids equal to the hand-written golden list | `node --test scripts/status-events.test.js`; transcript in `docs/plans/evidence/2026-11-02-oc-a1-events/e2-coverage.txt` |
| KR-A1.2 resume | Reading in pages of N (N = 1, 3, all) and resuming from each returned cursor gives the same ordered id list as one full read: 0 duplicates, 0 gaps, also after the live JSONL was appended to, after run-ledger rotation (`.1`), and after a manifest finished between two reads | same file, cases `resume-*`; red-check transcript |
| KR-A1.3 degrade | Per source: absent, empty, unreadable (mode 000), truncated last line, binary junk line, wrong-schema row, 10 MB single line: exit 0, valid envelope, one `warnings[]` entry naming source and code, other sources' events intact | cases `degrade-*` |
| KR-A1.4 schema doc | The schema doc lists every field of every kind, and its consumer table lists every field C1, C2, A4 and G1 read; `node scripts/check-events-contract.js` exits 0 and fails on a removed doc row or a schema field absent from the doc | gate script plus red-check |
| KR-A1.5 performance | Warm resume (cursor with hints) over a fixture of 200 000 cost rows, 20 000 decision rows, 20 000 run-ledger rows, 2 000 manifests, 500 review phases returns in <= 1.5 s and reads <= 5 % of the cost file bytes; cold read with `--limit 1000` <= 8 s; peak RSS <= 256 MB | `scripts/status-events-bench.js` output in `docs/plans/evidence/2026-11-02-oc-a1-events/e4-bench.txt` |
| KR-A1.6 read-only, model-free | The command writes nothing under the repo, the live dir or any source (before/after tree digest equal with sources chmod a-w); it imports no model SDK and spawns no dispatcher | cases `readonly-*` plus a grep gate in the test |

## 2.5 Global Constraints (copied verbatim into every dispatch)

- No hosted CI: never add `.github/workflows` in any repo of this plan.
- In fleet, run courier tests only via `make courier-test` (never bare `cargo test`); every new test uses a sandbox HOME or explicit tempdir and touches no process-global state.
- No host names, LAN addresses or home paths in commits, docs or code of fleet and hippo; hosts and paths come from env or config.
- Plugins talk only to their local courier; only couriers talk to the hub; no plugin carries a hub URL.
- Wire shapes come from generated contracts (`contracts/` → `gen/`); the hub contract changes once, in phase F1, for all later phases.
- Liveness and task state are observed by the courier (pid, member state, lock, heartbeat), never taken from a model's own claim.
- hippo stores records as plain files on normal git branches; no custom refs, no git notes, no binary database in git.
- hippo ids are ULIDs on disk; short prefixes are display-only; never sequential ids.
- hippo never stores secrets or credentials; it stores where to obtain them. hippo does no embeddings or semantic search (mnemos does).
- A model never writes hippo record files directly; all writes go through the `hippo` CLI; `hippo check` runs on read, after merge and before commit, and names the offending file on failure.
- Signature verification is done by software (hangar verifier), never by a model; no private signing key is reachable by any agent process.
- A valid signature never authorizes a production target in this plan; production stays denied.
- `fleet approve` stays a human tty gate; no model runs it.
- Credentials move by 0600 file, never via chat, fleet message or a model's view.
- A1-specific additions (same standing as the lines above): Node >= 20.10, built-ins only, no new npm dependency; the command is read-only and never writes a source store; repo-relative paths come from `scripts/lib/repo-layout.js`; a source problem degrades with a warning and never changes the exit code from 0 (only usage errors exit 2); the schema is `autopilot.events/1`, additive-only after merge (a removed or retyped field requires `/2`); ADR-0001 holds: no signatures, hash chains or attestation in the feed.

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`.
  - New subcommand `autopilot status events` and new schema; existing `status` subcommands, `autopilot.runs-live/1` and all sidecars are untouched. The unknown-subcommand message in `src/status/cli.js` and the usage text in `bin/autopilot.js` gain `events`.
  - One additive writer change: review chain entries written by `scripts/hetero-review-loop.js` gain `collected_at` (set in `collect`) and `finalized_at` (set in `finalize`), ISO strings. Old entries lack them; the reader falls back to file mtime and marks `ts_basis:"mtime"`. Unknown chain fields must not break existing readers (E2 runs `hooks/tests/hetero-review-loop.test.sh` and `scripts/review-input.test.js`).
  - Consumers: hangar `console` (C1/C2) and A4 read the JSON; they pin `schema == "autopilot.events/1"` and ignore unknown fields. Migration: none.
- **Dependency decision**: `platform/stdlib`. Node built-ins (`fs`, `crypto`, `child_process` for `git`); git is already required by the repo. No JSON-schema library: `schemas/events.schema.json` is validated by the existing `scripts/validate-json-schema.js`.

## 3. File-structure map

| Path | Responsibility | Phase |
|---|---|---|
| `schemas/events.schema.json` | JSON Schema of the envelope and one `data` shape per kind (`oneOf` on `kind`) | E1 |
| `docs/events-contract.md` (registry key `events_contract_doc`) | the contract: envelope, kinds, ids, ordering, cursor, warnings, consumer field table, examples | E1 |
| `scripts/lib/repo-layout.js` | add path keys `events_contract_doc`, `events_schema` | E1 |
| `scripts/lib/events-fixture.js` | builds the fixture repo and every source store in a tempdir (tests and bench) | E1 |
| `src/status/events/sources/dispatch.js` | manifests -> `dispatch.started`, `dispatch.ended` | E2 |
| `src/status/events/sources/cost.js` | `costs.jsonl` -> `cost.turn` | E2 |
| `src/status/events/sources/review.js` | review ledger `chain.json` -> `review.collected`, `review.finalized` | E2 |
| `src/status/events/sources/qc.js` | `git log` trailers -> `qc.verdict` | E2 |
| `src/status/events/sources/decision.js` | decision ledgers -> `decision.row` | E2 |
| `src/status/events/sources/runledger.js` | run ledger (rotation-aware) -> `run.stage` | E2 |
| `src/status/events/jsonl-tail.js` | tolerant line reader: offset hints, partial last line, size caps, per-line try/catch | E2 |
| `scripts/hetero-review-loop.js` | additive `collected_at` / `finalized_at` in chain entries | E2 |
| `src/status/events/merge.js` | total order, de-dup, window, limit | E3 |
| `src/status/events/cursor.js` | encode, decode, validate the opaque cursor | E3 |
| `src/status/events/index.js` | `collectEvents({cwd, since, limit, kinds, env, now})` -> envelope | E3 |
| `src/status/cli.js`, `bin/autopilot.js` | `status events` argv, human output, usage text | E4 |
| `scripts/check-events-contract.js` | doc / schema / consumer-table gate | E4 |
| `scripts/status-events.test.js` | the acceptance suite (node:test, tempdirs only) | E1–E4 |
| `scripts/status-events-bench.js` | KR-A1.5 bench | E4 |
| `docs/scripts-inventory.md`, `CHANGELOG.md` | index rows (no release notes in rows), Unreleased entry | E4 |

Test conventions used (checked in the repo): L1 unit tests are `scripts/*.test.js` under `node:test`, discovered by `node --test` in `hooks/tests/run.sh`; shell integration tests are `hooks/tests/*.test.sh`; JSON shapes live in `schemas/*.schema.json` and are checked with `scripts/validate-json-schema.js` (pattern: `scripts/review-input.test.js`); each test builds mkdtemp dirs and never touches the real stores.

## 4. Phases

Dependencies: `E1 -> E2 -> E3 -> E4`. After E1 the six readers of E2 are independent of each other; E3 needs all six. A1 has no upstream in the master graph; A3, A4, A5, C1, C2 and G1 consume it.

### E1 — Contract, schema, fixture (M)

Write the contract first so readers target a fixed shape.

**The command.**

```
autopilot status events [--since <cursor|ISO-8601|0>] [--limit N] [--kinds k1,k2,...] [--project <project_key>]
                        [--review-ledger <dir>]... [--json]
```

- `--since` omitted or `0`: from the beginning of what the sources still hold, in pages of `--limit` (default 1000, max 10 000).
- `--since <ISO-8601>`: first call by wall time (events with `ts >=` it). Any other value is a cursor; one that does not decode or has an unknown `v` exits 2 with `bad_cursor`.
- `--project`: default = project of `cwd` (`scopeFromCwd`). Events of other repos are never returned; host-wide sources (costs file, manifests dir) are filtered to the project.
- `--json` prints one JSON object (the envelope). Without it a compact table (kind, ts, id prefix, one-line summary) and a `next cursor:` line; warnings to stderr.

**Envelope** (`schema: "autopilot.events/1"`):

```json
{
  "schema": "autopilot.events/1",
  "generated_at": "2026-11-02T08:00:00.000Z",
  "project": { "project_key": "<16 hex>", "repo_identity": "git-common-dir:<realpath>" },
  "events": [],
  "cursor": "<opaque>",
  "has_more": false,
  "sources": [ { "name": "cost", "state": "ok|absent|degraded", "rows_read": 0, "rows_skipped": 0, "rows_filtered": 0 } ],
  "warnings": [ { "source": "cost", "code": "line_unparseable|file_unreadable|line_too_long|schema_mismatch|ts_invalid|cursor_hint_stale|window_overflow|git_unavailable|source_failed|duplicate_id", "detail": "<short; basenames only>", "count": 1 } ]
}
```

**Event** (all kinds):

```json
{ "id": "<kind>:<stable key>", "kind": "<kind>", "ts": "2026-11-02T08:00:00.000Z", "ts_basis": "source|mtime",
  "source": "dispatch_manifest|costs|review_ledger|git_trailer|decision_ledger|run_ledger",
  "project_key": "<16 hex>", "root_run_id": "<id>|null", "run_id": "<id>|null", "data": {} }
```

- `ts` is UTC with millisecond precision (`Z`). A source timestamp that is not a strict ISO instant (same `strictIsoMs` rule as `src/status/decisions-sidecar.js`) drops that event with warning `ts_invalid`; the feed never invents a time. The only fallback is the review reader's `ts_basis:"mtime"`.
- `id` = `<kind>:` + a key derived only from record content, never from file position, mtime or read order. The same record read from the live file or from `.1` after rotation has the same id.
- Order: ascending by `ts`, ties by `id` (bytewise). Total and deterministic.
- `root_run_id` / `run_id` are filled when the record carries them (`manifest.root_run_id`, ledger `root_run_id`/`run_id`), else null; never derived.

**The 8 kinds** (this table is the contract; `data` lists every field; `?` = may be null or absent; free text is length-capped):

| kind | source and reader (file:function) | `id` key | `data` fields |
|---|---|---|---|
| `dispatch.started` | manifest `<runsDir>/<safe_id>.manifest.json`, written by `scripts/dispatch-hetero.sh:write_manifest` (and the review dispatchers); dir from `scripts/lib/runtime-paths.js:runsDir`. `ts` = `started_at` | `run_id` | `run_id`, `role`, `runner`, `model`, `branch`, `base_sha`, `parent_run_id?`, `depth?`, `timeout_seconds?` |
| `dispatch.ended` | same manifest once `ended_at` and `final_status` are set (`manifest_finalize`). `ts` = `ended_at`. A running or dead-pid manifest yields no ended event (liveness is the watcher's job, `scripts/dispatch-status.js`) | `run_id` | `run_id`, `final_status`, `duration_s` (`ended_epoch - started_epoch`), `role`, `runner`, `model` |
| `cost.turn` | `costs.jsonl` from `scripts/lib/brain-spend.js:costsFileOf`; rows written by `hooks/cost-tracker.js` (`ts, session, model, sidechain?, agent_id?, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cwd`). Project filter: `cwd` resolved to its git common dir (memoised per distinct cwd) equals the project's | `sha256(raw line)[0:24]` + `#n`, n = count of earlier byte-identical lines in the file (identical rows stay distinct and stable) | `session`, `model`, `tier` (`scripts/cost-digest.js:tierOf`), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `sidechain` (bool), `agent_id?` |
| `review.collected` | review ledger dirs `<ledger>/review-<phase>/chain.json` (array written by `scripts/hetero-review-loop.js:saveChainEntryLocked`), one event per chain entry. `ts` = entry `collected_at` (E2 writer), else mtime of `g<N>/findings.json` (`ts_basis:"mtime"`) | `<phase>:g<generation>` | `phase`, `generation`, `base`, `head`, `seats` (`[{id,status}]`), `reviewed_seats`, `total_seats`, `findings_total`, `findings_by_severity?` (from `g<N>/findings.json`) |
| `review.finalized` | same entry once `status == "finalized"`. `ts` = `finalized_at`, else mtime of the dispositions snapshot | `<phase>:g<generation>` | `phase`, `generation`, `verdict?` (from `receipt-<phase>.json` when present), `open_findings?` (count), `reviewed_seats`, `total_seats`, `dispositions_sha256` |
| `qc.verdict` | one `git log --format=%H%x1f%cI%x1f%(trailers:key=QC-Verdict,valueonly,separator=%x1e) --branches HEAD` of the project; one event per commit carrying a `QC-Verdict` trailer (the trailer name `scripts/lib/qc-evidence.sh:qc_has_evidence` greps). `ts` = committer date | commit sha | `commit`, `verdict` (trailer value, first line, <= 64 chars; `PASS` is the only value the gate accepts, others are reported verbatim), `subject` (<= 120 chars) |
| `decision.row` | decision ledgers: default `<git-common-dir>/autopilot/ledger/decisions.jsonl` and `<git-common-dir>/autopilot/work-orders/<root>/decision-ledger.jsonl`, rows per the `scripts/decision-ledger.js` header; filter `row.repo_identity == project` (a row without it in the per-repo default file is included, as `decisions-sidecar.js` does). `ts` = row `ts` | `decision_id:row_kind` (veto rows: `target_decision_id:veto`), else `sha256(canonical row)[0:24]` | `row_kind` (`decision|dispatch|pick|refreeze|veto|note|hypothesis|unknown|ladder`, unknown values kept verbatim), `decision_id?`, `round?`, `class?`, `reversibility?`, `rationale?` (<= 240 chars, truncation marked), `target_decision_id?` (veto), `rung?`, `result?` (ladder) |
| `run.stage` | run-ledger JSONL(s): paths from manifests' `ledger` field and work-order paths (`src/engine/work-order.js`, `paths.ledger`), read as the rotation-aware set `<p>.N … <p>.1, <p>` (`run-ledger.sh:ledger_scan_files`). Only rows with `kind:"stage"` are events; `heartbeat`, `journal`, `resource`, `directive*`, `worker_event*`, `coordination` rows are counted in `rows_filtered` (volume; the watcher owns liveness) | `sha256(canonical row)[0:24]` | `run_id`, `stage`, `generation`, `status?`, `reason?` (<= 120 chars) |

Not exposed on purpose: `prompt_file`, `log_path`, `worktree`, `lock_path`, `cwd`, raw rationale beyond the cap.

**Schema doc** (`docs/events-contract.md`): header (projection, not attestation, ADR-0001), the command, envelope, event, the kinds table with one example per kind generated from the fixture by the test (examples cannot drift), id rules, ordering, cursor (written in E3), warnings, versioning rule (additive only), and the **consumer table**:

| consumer | reads (kind.field) |
|---|---|
| C1 `hangar console project <name>`, C2 per-project overview | `dispatch.started/ended` (`run_id`, `role`, `runner`, `model`, `final_status`, `duration_s`) for open/blocked/done and last activity (max `ts`); `cost.turn` (`cost_usd`, `input_tokens`, `output_tokens`, `tier`, `model`, `session`) for cost and tokens today (UTC day); `review.finalized` (`phase`, `generation`, `verdict`, `open_findings`, `reviewed_seats`, `total_seats`) and `review.collected` (`findings_total`, `findings_by_severity`) for review stats; `qc.verdict` (`commit`, `verdict`) |
| C1 `decisions`, C2 decisions panel | `decision.row` (`row_kind`, `decision_id`, `class`, `reversibility`, `rationale`, `target_decision_id`) to list autonomous decisions and vetoes (open operator cards come from fleet, not here) |
| A4 anomaly cards | `cost.turn.cost_usd` and `dispatch.ended.duration_s` against the median of the previous N same-`role`/`model` events (cost or time N x median); `dispatch.started` count per source and window for burst; `dispatch.started` repeats per `parent_run_id` lineage and `decision.row` `row_kind=ladder` for ">2 retries"; quota % is not in A1 (§8 Q2) |
| G1 dashboard | `review.finalized.verdict`, `qc.verdict.verdict`, `dispatch.ended.final_status`, `cost.turn.cost_usd`, `run.stage.stage`, plus the rows above; hangar's dashboard source table maps each rendered field to a row of this table |
| all | envelope `schema`, `generated_at` (data age), `cursor`, `has_more`, `sources[].state`, `warnings[]` |

**Fixture** (`scripts/lib/events-fixture.js`): `buildFixture({dir})` creates under a tempdir HOME/TMPDIR: a git repo with 3 commits (`QC-Verdict: PASS`, `QC-Verdict: WAIVED` to prove verbatim reporting, and none); a manifests dir with a finished and a running manifest (the running one yields only `dispatch.started`); a costs file with 3 rows (one for a foreign cwd, filtered out); a review ledger with a collected-only phase and a finalized phase; a decision ledger with `decision`, `veto`, `ladder`, `note` rows; a run ledger with `stage`, `heartbeat`, `journal` rows and a rotated `.1`. It returns the golden `{kind,id,ts}` list as hand-computed constants in the test (not recomputed by the code under test).

Verify:
- `node scripts/validate-json-schema.js schemas/events.schema.json` exits 0 and the golden events validate against it: `node --test scripts/status-events.test.js --test-name-pattern schema`.
- `node scripts/lib/repo-layout.js path events_contract_doc` prints the doc path; `node scripts/layout-lint.js` exits 0.

Acceptance: schema file, doc with the full kinds table and consumer table, registry keys and fixture builder committed; schema test green; red-check: delete `ts` from the golden `cost.turn` -> the schema test fails; restore.

### E2 — Source readers (L)

Each reader: `read(ctx, window) -> { events, warnings, stats }`, `ctx = {project, env, home, now}`, `window = {sinceTs, slackMs, hints}`. Read-only with respect to the sources; never throws (`index.js` still wraps each call).

Steps:

1. `src/status/events/jsonl-tail.js`: `readLines(file, {fromOffset, maxLineBytes: 1 MiB, headHash})`. 64 KiB chunks; split on `\n`; a final line without `\n` is not consumed (a write in progress; the next read resumes at its start). A line over `maxLineBytes` is skipped with `line_too_long` and reading continues after the next `\n`; each parse is try/catch -> `line_unparseable`; NUL/binary lines the same. A hint `{offset, head}` is used only if `sha256(first 256 bytes) == head` and `offset <= size`; otherwise a full re-read with `cursor_hint_stale`. EACCES/EISDIR -> `file_unreadable`; ENOENT -> `state:"absent"`, no warning.
2. `sources/cost.js`: stream with hints. `cost-tracker` appends a whole transcript delta per Stop, so rows can carry `ts` earlier than rows already read: a slack of 5 minutes is applied, not an `ts`-ordered assumption. Subagent rows (`sidechain:true`) are included (the console wants subagent cost); `brain-spend.js:isSubagentRow` is NOT used to drop them. Project filter by `cwd` -> `git rev-parse --git-common-dir`, memoised; a vanished cwd counts as `rows_filtered`.
3. `sources/dispatch.js`: list `*.manifest.json` in `runsDir(env)`; skip `panel-*` (plan-review panels, other shape). `stat` first: a finished manifest is immutable, skip it when its mtime < `sinceTs - slack`. Keep manifests whose `repo_identity` equals the project (without it: `rows_filtered`). Emit `dispatch.started` always, `dispatch.ended` when `ended_at` and `final_status` exist. Manifests are written by `mv` of a temp file, so a parse failure is real corruption: `line_unparseable` with the basename.
4. `sources/review.js`: ledger roots = repeated `--review-ledger`, env `AUTOPILOT_EVENTS_REVIEW_LEDGERS` (path list), a manifest's `ledger` field when it holds `review-*` dirs, and the archive dir configured as `review_ledger_archive.dir` (resolved as `scripts/lib/review-ledger-copy.js` does; the author records the archive's real directory layout in the doc; a copy of a live ledger collapses by id `<phase>:g<n>`). Read `review-*/chain.json`; non-array or unparseable -> `schema_mismatch` / `line_unparseable`; skip an entry without integer `generation`. `findings.json` counts are read lazily and only for entries inside the window. Writer change in `scripts/hetero-review-loop.js`: `collect` sets `collected_at`, `finalize` sets `finalized_at`; `hooks/tests/hetero-review-loop.test.sh` gets one assertion each.
5. `sources/qc.js`: one `git log` through `execFileSync` with `GIT_*` env cleaned by `src/status/git-env.js:cleanGitEnv`, timeout 20 s, `maxBuffer` 32 MiB, `--since=<sinceTs - slack>` when a window exists. Missing git or not a repo -> `git_unavailable`, state `degraded`. A commit with an empty trailer is not an event.
6. `sources/decision.js`: files per the table with hints; a row needs a strict ISO `ts` and a string `kind`; unknown kinds are kept as `row_kind`; `rationale` truncated to 240 chars.
7. `sources/runledger.js`: ledger paths from manifests' `ledger` and `<git-common-dir>/autopilot/work-orders/*/`; for each, files `<p>.N … <p>.1, <p>`; hints keyed by head hash, not by name, so a segment renamed from `<p>` to `<p>.1` keeps its offset (rotation-stable). Only `kind:"stage"` rows become events.

Verify (in `scripts/status-events.test.js`):
- `node --test scripts/status-events.test.js --test-name-pattern 'source-'` green: each reader returns exactly its fixture kinds with golden ids.
- `degrade-<source>-*` (KR-A1.3) green: absent, empty, mode 000, truncated last line, binary line, wrong-schema row, 10 MB line.
- `bash hooks/tests/run.sh hetero-review-loop` and `node --test scripts/review-input.test.js` green (writer change).

Red-checks (restore the old source, watch the test fail): (a) revert the partial-last-line rule -> `degrade-*-truncated` fails; (b) make the `cost.turn` id the line number -> `resume-after-append` and `source-cost` fail; (c) drop head validation of hints -> `rotation` shows a gap; (d) remove the project filter on cost -> the foreign-cwd row appears, `source-cost` fails; (e) revert the `collected_at` writer -> the new assertion in `hetero-review-loop.test.sh` fails.

Acceptance: six readers and the writer change merged; every degrade case green; no reader imports another reader.

### E3 — Merge, cursor, resume (M)

**Cursor** (`cursor.js`): opaque to consumers ("pass it back verbatim"); `base64url(JSON)` of

```json
{ "v": 1, "t": "<watermark ISO ms>", "w": ["<12 hex of sha256(id)>"], "h": { "<source>:<head hash>": 12345 }, "p": "<project_key>" }
```

- `t` = `ts` of the last returned event. `w` = id hashes of every returned event whose `ts` is within SLACK (5 min) of `t`. The next read re-reads sources from `t - SLACK`, merges, drops any event with `(ts,id) <= (t, last id)` or whose hash is in `w`, and returns the rest. A late row (a cost batch, a ledger row appended out of order by up to SLACK) is delivered once, never lost. An event arriving more than SLACK after its own `ts` is out of contract (documented).
- `h` = per-file offsets keyed by head hash: an optimisation only. Deleting `h` yields the identical event list, slower. This is what keeps the cursor valid across append (offset grows), rotation (the head hash follows the file to `.1`) and manifest reaping (a vanished manifest's events are behind `t`).
- Size bound: `w` capped at 2 000 ids (about 30 KB encoded); more events inside the slack window than that -> the page is cut earlier (`has_more:true`). If one single `ts` instant holds > 2 000 events, warning `window_overflow` and the page ends at that instant's boundary carrying all its ids (cap 10 000 for that cursor). Documented.
- `p` binds the cursor to a project; a cursor of another project exits 2 `bad_cursor`. `--since <ISO>` builds a synthetic `{t: ISO, w: []}`.

**Merge** (`merge.js`): concatenate reader outputs, drop events failing the envelope check, sort by `(ts, id)`, collapse equal ids (a duplicate id across sources is a bug: keep one, warn `duplicate_id`), apply the cursor filter, then `--kinds`, cut at `--limit`, compute `has_more` and the next cursor from the last returned event. An empty page returns the input cursor unchanged (only `generated_at` moves).

**`index.js`**: assembles the envelope; runs the readers in a fixed order each in its own try/catch (`source_failed`, state `degraded`); fills `sources[]` stats.

Verify:
- `node --test scripts/status-events.test.js --test-name-pattern 'resume-|order-|cursor-'` green: pages of 1, 3, all concatenate to the full list; resume after (i) appending cost rows, (ii) appending a decision row with `ts` inside the slack but before the watermark, (iii) rotating the run ledger (`mv ledger ledger.1`, new live file, new row), (iv) finishing the running manifest, (v) deleting `h` from the cursor (same result), (vi) a cursor of another project (exit 2), (vii) a garbage cursor (exit 2), (viii) 5 000 events in one second (`window_overflow`, still no duplicate or gap).
- Determinism: two runs on an unchanged fixture give byte-identical `events` and `cursor`.

Red-checks: (a) sort by `ts` only -> `order-tie` fails; (b) filter `<= t` without the `w` set -> case (ii) loses the late row; (c) re-read from `t - SLACK` without the `w` set -> `resume-no-duplicate` shows a duplicate; (d) key hints by file name -> `rotation` fails.

Acceptance: KR-A1.2 and KR-A1.3 met on the full path; the cursor section is written into the schema doc.

### E4 — CLI wiring, gate, bench, docs (M)

1. `src/status/cli.js`: add the `events` branch in `runStatusCli` before the unknown-subcommand fallthrough; flags of E1; exit `0` (with or without warnings), `2` usage or `bad_cursor`; extend the unknown-subcommand message. `bin/autopilot.js`: add `events` to the `status` usage line. The events modules are `require`d lazily inside the branch (the `cli.js` header explains `hooks/tests/status-finish-followup` copies `cli.js` alone into a hermetic repo).
2. `scripts/check-events-contract.js` (stderr + exit codes): (i) every property of every `data` shape in the schema appears in the doc kinds table; (ii) every `kind.field` in the doc consumer table exists in the schema; (iii) the doc examples equal the fixture's golden events (runs `buildFixture`); (iv) the doc path resolves through the registry. Exit 1 naming the first gap of each class.
3. Wire the gate where other `check-*.js` gates are listed (`scripts/doc-drift-gate.js` reads the registry; add it there only if that file holds a list of gates, otherwise it stays a standalone script run by the test).
4. `scripts/status-events-bench.js`: synthetic generator (no real data) for the KR-A1.5 sizes, cold and warm reads, prints wall time, RSS and bytes read per source.
5. `docs/scripts-inventory.md` rows (index entry only) for the three new scripts; `CHANGELOG.md` Unreleased entry.
6. Live proof: transcript of `autopilot status events --json --limit 5` and a resume from its cursor in this repo, paths scrubbed to `<tmp>` / `<home>`, under `docs/plans/evidence/2026-11-02-oc-a1-events/`.

Verify:
- `node --test scripts/status-events.test.js` (whole file) green; `node scripts/check-events-contract.js` exit 0; `node scripts/status-events-bench.js` meets KR-A1.5; `bash hooks/tests/run.sh status-finish-followup` green; `node scripts/layout-lint.js` exit 0; `bash hooks/tests/run.sh --parallel 4 status` for the neighbouring status suites.
- `readonly-*`: before/after tree digest of repo, live dir and every source dir equal, source dirs chmod a-w, exit still 0.

Red-checks: remove one doc row -> `check-events-contract.js` exit 1 names it; add an undocumented schema property -> exit 1; rename a consumer-table field -> exit 1; add a `fs.writeFileSync` in a reader -> `readonly-*` fails.

Acceptance (A1 as a whole, from the master plan): a fixture repo yields each event kind once; cursor resume returns no duplicate; the schema doc lists every field the console uses; every KR-A1.x row has a transcript under `docs/plans/evidence/2026-11-02-oc-a1-events/`.

## 5. Test / validation

| What | How | Gate |
|---|---|---|
| each kind once, golden ids | `node --test scripts/status-events.test.js` (fixture per test in a tempdir; env `HOME`, `TMPDIR`, `AUTOPILOT_COSTS_FILE`, `AUTOPILOT_DISPATCH_RUNS_DIR`, `AUTOPILOT_CONFIG_FILE` all point into the tempdir; never the real `~/.claude`, `~/.autopilot`, live dir or dispatch dir) | script |
| resume, order, rotation | same file, `resume-*`, `order-*`, `rotation`, `cursor-*` | script |
| degrade | same file, `degrade-*` | script |
| schema doc complete | `node scripts/check-events-contract.js` | script |
| performance | `node scripts/status-events-bench.js` | script |
| writer change safe | `bash hooks/tests/run.sh hetero-review-loop`, `node --test scripts/review-input.test.js` | script |
| layout | `node scripts/layout-lint.js` | script |
| consumer fit | hangar C1 fixture test reads the doc's example envelope; the A4 author reads the consumer table before coding | human read at C1/A4 plan time |

Every new test is red-checked (restore the old behaviour, watch it fail); the transcript names the reverted hunk. No hosted CI; local gates only.

## 6. Risks + inversion

| Risk (what would guarantee failure) | Mitigation |
|---|---|
| Duplicates or gaps on resume because ids depend on file position or ts on read time | content-only ids; cursor window `w`; resume tests with append, rotation, late rows; determinism test |
| Cursor grows without bound or breaks when a source is rewritten | hints optional and keyed by head hash; `w` capped; deleting `h` gives the same result |
| Review events have no timestamp; mtime drift (archive copy, `touch`) reorders history | additive `collected_at`/`finalized_at` in E2; mtime only as flagged fallback; documented limit |
| One corrupt line kills the console | per-line and per-source try/catch; exit 0 always; 7 degrade cases per source |
| A 200k-row costs file re-read every poll | offset hints, mtime pre-filter, bound and bench in KR-A1.5 |
| Host-wide sources leak other projects' activity | project filter on every source (`cwd`, `repo_identity`), a foreign row per source in the fixture |
| Secrets, prompts or home paths leak through events | paths and prompts not exposed; free text capped; warnings carry basenames only; a test greps the golden envelope for home/tmp path and token patterns |
| The feed is mistaken for proof (ADR-0001 breach) | header of doc and CLI help say "telemetry projection, not attestation"; no signature or chain field exists |
| The relayout moves a source path under a reader | repo paths only via `repoLayout.path(key)`; runtime paths only via their resolvers; `layout-lint` in the gate |
| Kind creep | `/1` additive-only; a new kind needs doc row, schema row and fixture record in one commit (gate enforces) |
| `cli.js` gains a heavy require and breaks the hermetic status test | lazy require; `status-finish-followup` in E4 |

## 7. Out of scope

- Fleet task events, hippo events, hub data (the console merges those itself; A1 is autopilot's own sources).
- Quota percentage or `engine-capability-state` samples (subscription CLIs expose no remaining %, see the HONESTY CONTRACT in `src/status/cli.js`); A4 can use `autopilot status quota --json` until an operator decision adds a `quota.observed` kind in `/1.1`.
- Plan-review panel manifests (`panel-*`), `heartbeat`/`journal`/`resource`/`directive*` run-ledger rows, hook audit logs.
- A push channel (`--follow`), a persistent event store, any write to a source, any use of the feed as a gate or verdict input.
- Cross-host aggregation (each host serves its own project feed; the console merges by `project_key` and host).
- Reshaping the existing `status runs` sidecars.

## 8. Open questions

Decided by depth-0 on 2026-11-02 (CEO mode, operator delegated; two-way decisions):

1. **Review ledger discovery**: yes. `collect` writes a pointer under `<git-common-dir>/autopilot/` (additive change in the file already touched for `collected_at`); E2 step 4 reads the pointer first, then `--review-ledger`, the env path list, manifests' `ledger` field and the archive dir.
2. **Quota**: A4's quota signal is the status plus `reset_at` from `status quota`; no `quota.observed` kind in A1. A later kind is an additive schema change (`autopilot.events/1` stays valid).
3. **`decision.row.rationale`** (<= 240 chars) is exposed to the console; the decisions panel needs a human-readable line.

No open questions remain.

## Review log

- R0 2026-11-02: author = plan author lane `oc-a1-plan` (claude-sonnet-5-5). Inputs: master plan `docs/plans/2026-11-01-operator-console.md` (fleet repo) sections 0–2.6, §4 D3 (A1; A3/A4/A5 as consumers) and D5 C1/C2, D6 G1, KRs, review log and the g1/g2 dispositions (the A1 folded item: sizes and checkable acceptance for A1; no other A1-specific binding items found). autopilot sources read: `src/status/cli.js`, `runs-watch.js`, `decisions-sidecar.js`, `review-input.js`, `qc-fact.js`, `spend-history.js`, `project-key.js`; `scripts/decision-ledger.js`, `dispatch-status.js`, `dispatch-hetero.sh`, `hetero-review-loop.js`, `run-ledger.sh`, `cost-digest.js`; `scripts/lib/repo-layout.js`, `runtime-paths.js`, `brain-spend.js`, `review-ledger-copy.js`; `hooks/cost-tracker.js`; `scripts/lib/qc-evidence.sh`.
- Manifest: `docs/plans/2026-11-02-oc-a1-events-contract.plan-review-manifest.json` (to be written before review); rubric `docs/plans/2026-11-02-oc-a1-events-contract.rubric.md` (scaffolded, not frozen).
- Review: not run.
