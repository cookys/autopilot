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
| KR-A1.2 resume | Reading in pages of N (N = 1, 3, all) and resuming from each returned cursor delivers a set of ids equal to the full-read id set: 0 duplicates, 0 gaps, also after the live JSONL was appended to, after run-ledger rotation (`.1`), and after a manifest finished between two reads. Order: ascending `(ts,id)` within a page and across pages, except a row that arrived late (its `ts` earlier than the cursor watermark but within SLACK), which is delivered once in the next page; without late rows the concatenated pages equal the full-read ordered list. Pages of 1 with and without hints are identical | same file, cases `resume-*`; red-check transcript |
| KR-A1.3 degrade | Per source: absent, empty, unreadable (mode 000, skipped with a logged reason when uid 0), truncated last line, binary junk line, wrong-schema row, malformed `ts`, 10 MB single line: exit 0, valid envelope, other sources' events intact. Warning rules: a **configured** source that is absent gives one aggregated `source_absent` warning (state `absent`); an absent optional discovery candidate (rotated `.N` segment, manifest-named ledger that was reaped, unset env list) gives no warning; an empty file gives state `ok` and no warning; every other case gives one aggregated warning naming source and code | cases `degrade-*` |
| KR-A1.4 schema doc | The schema doc lists every field of every kind, and its consumer table lists every field C1, C2, A4 and G1 read; `node scripts/check-events-contract.js` exits 0 and fails on a removed doc row or a schema field absent from the doc | gate script plus red-check |
| KR-A1.5 performance | Warm resume (cursor with hints) over a fixture of 200 000 cost rows, 20 000 decision rows, 20 000 run-ledger rows, 2 000 manifests, 500 review phases returns in <= 1.5 s and reads <= 5 % of the cost file bytes; cold read with `--limit 1000` <= 8 s; peak RSS <= 256 MB | `scripts/status-events-bench.js` output in `docs/plans/evidence/2026-11-02-oc-a1-events/e4-bench.txt` |
| KR-A1.6 read-only, model-free | The command writes nothing under the repo, the live dir, any source or a missing `TMPDIR` (executable-level case: `TMPDIR` set to a nonexistent path stays nonexistent; before/after tree digest equal with sources chmod a-w, skipped with a logged reason when uid 0); it imports no model SDK and spawns no dispatcher | cases `readonly-*` plus a grep gate in the test |

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
  - A second additive writer change (decided §8 Q1): `collect` writes a ledger pointer `<git-common-dir>/autopilot/review-ledgers.txt` (one absolute ledger dir per line, appended if absent) so discovery needs no configuration; `hooks/tests/hetero-review-loop.test.sh` gets an assertion and a red-check.
  - Consumers: hangar `console` (C1/C2) and A4 read the JSON; they pin `schema == "autopilot.events/1"`, ignore unknown fields, skip unknown `kind` values and tolerate unknown `warnings[].code`, `source` and `row_kind` values (open sets, see E1). Migration: none.
- **Dependency decision**: `platform/stdlib`. Node built-ins (`fs`, `crypto`, `child_process` for `git`); git is already required by the repo. No JSON-schema library: `schemas/events.schema.json` is validated by the existing `scripts/validate-json-schema.js`.

## 3. File-structure map

| Path | Responsibility | Phase |
|---|---|---|
| `schemas/events.schema.json` | JSON Schema of the envelope and one `data` shape per kind (`oneOf` on `kind`) | E1 |
| `docs/dev/events-contract.md` (registry key `events_contract_doc`; under `docs/dev/` because layout rule 7 `reader-docs`, active from P1, flags any other `docs/*.md`) | the contract: envelope, kinds, ids, ordering, cursor, warnings, consumer field table, examples | E1 |
| `scripts/lib/repo-layout.js` | add path keys `events_contract_doc`, `events_schema` | E1 |
| `scripts/lib/events-fixture.js` | builds the fixture repo and every source store in a tempdir (tests and bench) | E1 |
| `src/status/events/sources/dispatch.js` | manifests -> `dispatch.started`, `dispatch.ended` | E2 |
| `src/status/events/sources/cost.js` | `costs.jsonl` -> `cost.turn` | E2 |
| `src/status/events/sources/review.js` | review ledger `chain.json` -> `review.collected`, `review.finalized` | E2 |
| `src/status/events/sources/qc.js` | `git log` trailers -> `qc.verdict` | E2 |
| `src/status/events/sources/decision.js` | decision ledgers -> `decision.row` | E2 |
| `src/status/events/sources/runledger.js` | run ledger (rotation-aware) -> `run.stage` | E2 |
| `src/status/events/jsonl-tail.js` | tolerant line reader: offset hints, partial last line, size caps, per-line try/catch | E2 |
| `scripts/hetero-review-loop.js` | additive `collected_at` / `finalized_at` in chain entries; ledger pointer file written by `collect` | E2 |
| `src/status/events/instant.js` | `parseInstant(str)` -> normalised `.sssZ` string or null (the only timestamp grammar) | E1 |
| `src/status/events/redact.js` | thin wrapper over `scripts/lib/personal-data-redact.js` plus token patterns for free-text fields | E2 |
| `src/status/events/merge.js` | total order, de-dup, window, limit | E3 |
| `src/status/events/cursor.js` | encode, decode, validate the opaque cursor | E3 |
| `src/status/events/index.js` | `collectEvents({cwd, since, limit, kinds, env, now})` -> envelope | E3 |
| `src/status/cli.js`, `bin/autopilot.js` | `status events` argv, human output, usage text; `bin/autopilot.js` skips the startup `ensureTmpdir` for `status events` | E4 |
| `scripts/check-events-contract.js` | doc / schema / consumer-table / baseline gate | E4 |
| `schemas/events.baseline.json` | frozen `/1` field baseline, additions only | E4 |
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
- `--since <ISO-8601>`: first call by wall time (events with `ts >=` it). `-` reads the cursor from stdin (one line). Any other value is a cursor; one that does not decode or has an unknown `v` exits 2 with `bad_cursor`. Every exit-2 path (`bad_cursor`, usage, `project_unresolved`) prints, under `--json`, the same error object `{"schema":"autopilot.events/1","error":{"code":...}}`, described in `schemas/events.schema.json` as a second top-level shape. An absent default decision ledger or dispatch runs dir is state `absent` with no warning (a fresh repo is normal).
- `--project <project_key>`: optional; must equal the key of `cwd`'s own repo, any other key exits 2 (a 16-hex key cannot be turned back into a repo path, and the git-common-dir sources need one). Events of other repos are never returned; host-wide sources (costs file, manifests dir) are filtered to the project.
- `--json` prints one JSON object (the envelope). Without it a compact table (kind, ts, id prefix, one-line summary) and a `next cursor:` line; warnings to stderr.

**Envelope** (`schema: "autopilot.events/1"`):

```json
{
  "schema": "autopilot.events/1",
  "generated_at": "2026-11-02T08:00:00.000Z",
  "project": { "project_key": "<16 hex>", "repo_name": "<basename of the repo root>" },
  "events": [],
  "cursor": "<opaque>",
  "has_more": false,
  "sources": [ { "name": "cost", "state": "ok|absent|degraded", "rows_read": 0, "rows_skipped": 0, "rows_filtered": 0, "redactions": 0 } ],
  "warnings": [ { "source": "cost", "code": "source_absent|line_unparseable|file_unreadable|line_too_long|schema_mismatch|ts_invalid|cursor_hint_stale|window_overflow|git_unavailable|source_failed|duplicate_id|internal_error", "detail": "<short; basenames only>", "count": 1 } ]
}
```

**Project and failure rules** (in the doc, tested). (1) The project is resolved with `scopeFromCwd`; if `cwd` is outside a git repo, git is not on `PATH`, or resolution fails, the command exits **2** with code `project_unresolved` (stderr line; with `--json` stdout is `{"schema":"autopilot.events/1","error":{"code":"project_unresolved"}}`): there is no project to report on, which is an environment/usage error, not a source problem, so `project_key` stays a required non-null string in the envelope. (2) A source problem is exit 0 with a warning (E2). (3) A failure outside the per-reader try/catch (merge, cursor encode/decode of a valid cursor, envelope build) is caught by one top-level catch in the CLI branch, plus `process.on('uncaughtException'|'unhandledRejection')` handlers routed to the same fallback and stream `error` events converted to rejections in `jsonl-tail.js`,: exit **0**, `events: []`, `has_more: false`, the **input cursor returned unchanged** (when `--since` was `0`, omitted or an ISO instant, the synthetic cursor that value decodes to) (so a consumer retries from the same place and loses nothing), every source `degraded`, one warning `internal_error` (error name only, no stack or path); a failure of that fallback itself prints a minimal hand-built envelope. The command never ends in Node's uncaught-exception exit 1. Exit codes are therefore only 0 and 2.

**Open sets.** `kind`, `source`, `warnings[].code` and `row_kind` are open sets in the schema (plain `string`, the lists in the doc are the values defined today, no closed `enum`): a consumer skips an unknown `kind` and tolerates an unknown code, source or `row_kind`. Adding a kind, code or optional field is additive under `/1`; removing or retyping one needs `/2`. There is no "/1.1": the pinned string stays `autopilot.events/1`. `repo_identity` (an absolute path) is internal only and never appears in the envelope or in `data`.

**Event** (all kinds):

```json
{ "id": "<kind>:<stable key>", "kind": "<kind>", "ts": "2026-11-02T08:00:00.000Z", "ts_basis": "source|mtime",
  "source": "dispatch_manifest|costs|review_ledger|git_trailer|decision_ledger|run_ledger",
  "project_key": "<16 hex>", "root_run_id": "<id>|null", "run_id": "<id>|null", "data": {} }
```

- `ts` is UTC with millisecond precision (`Z`). **Input grammar** (`src/status/events/instant.js:parseInstant`, one function for every source): an RFC 3339 instant `YYYY-MM-DDTHH:MM:SS[.f{1,9}](Z|+HH:MM|-HH:MM)`, second or finer precision, with the calendar fields surviving a UTC round trip (so `02-30` and `24:00` are rejected, same discipline as `strictIsoMs` in `src/status/decisions-sidecar.js`), normalised to UTC `.sssZ` (sub-millisecond digits truncated). Lenient `Date.parse` forms ("Nov 2", space separator, date only, epoch numbers) are rejected. Per source in use today: manifests `started_at`/`ended_at` are `date -u` second-precision `Z` (`dispatch-hetero.sh:write_manifest`); costs `ts` and decision rows are `toISOString()` (ms `Z`); git `%cI` is second precision with a numeric offset; review `collected_at`/`finalized_at` are `toISOString()`. A timestamp outside the grammar drops that event with warning `ts_invalid`; the feed never invents a time. The only fallback is the review reader's `ts_basis:"mtime"` (mtime is already an instant).
- `id` = `<kind>:` + a key derived only from record content, never from file position, mtime or read order. The same record read from the live file or from `.1` after rotation has the same id.
- Order: ascending by `ts`, ties by `id` (bytewise). Total and deterministic.
- `root_run_id` / `run_id` are filled when the record carries them (`manifest.root_run_id`, ledger `root_run_id`/`run_id`), else null; never derived.

**The 8 kinds** (this table is the contract; `data` lists every field; `?` = may be null or absent; free text is length-capped):

| kind | source and reader (file:function) | `id` key | `data` fields |
|---|---|---|---|
| `dispatch.started` | manifest `<runsDir>/<safe_id>.manifest.json`, written by `scripts/dispatch-hetero.sh:write_manifest` (and the review dispatchers); dir from `scripts/lib/runtime-paths.js:runsDir`. `ts` = `started_at` | `run_id` | `run_id`, `role`, `runner`, `model`, `branch`, `base_sha`, `parent_run_id?`, `depth?`, `timeout_seconds?` |
| `dispatch.ended` | same manifest once `ended_at` and `final_status` are set (`manifest_finalize`). `ts` = `ended_at`. A running or dead-pid manifest yields no ended event (liveness is the watcher's job, `scripts/dispatch-status.js`) | `run_id` | `run_id`, `final_status`, `duration_s` (`ended_epoch - started_epoch`), `role`, `runner`, `model` |
| `cost.turn` | `costs.jsonl` (all rows of one Stop-hook batch share one `ts`) from `scripts/lib/brain-spend.js:costsFileOf`; rows written by `hooks/cost-tracker.js` (`ts, session, model, sidechain?, agent_id?, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cwd`). Project filter: `cwd` resolved to its git common dir (memoised per distinct cwd) equals the project's | `sha256(raw line)[0:24]` + `#n`, n = ordinal of this line among byte-identical lines **counted from the start of the read**. Identical lines share one `ts`, and a hint (E3) never starts after the first line whose `ts` is inside the resume window, so every identical line a window can emit is read by both hinted and unhinted reads and gets the same n (identical rows stay distinct and stable; sum of `cost_usd` equals the file sum, as `cost-digest.js` computes it) | `session`, `model`, `tier` (`scripts/cost-digest.js:tierOf`), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `sidechain` (bool), `agent_id?` |
| `review.collected` | review ledger dirs `<ledger>/review-<phase>/chain.json` (array written by `scripts/hetero-review-loop.js:saveChainEntryLocked`), one event per chain entry. `ts` = entry `collected_at` (E2 writer), else mtime of `g<N>/findings.json` (`ts_basis:"mtime"`) | `<phase_base12>:<phase>:g<generation>`, `phase_base12` = first 12 hex of `sha256(base)` of the lowest-generation chain entry (the phase base, persisted as `phase-<phase>.base`, constant across generations, preserved by an archive copy, and different for two unrelated ledgers that reuse a phase name; the same phase and base is the same review series) | `phase`, `phase_base12`, `generation`, `base`, `head`, `seats` (`[{id,status}]`), `reviewed_seats`, `total_seats`, `findings_total`, `findings_by_severity?` (from `g<N>/findings.json`) |
| `review.finalized` | same entry once `status == "finalized"`. `ts` = `finalized_at`, else mtime of the dispositions snapshot | same as `review.collected` | `phase`, `phase_base12`, `generation`, `verdict?` (from `receipt-<phase>.json` when present), `open_findings?` (count), `reviewed_seats`, `total_seats`, `dispositions_sha256` |
| `qc.verdict` | one `git log --format=%H%x1f%cI%x1f%(trailers:key=QC-Verdict,valueonly,separator=%x1e) --branches HEAD` of the project; one event per commit carrying a `QC-Verdict` trailer (the trailer name `scripts/lib/qc-evidence.sh:qc_has_evidence` greps). `ts` = committer date | commit sha | `commit`, `verdict` (trailer value, first line, <= 64 chars; `PASS` is the only value the gate accepts, others are reported verbatim), `subject` (<= 120 chars, redacted), `basis` (`self_reported`: a trailer is text a model can write) |
| `decision.row` | decision ledgers: default `<git-common-dir>/autopilot/ledger/decisions.jsonl` and `<git-common-dir>/autopilot/work-orders/<root>/decision-ledger.jsonl`, rows per the `scripts/decision-ledger.js` header; filter `row.repo_identity == project` (a row without it in the per-repo default file is included, as `decisions-sidecar.js` does). `ts` = row `ts` | `<decision_id or target_decision_id>:<row_kind>:` + `sha256(canonical row)[0:12]`, or `sha256(canonical row)[0:24]` when neither id exists. Repeated rows with the same `decision_id` and kind but different content/`ts` (`--dedupe` is optional in `decision-ledger.js`) are **distinct events**; byte-identical rows collapse into one (documented under-count) | `basis` (always `self_reported` for every `row_kind`: the ledger has no authenticated writer, `decision-ledger.js append --kind veto|ladder` succeeds for any caller and its header says "nothing verifies the ledger itself", so who wrote a row is a convention, not an observation; a veto's real effect is enforced by `check-blueprint-conformance.js`, not by this feed), `row_kind` (`decision|dispatch|pick|refreeze|veto|note|hypothesis|unknown|ladder`, unknown values kept verbatim), `decision_id?`, `round?`, `class?`, `reversibility?`, `rationale?` (<= 240 chars, redacted, truncation marked), `target_decision_id?` (veto), `rung?`, `result?` (ladder) |
| `run.stage` | run-ledger JSONL(s): paths from manifests' `ledger` field and work-order paths (`src/engine/work-order.js`, `paths.ledger`), read as the rotation-aware set `<p>.N … <p>.1, <p>` (`run-ledger.sh:ledger_scan_files`). Only rows with `kind:"stage"` are events; `heartbeat`, `journal`, `resource`, `directive*`, `worker_event*`, `coordination` rows are counted in `rows_filtered` (volume; the watcher owns liveness) | `sha256(canonical row)[0:24]` | `run_id`, `stage`, `generation`, `status?`, `reason?` (<= 120 chars, redacted), `basis` (`self_reported`: `run-ledger.sh stage-*` is a plain CLI any process can call, so a stage row is a claim by whoever appended it) |

Not exposed on purpose: `repo_identity`, `prompt_file`, `log_path`, `worktree`, `lock_path`, `cwd`, rationale beyond the cap. Free-text fields (`rationale`, `subject`, `reason`) pass a deterministic redaction at read time (`redact.js`: the patterns of `scripts/lib/personal-data-redact.js` plus private-key headers and common token prefixes, replaced by `[redacted]`), counted in `sources[].redactions`.

**Schema doc** (`docs/dev/events-contract.md`): header (projection, not attestation, ADR-0001), the command, envelope, event, the kinds table with one example per kind generated from the fixture by the test (examples cannot drift), id rules, ordering, cursor (written in E3), warnings, versioning rule (additive only), and the **consumer table**:

| consumer | reads (kind.field) |
|---|---|
| C1 `hangar console project <name>`, C2 per-project overview | `dispatch.started/ended` (`run_id`, `role`, `runner`, `model`, `final_status`, `duration_s`) for started/ended counts and last activity (max `ts`). The absence of `dispatch.ended` means "not ended", not "running": C1 takes liveness from `autopilot status runs --json`, never from this feed; `cost.turn` (`cost_usd`, `input_tokens`, `output_tokens`, `tier`, `model`, `session`) for cost and tokens today (UTC day); `review.finalized` (`phase`, `generation`, `verdict`, `open_findings`, `reviewed_seats`, `total_seats`) and `review.collected` (`findings_total`, `findings_by_severity`) for review stats; `qc.verdict` (`commit`, `verdict`, `basis`) |
| C1 `decisions`, C2 decisions panel | `decision.row` (all self-reported; a panel labels vetoes "recorded veto") (`row_kind`, `decision_id`, `class`, `reversibility`, `rationale`, `target_decision_id`) to list autonomous decisions and vetoes (open operator cards come from fleet, not here) |
| A4 anomaly cards | `cost.turn.cost_usd` and `dispatch.ended.duration_s` against the median of the previous N same-`role`/`model` events (cost or time N x median); `dispatch.started` count per source and window for burst; `dispatch.started` repeats per `parent_run_id` lineage and `decision.row` `row_kind=ladder` for ">2 retries"; quota % is not in A1 (§8 Q2) |
| G1 dashboard | every `data.basis=self_reported` value (`qc.verdict`, **all** `decision.row` including veto and ladder, `run.stage`) must not be rendered as verified state (fail closed: only a `basis` value listed as observed in the doc renders as observed; an unknown or missing `basis` renders as "recorded"): show it as "recorded" or "claimed", never as observed; events without `basis` (`dispatch.*`, `cost.turn`, `review.*`) are written by autopilot tooling and are telemetry, not attestation (ADR-0001), and `basis` is an open set (an `observed` value may be added later, additively); `review.finalized.verdict`, `qc.verdict.verdict`, `dispatch.ended.final_status`, `cost.turn.cost_usd`, `run.stage.stage`, plus the rows above; hangar's dashboard source table maps each rendered field to a row of this table |
| all | envelope `schema`, `generated_at` (data age), `cursor`, `has_more`, `sources[].state`, `warnings[]` |

**Fixture** (`scripts/lib/events-fixture.js`): `buildFixture({dir})` creates under a tempdir HOME/TMPDIR (env built from an explicit allowlist, never copied from `process.env`; `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` = a tempdir file):

- a git repo with 3 commits and pinned `GIT_AUTHOR_NAME/EMAIL`, `GIT_COMMITTER_NAME/EMAIL`, `GIT_AUTHOR_DATE`, `GIT_COMMITTER_DATE` (one date with a `+01:00` offset to exercise `%cI`), so commit shas are constants: `QC-Verdict: PASS`, `QC-Verdict: WAIVED` (reported verbatim), none;
- a manifests dir with a finished manifest (second-precision `Z` times) and a running one (yields only `dispatch.started`);
- a costs file with rows for the project, a foreign cwd (filtered), a **removed worktree** cwd (kept via the worktree fallback, E2 step 2), two byte-identical rows, and one row with `ts` `2026-02-30T00:00:00Z` (dropped, `ts_invalid`);
- a **foreign review ledger** (base commit absent from the repo; filtered, with a red-check that removing the filter leaks it) and **two review ledgers sharing the phase name `E1`** with different phase bases (both histories must survive), one collected-only, one finalized;
- a decision ledger with `decision`, `veto`, `ladder`, `note` rows, two rows sharing `decision_id` and kind with different `ts` (two events), and one token-shaped rationale (redacted);
- a run ledger with `stage`, `heartbeat`, `journal` rows and a rotated `.1`.

**Golden ids** are computed in the test by its own `sha256` helper from the literal row text the test wrote (after substituting the tempdir path into rows that embed it: `cwd`, `repo_identity`), never by the code under test; ids that do not depend on a path or on random bytes (commit shas under pinned env, `run_id`, `decision_id`, `phase_base12` of literal base shas) are literal constants. **Doc examples** are generated from the fixture and normalised before comparison (tempdir -> `<tmp>`, `project_key` -> `<project_key>`, `repo_name` -> `<repo>`, `generated_at` -> `<now>`); the doc says so.

Verify:
- The validator `scripts/validate-json-schema.js` supports `oneOf`, `const`, `enum`, `required`, `additionalProperties` and `pattern` (checked in its source); the schema uses only those (a `oneOf` on `kind` with `const`, no `if/then`). `node scripts/validate-json-schema.js --schema schemas/events.schema.json --document <golden envelope file>` exits 0 (the CLI takes `--schema` and `--document`; there is no single-argument form) and the golden events validate against it: `node --test scripts/status-events.test.js --test-name-pattern schema`, which also holds one negative case per kind (a wrong `data` shape must fail, so the schema test cannot pass vacuously).
- `node scripts/lib/repo-layout.js path events_contract_doc` prints the doc path; `node scripts/layout-lint.js` exits 0.

Acceptance: schema file, doc with the full kinds table and consumer table, registry keys and fixture builder committed; schema test green; red-check: delete `ts` from the golden `cost.turn` -> the schema test fails; restore.

### E2 — Source readers (L)

Each reader: `read(ctx, window) -> { events, warnings, stats }`, `ctx = {project, env, home, now}`, `window = {sinceTs, slackMs, hints}`. Read-only with respect to the sources; never throws (`index.js` still wraps each call).

Steps:

1. `src/status/events/jsonl-tail.js`: `readLines(file, {fromOffset, maxLineBytes: 1 MiB, headHash})`. 64 KiB chunks; split on `\n`; a final line without `\n` is not consumed (a write in progress; the next read resumes at its start). A line over `maxLineBytes` is skipped with `line_too_long` and reading continues after the next `\n`; each parse is try/catch -> `line_unparseable`; NUL/binary lines the same. A hint `{offset, head}` exists only for files >= 64 KiB (so the 256-byte head is already stable); it is used only if `sha256(first 256 bytes)[0:12] == head` and `offset <= size`; otherwise a full re-read with `cursor_hint_stale` (never emitted for a file that simply grew from below the threshold: it had no hint). Files under 64 KiB are always read whole. EACCES/EISDIR -> `file_unreadable`. ENOENT -> `state:"absent"`; for a **configured source** (the costs file path, the manifests dir, a review root named by `--review-ledger` or by archive config) one aggregated `source_absent` warning; for an **optional discovery candidate** (a root listed in the pointer file, `.N` rotated segment, a manifest-named ledger already reaped, an unset env list) no warning, counted only in `rows_filtered`. An empty existing file is `ok`, no warning.
2. `sources/cost.js`: stream with hints. `cost-tracker` appends a whole transcript delta per Stop, so rows can carry `ts` earlier than rows already read: a slack of 5 minutes is applied, not an `ts`-ordered assumption. Subagent rows (`sidechain:true`) are included (the console wants subagent cost); `brain-spend.js:isSubagentRow` is NOT used to drop them. Project filter by `cwd` -> `git rev-parse --git-common-dir`, memoised; a cwd that no longer exists is matched by path prefix against the project's worktree paths (`git worktree list --porcelain` plus manifests' `worktree` fields), so rows of a reaped dispatch worktree stay in the feed; a cwd matching neither (including cwds of other repos' deleted worktrees, which cost.jsonl holds host-wide) is counted in `sources[].rows_filtered` only, with no warning and no state change, so it cannot fire on every cold read forever. The `cwd` -> common-dir memo lives inside one `collectEvents` call, not at module level. `#n` is counted from the read start (id rule, E1).
3. `sources/dispatch.js`: list `*.manifest.json` in `runsDir(env)`; skip `panel-*` (plan-review panels, other shape). `stat` first: a finished manifest is immutable, skip it when its mtime < `sinceTs - slack`. Keep manifests whose `repo_identity` equals the project (without it: `rows_filtered`). Emit `dispatch.started` always, `dispatch.ended` when `ended_at` and `final_status` exist. Manifests are written by `mv` of a temp file, so a parse failure is real corruption: `line_unparseable` with the basename.
4. `sources/review.js`: ledger roots = the pointer file `<git-common-dir>/autopilot/review-ledgers.txt` first (its roots are optional candidates: a removed dir is silently skipped and counted `rows_filtered`; lines are deduped and trimmed on read), then repeated `--review-ledger`, env `AUTOPILOT_EVENTS_REVIEW_LEDGERS` (path list), a manifest's `ledger` field when it holds `review-*` dirs, and the archive dir configured as `review_ledger_archive.dir` (resolved as `scripts/lib/review-ledger-copy.js` does; the author records the archive's real directory layout in the doc; a copy of a live ledger keeps the same `phase_base12` and so collapses by id). Project filter: an entry is kept only if its `base` commit exists in the project repo (all distinct bases of the call checked by one `git cat-file --batch-check` process, so a poll spawns at most one git process for this filter); others are counted `rows_filtered`, so a host-wide archive never emits an unrelated repo's history (a separate clone or fork sharing the base commit is indistinguishable and is accepted as the same project; documented limit). Step 0 of E2: before coding this reader the author records the archive's real directory layout (from `scripts/lib/review-ledger-copy.js`) in the doc. Read `review-*/chain.json`; non-array or unparseable -> `schema_mismatch` / `line_unparseable`; skip an entry without integer `generation`. `findings.json` counts are read lazily and only for entries inside the window. Writer change in `scripts/hetero-review-loop.js`: `collect` sets `collected_at` and records the ledger dir in the pointer file with one `O_APPEND` write of one short line, under the existing ledger write lock (readers dedupe and trim lines, so a lost race only duplicates a line), `finalize` sets `finalized_at`; `hooks/tests/hetero-review-loop.test.sh` gets one assertion each (three in all).
5. `sources/qc.js`: one `git log` through `execFileSync` with `GIT_*` env cleaned by `src/status/git-env.js:cleanGitEnv`, timeout 20 s, `maxBuffer` 32 MiB, `--since=<sinceTs - slack>` when a window exists. Out of contract (documented): a commit that becomes reachable later with a committer date older than the window (a merge of commits made elsewhere, clock skew that stops git's date-limited walk) is not delivered by a resumed read; a cold read (`--since 0`) always sees it. A repo or git that disappears after project resolution (rule (1) already exits 2 when either is missing at start) -> `git_unavailable`, state `degraded`. A commit with an empty trailer is not an event.
6. `sources/decision.js`: files per the table with hints; a row needs a strict ISO `ts` and a string `kind`; unknown kinds are kept as `row_kind`; `rationale` truncated to 240 chars.
7. `sources/runledger.js`: ledger paths from manifests' `ledger` and `<git-common-dir>/autopilot/work-orders/*/`; for each, files `<p>.N … <p>.1, <p>`; hints keyed by head hash, not by name, so a segment renamed from `<p>` to `<p>.1` keeps its offset (rotation-stable). Only `kind:"stage"` rows become events.

Verify (in `scripts/status-events.test.js`):
- `node --test scripts/status-events.test.js --test-name-pattern 'source-'` green: each reader returns exactly its fixture kinds with golden ids.
- `degrade-<source>-*` (KR-A1.3) green: absent, empty, mode 000, truncated last line, binary line, wrong-schema row, 10 MB line.
- `bash hooks/tests/run.sh hetero-review-loop` and `node --test scripts/review-input.test.js` green (writer change).

Red-checks (restore the old source, watch the test fail): (a) revert the partial-last-line rule -> `degrade-*-truncated` fails; (b) make the `cost.turn` id the line number -> `resume-after-append` and `source-cost` fail; (c) drop head validation of hints -> `rotation` shows a gap; (d) remove the project filter on cost -> the foreign-cwd row appears, `source-cost` fails; (e) revert the `collected_at` writer or the pointer write -> the new assertions in `hetero-review-loop.test.sh` fail; (f) drop `phase_base12` from the review id -> the two-ledgers-one-phase fixture loses a history; (g) drop `parseInstant` offset support -> the `%cI` commit is dropped and `source-qc` fails; (h) use the file-sum-free id (no `#n`) for cost -> the byte-identical pair collapses and the cost sum test fails; (i) an unhinted-vs-hinted case: two identical cost lines, the second appended after a hinted read, ids must equal the unhinted ids (fails if `#n` is counted from the hint instead of the read start).

Acceptance: six readers and the writer change merged; every degrade case green (including the `source_absent` vs optional-candidate distinction and the token-shaped rationale); no reader imports another reader.

### E3 — Merge, cursor, resume (M)

**Cursor** (`cursor.js`): opaque to consumers ("pass it back verbatim"); `base64url(JSON)` of

```json
{ "v": 1, "t": "<watermark ISO ms>", "s": 300000, "w": [["<12 hex of sha256(id)>", 1793000000000]], "f": 0, "e": null, "h": { "<source>:<12 hex head hash>": 12345 }, "p": "<project_key>" }
```

- `t` = `ts` of the last returned event; `s` = slack in ms (default 300000, the late-row tolerance); `w` = `[id hash, ts in epoch ms]` pairs, one per **delivered** event with `ts >= t - s`.
- **Coverage floor `f`** (ms): the lowest `ts` that `w` is complete for. Every read uses the floor `L = max(t - s, f)`; `f` only moves forward. Next `f` = `max(f, newT - s_page)` where `s_page` is the slack this page actually kept (below the default only on an overflow page). So after an overflow the window regrows only as `newT` advances past `f`, and a window never reopens history whose ids were pruned from `w`.
- **Filter**: re-read every source from `L`; merge; drop an event iff its id hash is in `w` or its `ts < L`; return the rest in `(ts,id)` order. (There is no `<= (t, last id)` comparison: `w` already holds every delivered id inside the window, so a late row with `ts` in `[t - s, t)` that was not delivered passes the filter and is delivered once; a row delivered on an earlier page is in `w` and is not repeated.)
- **Next `w`** = (previous `w` pruned to pairs with ts `>= max(newT - s, next f)`) union (this page's ids with `ts >= newT - s`), where `newT` is the last returned event's `ts`. An empty page keeps `w` and `t`.
- Late rows: delivered once, in the next page, therefore after later-`ts` events of the previous page; this is the only ordering exception (KR-A1.2). A row arriving more than `s` after its `ts` is out of contract (documented).
- `--since <ISO>` (and `0`) builds a synthetic cursor `{t: ISO + s, s, w: []}` so the lower bound `t - s` is exactly the requested instant.
- **Hints `h`** = per-file byte offsets keyed by head hash, an optimisation only: deleting `h` yields the identical id set and order, only slower. Each event carries its source byte offset internally. For a file the next hint is the smallest of (a) the start offset of any line that was read but not delivered (cut by `--limit` or the page cap) and (b) the start offset of the first line whose `ts >= newT - s`. A hint is therefore never past an undelivered line or past a line the next window can still emit, which is also what makes the `cost.turn` `#n` rule hold. It stays valid across append (offset grows), rotation (the head hash follows the file to `.1`) and manifest reaping (a vanished manifest's events are behind `t - s`).
- **Size bound** (true figures: a pair is about 34 bytes of JSON, so 1 000 pairs are about 34 KB, about 46 KB as base64url): `w` is capped at **1 000** pairs and `h` at **16** entries (hints only for files >= 64 KiB, largest first; smaller files are cheap to re-read, which also removes short-head instability), so a cursor is at most 64 KiB, far below the 128 KiB single-argument limit. The console may also pass it on stdin (`--since -`). `s` is recomputed on every page and never carried forward: each page starts from the default `s` (300 000 ms) and halves it only as far as this page's `w` needs to fit the cap; such a page carries warning `window_overflow` (late rows older than `newT - s` are out of contract for that page only, and the warning says so). The default `s` comes back only as `newT` moves past the coverage floor `f` (below), never by reopening pruned history. Termination: with `s` down to 0 only the final `ts` group could remain; if that single group still exceeds the cap, the page is cut before the group when it is not the first group of the page, else (one `ts` instant holds more than 1 000 events, e.g. a cost batch) the cursor omits that group from `w` and carries `e` = `[ts of the group, greatest delivered id]` (bytewise order within a `ts` group is by `id`) and keeps it, whatever `t` becomes, until the group's `ts` falls below the floor `L`: the filter additionally drops events with `ts == e[0]` and `id <= e[1]`. In that single case a late row at exactly the watermark instant with a smaller id is out of contract. In-order events are never duplicated or lost.
- `p` binds the cursor to a project; a cursor of another project exits 2 `bad_cursor`.

**Merge** (`merge.js`): concatenate reader outputs, drop events failing the envelope check, sort by `(ts, id)`, collapse equal ids (the id rules make equal ids mean the same record; two readers producing one id is a bug: keep one, warn `duplicate_id`), apply the cursor filter, then `--kinds`, cut at `--limit`, compute `has_more` and the next cursor from the last returned event. An empty page returns the input cursor unchanged (only `generated_at` moves).

**`index.js`**: assembles the envelope; runs the readers in a fixed order each in its own try/catch (`source_failed`, state `degraded`); fills `sources[]` stats.

Verify:
- `node --test scripts/status-events.test.js --test-name-pattern 'resume-|order-|cursor-'` green: pages of 1, 3, all concatenate to the full list; resume after (i) appending cost rows, (ii) appending a decision row with `ts` inside the slack but before the watermark (delivered exactly once in the next page; the rows of the earlier pages in the window are not repeated), (ix) pages of 1 with hints equal pages of 1 without hints (a page cut by `--limit` never leaves an undelivered line behind the hint), (x) two ledgers sharing phase `E1` keep both histories across resume, (iii) rotating the run ledger (`mv ledger ledger.1`, new live file, new row), (iv) finishing the running manifest, (v) deleting `h` from the cursor (same result), (vi) a cursor of another project (exit 2), (vi-b) `cwd` outside any repo and a `PATH` without git (exit 2, `project_unresolved`, JSON error object), (vi-c) an injected fault in `merge` and in cursor encoding (test seam `collectEvents({deps})` in-process, and for the real binary env `AUTOPILOT_EVENTS_TEST_FAULT=merge|cursor|envelope`, honoured only when `AUTOPILOT_TEST_ALLOW_EVENTS_FAULT=1`, the repo's existing test-seam pattern): exit 0, `internal_error`, input cursor echoed, a following normal call with that cursor delivers the full set; (vii) a garbage cursor (exit 2), (viii) 5 000 events in one second and 1 500 at one `ts` (`window_overflow`, `s` shrinks, `e` used, still no duplicate or gap), and a cursor-size assertion <= 64 KiB at the KR-A1.5 sizes.
- Determinism: two runs on an unchanged fixture give byte-identical `events` and `cursor`.

Red-checks: (z) remove the top-level catch -> case (vi-c) exits 1; remove the `project_unresolved` check -> case (vi-b) exits 1 or crashes; (a) sort by `ts` only -> `order-tie` fails; (b) drop events `<= (t, last id)` as well (the earlier rule) -> case (ii) loses the late row; (s) carry the shrunken `s` forward -> case `cursor-s-restore` (an overflow page, then quiet pages: once `newT` passes `f + default s` a late row inside the default slack is delivered) fails; (s2) drop `f` (restore the default slack at once) -> case `cursor-overflow-nodup` (1 000 events at instant T, one at T+1 s, then a quiet page: no event at T is delivered twice) fails; (s3) keep `e` only while `t == e[0]` -> the same case with an oversized group after `t` advances shows duplicates; (c) `w` holding only the current page's ids -> a duplicate from an earlier page appears; (d) key hints by file name -> `rotation` fails; (e) set the hint to EOF after a cut page -> case (ix) shows a gap; (g) an equal-`ts` group of 1 500 events: pages resume with `e`, no duplicate and no gap, cursor <= 64 KiB (red-check: drop `e` -> duplicates or no termination); (f) drop the per-id `ts` pruning -> `w` grows past the cap and `window_overflow` fires in the plain resume case.

Acceptance: KR-A1.2 (as restated, set equality plus the stated order exception) and KR-A1.3 met on the full path; the cursor section is written into the schema doc before E1 is declared frozen.

### E4 — CLI wiring, gate, bench, docs (M)

1. `src/status/cli.js`: add the `events` branch in `runStatusCli` before the unknown-subcommand fallthrough; flags of E1; exit `0` (with or without warnings), `2` usage or `bad_cursor`; extend the unknown-subcommand message. `bin/autopilot.js`: add `events` to the `status` usage line. `bin/autopilot.js` dispatches `status events …` through a fast path at the very top, before `ensureTmpdir(process.env)` (line 7, which creates a missing `TMPDIR` with mode 0700) and before the eager top-level requires of the engine, runners, readiness and session-mode modules, so the real process has no side effects from those and starts fast; an executable-level test runs the real binary with `TMPDIR` set to a nonexistent path and asserts it stays nonexistent while the envelope is returned. The events modules are `require`d lazily inside the branch (the `cli.js` header explains `hooks/tests/status-finish-followup` copies `cli.js` alone into a hermetic repo).
2. `scripts/check-events-contract.js` (stderr + exit codes): (i) every property of every `data` shape in the schema appears in the doc kinds table; (ii) every `kind.field` in the doc consumer table exists in the schema; (iii) the doc examples equal the fixture's golden events after the documented normalisation (runs `buildFixture`); (iv) the doc path resolves through the registry; (v) against the committed baseline `schemas/events.baseline.json` (written at merge: the envelope fields, the event-level fields, the `project_unresolved` error object, and per kind each field with JSON type, required or optional, nullable) every baseline field is still present with the same type and nullability, and only additions pass. Exit 1 naming the first gap of each class.
3. Wire the gate where other `check-*.js` gates are listed (`scripts/doc-drift-gate.js` reads the registry; add it there only if that file holds a list of gates, otherwise it stays a standalone script run by the test).
4. `scripts/status-events-bench.js`: synthetic generator (no real data) for the KR-A1.5 sizes, cold and warm reads, prints wall time, RSS and bytes read per source, plus one line timing a warm resume **through the real binary** (`node bin/autopilot.js status events --since <cursor> --json`) against the KR-A1.5 bound.
5. `docs/scripts-inventory.md` rows (index entry only) for the three new scripts; `CHANGELOG.md` Unreleased entry.
6. Live proof: transcript of `autopilot status events --json --limit 5` and a resume from its cursor in this repo, paths scrubbed to `<tmp>` / `<home>`, under `docs/plans/evidence/2026-11-02-oc-a1-events/`.

Verify:
- `node --test scripts/status-events.test.js` (whole file) green; `node scripts/check-events-contract.js` exit 0; `node scripts/status-events-bench.js` meets KR-A1.5; `bash hooks/tests/run.sh status-finish-followup` green; `node scripts/layout-lint.js` exit 0; `bash hooks/tests/run.sh --parallel 4 status` for the neighbouring status suites.
- `readonly-*` (digests the whole sandbox HOME and TMPDIR as well as repo, live dir and sources; includes the nonexistent-`TMPDIR` case and a case where the dispatch runs dir is absent and must stay absent; permission cases are skipped with a logged reason when `getuid()` is 0): before/after tree digest of repo, live dir and every source dir equal, source dirs chmod a-w, exit still 0.

Red-checks: remove one doc row -> `check-events-contract.js` exit 1 names it; add an undocumented schema property -> exit 1; retype one field in both schema and doc -> exit 1 on the baseline check; rename a consumer-table field -> exit 1; add a `fs.writeFileSync` in a reader -> `readonly-*` fails.

Acceptance (A1 as a whole, from the master plan): a fixture repo yields each event kind once; cursor resume returns no duplicate; the schema doc lists every field the console uses; every KR-A1.x row has a transcript under `docs/plans/evidence/2026-11-02-oc-a1-events/`.

## 5. Test / validation

| What | How | Gate |
|---|---|---|
| each kind once, golden ids | `node --test scripts/status-events.test.js` (fixture per test in a tempdir; the test env is an explicit allowlist, not a copy of `process.env`: `HOME`, `TMPDIR`, `AUTOPILOT_COSTS_FILE`, `AUTOPILOT_DISPATCH_RUNS_DIR`, `AUTOPILOT_CONFIG_FILE`, the live-dir variable and `AUTOPILOT_EVENTS_REVIEW_LEDGERS` point into the tempdir or are unset; `AUTOPILOT_ROOT_RUN_ID` and every `GIT_*` are unset except the pinned fixture ones; `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` a tempdir file; `ctx.env` is passed everywhere; never the real `~/.claude`, `~/.autopilot`, live dir or dispatch dir) | script |
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
| Cursor grows without bound or breaks when a source is rewritten | hints optional, keyed by 12-hex head hash, only for files >= 64 KiB and at most 16; `w` capped at 1 000 with `s` shrink and the `e` floor; size assertion <= 64 KiB; deleting `h` gives the same result |
| Review ids collide across ledgers that reuse a phase name | `phase_base12` in the id; two-ledger fixture; red-check (f) |
| Review events have no timestamp; mtime drift (archive copy, `touch`) reorders history | additive `collected_at`/`finalized_at` in E2; mtime only as flagged fallback; documented limit |
| One corrupt line kills the console | per-line and per-source try/catch; exit 0 always; 7 degrade cases per source |
| A 200k-row costs file re-read every poll | offset hints, mtime pre-filter, bound and bench in KR-A1.5 |
| Host-wide sources leak other projects' activity | project filter on every source (`cwd`, `repo_identity`), a foreign row per source in the fixture |
| Secrets, prompts or home paths leak through events | `repo_identity`, paths and prompts not exposed; free text capped and redacted at read time; warnings carry basenames only; a test greps the full fixture envelope for home/tmp path and token patterns, and a token-shaped rationale row must come out redacted |
| The feed is mistaken for proof (ADR-0001 breach) | header of doc and CLI help say "telemetry projection, not attestation"; no signature or chain field exists |
| The relayout moves a source path under a reader | repo paths only via `repoLayout.path(key)`; runtime paths only via their resolvers; `layout-lint` in the gate |
| Kind creep | `/1` additive-only; a new kind needs doc row, schema row and fixture record in one commit (gate enforces, and the frozen baseline blocks removals and retypes) |
| `cli.js` gains a heavy require and breaks the hermetic status test | lazy require; `status-finish-followup` in E4 |

## 7. Out of scope

- Fleet task events, hippo events, hub data (the console merges those itself; A1 is autopilot's own sources).
- Quota percentage or `engine-capability-state` samples (subscription CLIs expose no remaining %, see the HONESTY CONTRACT in `src/status/cli.js`); A4 uses `autopilot status quota --json` (decided §8 Q2); a later `quota.observed` kind is an additive change under `/1`.
- Plan-review panel manifests (`panel-*`), `heartbeat`/`journal`/`resource`/`directive*` run-ledger rows, hook audit logs.
- A push channel (`--follow`), a persistent event store, any write to a source, any use of the feed as a gate or verdict input.
- Cross-host aggregation. The feed is read only locally: the console (C1 CLI, C2 backend) runs `autopilot status events` on its own host, and a remote host's feed reaches the console only by being run there or inside an F1-defined opaque payload; A1 adds no `contracts/` or `gen/` entry and so needs no second hub contract change. Merging by `project_key` and host is the console's job.
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
- Generation 2 (2026-11-02, terminal at the cap): sol READY, argon READY, opus CONDITIONAL; 9 findings, 2 blocking. Dispositions in `docs/plans/2026-11-02-oc-a1-events-contract.g2-dispositions.json`: both blockers accepted and folded by depth-0 (all `decision.row` and `run.stage` basis `self_reported`; `project_unresolved` exit 2 and top-level `internal_error` catch with unchanged cursor, both tested); the 7 non-blocking findings folded (cursor bounds and `e` floor, pointer roots optional and `cwd_unresolved` as a count, review project filter, binary fast path and wider read-only digest, frozen baseline gate, hint threshold), none refuted.
- Generation 1 (2026-11-02): CONDITIONAL (sol_chair CONDITIONAL, argon_deep READY, opus_skeptic CONDITIONAL); 20 findings, 6 blocking (F1–F6). Dispositions in `docs/plans/2026-11-02-oc-a1-events-contract.g1-dispositions.json`: all blockers accepted and folded (`source_absent` vs optional-candidate rule; per-id-`ts` cursor window and restated KR-A1.2; `#n` counted from the read start with the hint invariant; test-computed golden ids, pinned git env, normalised doc examples; `parseInstant` RFC 3339 grammar with offsets; `phase_base12` review id and distinct repeated decision rows); the 14 non-blocking findings folded, none refuted.
- Review artifacts: `docs/plans/2026-11-02-oc-a1-events-contract.g1-artifact.json`, `.g2-artifact.json`. Receipt: `check-phase-review-receipt.js --plan-file <plan at fb7dfa055> --plan-artifact <g2 artifact> --dispositions <g2 dispositions>` exit 0 (2026-11-02). Generation 2 terminal at the cap: sol READY, argon READY, opus CONDITIONAL; both g2 blockers accepted and folded in df5dc307f (not seat-reviewed).
- Closure review (logical id `autopilot-oc-a1-events-closure`, 2026-11-02): g1 CONDITIONAL (1 blocker, 8 non-blocking), folded in e3300db40; g2 CONDITIONAL at the cap (2 blockers on the cursor fold: coverage floor `f` added; 4 non-blocking), all accepted and folded by depth-0. Receipt over the g2 as-reviewed plan (e3300db40) exit 0. Artifacts: `.closure-g{1,2}-artifact.json`, `.closure-g{1,2}-dispositions.json`.
- E1 implementation, PM ruling G7 (2026-11-03), recorded as plan deviations and decisions: (1) a third registry key `schemas_dir: 'schemas'` was added beside `events_contract_doc` and `events_schema`: registering a path under `schemas/` makes that area governed in `scripts/layout-lint.js`, which then fails the sync-manifest entries that point into `schemas/` (deviation from the two keys named in the file map, accepted); (2) the "canonical row" of the id rules is the validator's `canonical()` (now exported by `scripts/validate-json-schema.js`), one implementation shared by the fixture and, in E2, the readers; (3) `cost.turn` `#n` is 1-based and the raw line excludes `\n`; (4) `run.stage` `data.status` = `row.status`, else `row.state`, `status` wins when both exist and differ, with reader warning `status_state_conflict` (implemented in E2); (5) `review.collected` `findings_total?` / `findings_by_severity?` are optional: a missing `g<N>/findings.json` keeps the event, omits the fields and adds reader warning `findings_missing` (implemented in E2), an event is never dropped; (6) line 185 now names the validator's real `--schema` / `--document` form. Evidence: `docs/plans/evidence/2026-11-02-oc-a1-events/e1-contract.txt`.
