# Plan — Bind the work lifecycle into fleet's mechanized flow (stage graph export, receipt re-derivation, dependency alarms)

> Status: revision 3 (generation-1 and generation-2 findings folded in; see Review log). Owner: autopilot lane (planner: chair). Consumers: fleet--claude (interface review, done 01M7RS0G), PM (freeze), fleet scheduling gate 01M7PMGYS50QEN5JSE8A1K39FA.
> Branch: `plan/fleet-stage-graph`. Frame: plan only; no implementation ships with this file. Version stays 3.0.0-alpha line (no bump). Times are Taipei (UTC+8).
> Logical plan id: `fleet-stage-graph-binding`. Fleet-Task: 01M7RC6HRD912JNF80GH74FC32.
> Fleet-side facts below (file:line) are quoted from fleet--claude's review 01M7RS0G of `plan/fleet-stage-graph@142f1b2ca`, fleet origin/develop; autopilot-side facts were re-verified in this repo.

## 0. Context / thesis

Source (operator, verbatim):

- 「你忘記做 brainstorm / survey -> plan -> plan loop review -> dev-flow -> qc gate -> finish flow 這件事情，是不是可以綁到在 fleet pm sys 裡面的機械化流程中? 只是那個 harness flow graph 可能要設計一下?」
- 「這種查證應該讓 pm sys 自動化? 看是做成 script 還是怎樣? 理論上中間卡住應該要告警你? 看怎樣把它系統化?」
- 「{pm, fleet, autopilot, capacity, hangar} 整套系統根本是在營運一間公司的內部管理機制了?」

What already exists in this repo (do not re-invent):

- The graph: `references/stage-graph.json` (schema `autopilot.stage-graph/1`) with 12 `node_ids`, per-size walks XS..XL, bug and urgent variants, 4 loop-backs, `bump_limits`, a `writers` map. Query CLI `scripts/stage-graph.js` (`nodes|next|validate|limits`).
- The telemetry writer `scripts/stage-advance.js`: each transition appends `[stage:<coarse>/<node>] <unit>` to the fleet task via `scripts/lib/fleet-task.js progress()` (stage-advance.js:157-160). `COARSE_OF_NODE` is at stage-advance.js:111-124. Fleet receives text only.
- Marker work-order fields `fleet_task_id, wo_task, wo_size, wo_plan, wo_state, wo_fetched_at, plan_receipt` (stage-advance.js copy list; `scripts/session-mode.js` `fetchAndResolveWorkOrder` / `applyWorkOrderToMarker`). `scripts/lib/work-order-plan.js` parses only `Size:` and `Plan: <path>@<sha>|plan-first` (work-order-plan.js:15-17); it parses no bug, urgent or explore.
- Lane-local enforcement: for wo_size M/L/XL stage-advance refuses `implement` without a plan receipt (`PLAN_RECEIPT_REQUIRED`, `PLAN_BLOB_MISSING`, stage-advance.js:841-884); for L/XL also a passing plan-review receipt (`verifyLargePlanReview`, :698, via `scripts/check-phase-review-receipt.js` Mode B). Code-review receipts: same script Mode A, which requires `--phase-base` (check-phase-review-receipt.js:113).
- The PM plan gate: opt-in stem `pm-dispatch-plan-guard` (`hooks/opt-in-manifest.json:24`), the dispatch branch of `hooks/fleet-send-work-order-guard.js`, test `hooks/pm-dispatch-plan-guard.test.js`.
- finish-flow: the merge commit's last paragraph carries `QC-Verdict: PASS (reviewer <id>, <YYYY-MM-DD>)` and one `Used:` line; the work branch is deleted after the merge (skills/finish-flow/SKILL.md rows "Merge", "Delete merged branch").
- Fleet already has (per 01M7RS0G): `Task.stages` / `StageState` filled by `observe_progress` from `[stage:<coarse>/<fine>]` (tasks.rs:250, :820), `used_required` / `used_na_reason` checked at the assignee courier before send (stages.rs:419, courierd/src/lib.rs:3870-3890), `Task.last_merge` filled from Fleet-Task / QC-Verdict / Review-Generation trailers (task.proto:182, courierd/src/task_scan.rs:557), `stage_cap_ms` / `whole_cap_ms` / `UNSTAGED_CAP_MS` (stages.rs:288, :10), lease `accept_by_ms` (task.proto:249), `Task.schedule` with `ScheduleEdge` and `ScheduleFinding` (task.proto:388).

The gap: every autopilot check runs inside the lane's own session, so a lane that skips the flow, runs a harness without Claude hooks, or never ran `session-mode.js set --fleet-task` (nothing adopts automatically) is invisible to fleet; and dependencies between tasks are prose. This plan moves verification to the fleet side of the boundary by re-derivation from git and receipt files (ADR-0001), and makes a plan's phase table a source of fleet tasks and edges.

## 1. Problem

1. A dispatched M+ task can be accepted with no plan, no plan-loop verdict, no qc receipt or an un-reviewed merge, and nothing outside the lane notices (the slip behind the operator's first quote).
2. A plan freezes with a phase table, but fleet learns nothing from it. Real case 1: codeforge task 01M7MD5Z wrote "waiting on P2" in text; no P2 task existed on fleet, no alarm fired, the PM chased it for three rounds. Real case 2: frozen plan e6f6623a gives phase P5 to autopilot (S2 `p5/pm-inbox-plan-e6f6623a.md:224`), but no autopilot task for P5 existed and nothing reported it.
3. The graph lives only in autopilot, so fleet cannot know which stage is legal or what evidence a stage owes.

## 2. OKR / KRs

- O: a fleet task of size M+ cannot be accepted unless the assignee courier re-derived the evidence the graph requires for that size, type and stage.
- KR1: the verifier, run with each single piece of evidence removed, refuses with a lowercase code (negative control per evidence row, section 4 P2), and passes on one real finished task.
- KR2: freezing a plan makes one fleet task per phase with task-id edges; a phase whose owning lane has no matching task is reported at freeze to the plan's parent task and the PM. Acceptance replay: plan e6f6623a P5 is undetected before and detected after (P4).
- KR3: after P8 the PM plan-gate hook is gone and nothing else changed behavior.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- ADR-0001: verify by independent re-derivation from git and receipt files. No hash chains, ledgers, witness receipts, attestation or trust roots are added.
- autopilot is the only source of the stage graph; fleet never hand-copies node lists or evidence tables.
- Node >= 20.10, built-ins only for every new autopilot script; bash only for pure git glue.
- Every new check ships a negative control shown red before green (evidence-discipline section 58).
- No hosted CI. No version bump. New JSON schemas: exactly `schemas/fleet-flow.schema.json` (P1) and `schemas/plan-phases.schema.json` (P4); the one new data input is `references/fleet-flow-evidence.json` (P1).
- Text such as "waiting on X" never counts as a dependency; only task-id edges do.
- No new fleet fields where an existing one fits (fleet design principle); errors use fleet's `wire_error` / `ScheduleFinding`, lowercase snake_case codes.
- A failing component (missing or stale export, absent verifier) degrades and warns once; only credentials, cert pins and `_access` fail closed. A verifier that ran and found evidence missing refuses; that refusal is the product, not a component failure.
- Migrate, do not run two systems: the PM plan-gate hook retires only after fleet's dispatch refusal is observed live (P8).

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`. Adds one versioned export (`autopilot.fleet-flow/1`), one verdict format (`autopilot.fleet-flow-verdict/1`), one phase format (`autopilot.plan-phases/1`) and new scripts; `stage-graph.json`, marker fields and `[stage:...]` lines are unchanged except P5 (M gains `plan-review`, conditional on the P0 eval). P8 removes the `pm-dispatch-plan-guard` opt-in stem (consumer: PM console only; fleet refusal lands first).
- **Dependency decision**: `none`.


## 3. File-structure map

| File | Responsibility | Phase |
|---|---|---|
| `scripts/export-fleet-flow.js` (new) | derive `autopilot.fleet-flow/1` from its four inputs; `--check` regenerates in memory and byte-compares the complete canonical content | P1 |
| `references/fleet-flow-evidence.json` (new, hand-edited) | the evidence rules of (b) as data: source input of the export | P1 |
| `references/fleet-flow-graph.json` (new, generated), `schemas/fleet-flow.schema.json` (new) | the versioned export fleet reads, and its schema | P1 |
| `scripts/stage-advance.js` (edit) | export `COARSE_OF_NODE` (:111-124) so the generator imports it instead of copying it | P1 |
| `scripts/sync-manifest.json`, `scripts/sync-all.sh` (edit); `platforms/codex/plugin/` (regenerated by `scripts/sync-codex-plugin-skills.sh`; ritual `sync-codex-plugin-skills` triggers on `scripts/`, `references/`, `schemas/`, `hooks/hooks.json`) | gate export drift in `--check`; the Codex mirror must be regenerated and staged in every phase that touches those paths | P1-P4 |
| `scripts/fleet-flow-verify.js` (new) | rows of (b); one JSON verdict, contract in (e) | P2 |
| `scripts/lib/work-order-plan.js` (edit) | also parse the title SizeTag (`[bug S]`, `[!L]`) with fixtures shared with fleet's `size_of_title` | P2 |
| `scripts/session-mode.js` (edit) | `set --session-id <id>` (passes `explicitId` to `writeTarget`, today none of the five `writeTarget()` calls at :655/:695/:817/:1195/:1343 can); `fetchAndResolveWorkOrder` stores `wo_state: unresolved` when the title has no size (today :993-1000 stores `resolved` with `wo_size: null`) | P3 |
| `scripts/work-order-adopt.js` (new); `hooks/work-order-adopt.js` (new; the filename stem IS the stem: `check-hook-inventory.js:71-75` derives it from the filename, :184-185 exits 2 when the manifest lists a stem not wired), `hooks/hooks.json`, `hooks/opt-in-manifest.json`, `hooks/README.md` | marker write at the start of a task | P3 |
| Hook-tally and config registries moved by a new hook: `.claude-plugin/plugin.json`, `plugin.json`, `.claude-plugin/marketplace.json`, `CLAUDE.md`, `README.md`, `README.zh-TW.md`, `docs/dev/hook-harness-matrix.md`, `scripts/lib/config-keys.json`, `docs/guide/settings-reference.md` | generated or checked by `sync-all.sh`; its `--check` red list is the authority for the exact set | P3 |
| `references/multi-agent-portability.md` (edit) | section "fleet work-order lanes": the CLI sequence of (f) | P3 |
| `scripts/plan-phase-expand.js` (new), `schemas/plan-phases.schema.json` (new), `references/plan-template.md` (edit) | phase block parse, legacy-table parse, freeze-time owner-task check | P4 |
| `references/stage-graph.json`, `scripts/stage-graph.js` tests, profiles chain (edit) | M gains `plan-review` | P5 (conditional) |
| `hooks/fleet-send-work-order-guard.js`, `hooks/pm-console.test.js` (new, moved cases), `hooks/opt-in-manifest.json`, `hooks/hooks.json`, `hooks/README.md`, `docs/guide/settings-reference.md`, `CHANGELOG.md`, tests | retire the dispatch branch and stem | P8 |
| `scripts/CLAUDE.md`, `docs/scripts-inventory.md`, `skills/dev-flow/SKILL.md` table | wire each new script (dead until wired) | each |

## 4. Phases and answers

### (a) Accepting a dispatch writes size and fleet_task_id into the marker (INTERNAL, autopilot)

Today `session-mode.js set --fleet-task <id>` fetches the task, parses the title and stores `wo_*`, but nothing runs it automatically, `set` has no `--session-id`, and a title without a size is stored as `wo_state: resolved`. P3 adds `scripts/work-order-adopt.js --task <id> [--session-id <id>]` (and the two `session-mode.js` edits of section 3):

1. Reads `fleet task show <id> --json`; size, bug and urgent come from the title SizeTag (fleet's `size_of_title`, tasks.rs:855; parsed in `work-order-plan.js` once P2 lands, until then only a `Size:` line resolves), plan from the `Plan:` line.
2. `--new-task` is passed whenever the live marker is non-empty and its `wo_task` differs from `<id>`, that is when it holds ANY task-scoped state (a different `fleet_task_id`, or `stage`, `size`, `bug`, `urgent` left by a local or backlog task); `set --new-task` drops the prior position and task-scoped fields (session-mode.js:1141, :1200-1238). Without it size only moves up (:1257) and the entry transition exits 3 (stage-advance.js:921). The same task again is a refresh, no `--new-task`.
3. Then `stage-advance.js --to <entry>`, entry from `stage-graph.js nodes`. If the work order is unresolved (`wo_state: unresolved`, no size, or a conflict) it writes that state, prints one stderr line, exits non-zero and does NOT call stage-advance. `--session-id` is passed through to `set` and `stage-advance.js`.

Trigger. A lane's "accept" is not `mcp__fleet__task_accept` (that tool is the requester accepting a reported result). The hook `hooks/work-order-adopt.js` fires PostToolUse on the lane's first `mcp__fleet__task_progress` or Bash `fleet task progress <id>` whose id differs from the marker's `fleet_task_id`. P3 opens with a probe (one dispatch to a canary lane, record which tool call a Claude lane makes on receipt) and fixes the matcher to what it shows. New hook = opt-in stem in `hooks/opt-in-manifest.json`, wired in `hooks/hooks.json`, listed in `hooks/README.md`, counted by `check-hook-inventory.js`. Other harnesses: section (f). Fleet does not depend on the marker: (b) re-derives without it.

### (b) What fleet re-derives, and when (INTERFACE, see (e))

Where. The assignee's courier, at the same place as `used_required` (the repo exists only on that host; the hub knows no member or repo). Cheap rows run in Rust there (plan blob, `Task.last_merge`, `Used:` token shape); rows that read receipt files call `node <autopilot-pin>/scripts/fleet-flow-verify.js` as a subprocess, path from courier config (a courier never launches node otherwise; non-login shells can find an old `/usr/bin/node`, fleet gotcha G28). Missing node or script degrades and warns once. P2's fixtures are the contract both implementations pass.

When. Re-derivation runs when the lane reports (`task_result`) and again at the requester's `accept`, against git on the assignee host plus the blobs the lane uploaded (progress lines carry no blobs). Per-transition stage order is the only check that runs on `[stage:...]` lines, from `Task.stages` (tasks.rs:250). The code-review row can run before any merge exists: it uses the intended target and the candidate tip, and is reconciled against the real merge at finish (rows 3 and 5). Refusal: one missing item is fleet `wire_error {"error": <code>, "detail": ...}`; several are a `ScheduleFinding` array. Codes are lowercase snake_case.

Receipts outside git. Plan-review artifacts (`~/.autopilot/plan-review/...`, dispatch-plan-review.js:81) and code-review ledgers are lane-local and never pushed (`.githooks/pre-push` blocks evidence paths). The lane uploads each as a bundle with `fleet upload` and lists `Receipt: <kind>=<sha256>` in `task_result` (kinds and bundle format: (e)). A receipt a lane merely names but that does not bind to git bytes fails its row.

| # | Event | Sizes | Fleet re-derives (command / source) | Missing -> code |
|---|---|---|---|---|
| 1 | leaving `plan` | M, L, XL | `Plan: path@sha`: `git cat-file -e <sha>:<path>`, sha256 of that blob. `plan-first`: the plan path is the one file added under `<plans_dir>` (`scripts/lib/repo-layout.js`) in `<phase-base>..<tip>` whose name matches `^\d{4}-\d{2}-\d{2}-.+\.md$`, excluding `explore-synthesis.md` (stage-advance.js:94) and the INDEX file (plan-template step 0 registers it before the plan); its adding commit must be an ancestor of or equal to the first commit touching any path outside `<plans_dir>`, `<plans_evidence_dir>` and INDEX (`git rev-list --reverse`, `git diff-tree`). The branch name is never resolved, finish deletes it | `plan_receipt_required` / `plan_blob_missing` / `plan_not_first` |
| 2 | leaving `plan-review` | L, XL (M if P5 lands) | `plan-review` bundle holds the four files Mode B reads (check-phase-review-receipt.js:298-455): `gN.json`, `gN-disp.json`, the plan, the rubric. `check-phase-review-receipt.js --plan-artifact gN.json --dispositions gN-disp.json --plan-file <plan> --rubric-file <rubric>` must exit 0; Mode B never reads `verdict`, so the verifier also requires the final artifact's `verdict` not blocking, `plan_sha256` = sha256 of row 1's blob, and, when the final disposition holds an `accepted_blocker`, that the plan blob differs from the reviewed `plan_sha256` (the repair) and `task_result` names the PM ruling id | `plan_review_required` / `plan_review_unrepaired` |
| 3 | leaving `code-review` (pre-merge) | M, L, XL; urgent-low: see row 7 | `code-review` bundle = the ledger dir. `--phase-base` is derived, never lane-supplied: `git merge-base <target> <tip>`, where `<target>` is the `Target:` line of the work order, else the repo's integration ref (`resolve-project-paths.sh`), and `<tip>` is the candidate branch tip resolved once to a full sha. Mode by bundle shape: `--phase <id>` when the ledger holds exactly one phase (else `code_review_ambiguous`); `--packets` when `packets.json` is present; `--chain` when `chain.txt` is present; `--post-head-ledger` + `--post-head-target <target>` when `post-head-ledger.json` is present (generation cap; its PM ruling id must appear in `task_result`). All via `check-phase-review-receipt.js ... --repo-root <repo>`; exit 0 on the tip | `code_review_receipt_missing` / `code_review_ambiguous` |
| 4 | leaving `qc-gate` | all | no command: no merge exists yet. Stage order only: `Task.stages` against the export's walk | `entry_stage_skipped` / `diagnose_skipped` (warn) |
| 5 | finish: merge sha | all | discovery, not assertion: `Task.last_merge` if present, else `git log --first-parent <target> --format='%H%x09%(trailers:key=Fleet-Task,valueonly,separator=%x2C)'` (add `--merges` for M+) and keep rows whose trailer equals the task id exactly. 0 rows: refuse; more than one distinct sha: refuse. QC and Used evidence are read from that selected commit only. Then `git merge-base --is-ancestor <merge> origin/<target>`. M+ reconcile with row 3: `<merge>^2` equals the reviewed tip, and the review base `b` covers the merge: `git rev-list --no-merges <merge>^1..<merge>^2` is a subset of `b..<tip>` (so a target merged into the branch mid-task does not break it). XS/S may land with one parent | `merge_not_found` / `merge_ambiguous` / `merge_not_on_target` / `merge_not_reviewed_tip` |
| 6 | finish: qc | all | derived from existing QC artifacts bound to the code, not from the trailer: `node <pin>/scripts/check-test-outcome.js --root <repo> --range <phase-base>..<merge> --head <merge> --rerun sample` (the pre-push outcome gate's own checker: it recomputes the selected suites, reads the `qc-runs/<head>.json` record, re-runs a sample within `--budget-s`); verdict `pass`, `unjudged_full` or `nothing_selected` passes, `record_missing`, `record_stale`, `recorded_red`, `rerun_red` refuse. With `.claude/qc-gate-config.md` evidence `artifact` or `either`, `.qc/<sha>.verdict.json` for a commit in the range is also read. The `QC-Verdict` trailer is a summary and is required only when the range touches a protected path (`scripts/lib/qc-evidence.sh`, the same rule as `.githooks/pre-push`); XS/S use the same row. Negative control: valid trailer, record deleted -> refused | `qc_outcome_refused` / `qc_trailer_missing` |
| 7 | urgent-low (M/L/XL) | urgent-low | accepted at finish: rows 1, 2, 5 (without the reviewed-tip check), 6 and 8 apply; row 3 is deferred. The code review is terminal after finish and loops to nothing: it files S backlog rows (skills/finish-flow/SKILL.md "Post-finish code-review"), so Mode A, which demands SHIP-AS-IS (:1397), does not apply. Checked after finish: the `[stage:review/code-review]` line exists and a `code-review` bundle's `--phase-base` re-derives to `git merge-base <target> <merge>^2` | `urgent_review_missing` (warn after the stage cap) |
| 8 | finish: Used | all | `Used:` is one report line in `task_result` (finish-flow item 7), not a merge trailer. Fleet's own check (`used_required`, `used_na_reason`, stages.rs:419) stays the base. Autopilot adds: at M+ `n/a` only with "no user can run it yet" plus an end-to-end run line; `user` / `e2e` need an evidence token that resolves: a commit (`git cat-file -e`), an http(s) URL, or a fleet blob sha256 (`fleet fetch` succeeds) | `used_na_not_allowed` / `used_evidence_unresolvable` |

Non-derivable stages: `intent`, `explore`, `research`, `proposal` (prose writers) and `diagnose` (prose:debug). Their `[stage:...]` lines are telemetry, never evidence, and no accept gate: the only mechanical check is row 4. What they produce that IS derivable (the plan blob, the plan-review bundle) is enforced by rows 1-2. Honest limits: writing the expected text without doing the work passes only the warn-level row 4; a `Used:` token proves existence, not that someone used the build (the requester judges at accept).

Fleet stores no receipt and signs nothing; each call recomputes from git and the uploaded bytes (ADR-0001). The only suite re-run is row 6's bounded sample, the same one the push gate already runs.

### (c) Flow graph by size and type (INTERNAL; source of truth `references/stage-graph.json`)

```mermaid
flowchart LR
  XS[XS: implement -> qc-gate -> finish]
  S[S: implement/verify loop -> qc-gate -> finish]
  M[M: plan -> loop -> code-review -> qc-gate -> finish]
  subgraph LXL[L / XL]
    direction LR
    I[intent] --> R{{research optional}} --> PR[proposal]
    I --> PR
    PR --> P[plan] --> PRV[plan-review] --> L[implement/verify loop] --> CR[code-review] --> Q[qc-gate] --> F[finish]
    E[explore: brainstorm] --> P
  end
  D[diagnose] -. bug: prepend XS..M, replaces intent at L/XL .-> XS
  PRV -. loop-back .-> P
  Q -. loop-back .-> L
  CR -. loop-back, not urgent-low .-> L
```

| Size / type | Walk (nodes in order) | Entry | Notes |
|---|---|---|---|
| XS | implement, qc-gate, finish | implement | no plan; bump limit 2 files / 20 lines; unit_kind null |
| S | (implement, verify) x units, qc-gate, finish | implement | no plan; 6 files / 200 lines; unit_kind phase |
| M | plan, (implement, verify) x units, code-review, qc-gate, finish | plan | 20 files / 800 lines; plan receipt required; `plan-review` absent in the json today, added by P5 if the P0 eval passes (PM ruling: M also goes through plan-review) |
| L | intent, [research], proposal, plan, plan-review, loop, code-review, qc-gate, finish | intent | unit_kind phase; research skipped when not optional-on; `--explore` (non-bug walks only, stage-graph.js:104) replaces intent..proposal with `explore` |
| XL | same as L | intent | unit_kind deliverable |
| bug XS..M | diagnose, then the size's walk | diagnose | prepend |
| bug L/XL | diagnose replaces intent | diagnose | replace; `--explore` ignored when bug |
| urgent-low, M/L/XL | code-review moves after finish and is terminal, no loop-back | as size | `urgent --high-risk` keeps normal order |
| urgent-low, XS/S | unchanged; finish stays terminal | as size | no code-review node, so nothing moves (stage-graph.js:110-117) |

Brainstorm vs survey at L/XL entry: `explore` (writer `autopilot:brainstorm`) when the options do not exist yet; `research` (writer `survey` / `probe-unknown.js`, optional node) when the options are known but an external fact is unknown. Neither is fleet-derivable (see (b)). Fleet does not know the `explore` flag (it is not in the title SizeTag), so for L/XL non-bug the export lets fleet accept either variant's entry and checks order from `plan` onward.

### (d) autopilot is the single source; fleet reads a versioned export (INTERFACE)

- Name and version: `autopilot.fleet-flow/1` (`schemas/fleet-flow.schema.json`). Additive changes keep `/1`; a removed or renamed field bumps to `/2`. An unknown major degrades with one warning (fleet design principle), it does not block.
- Lives at `references/fleet-flow-graph.json` in the autopilot plugin; produced by `node scripts/export-fleet-flow.js`; mirrored and byte-gated in `sync-all.sh --check` via `scripts/sync-manifest.json`. Fleet reads it from the autopilot pin on its host (hangar pin), never a copy of its own.
- Inputs (all four are generator inputs, none is copied by hand): `references/stage-graph.json`, `references/fleet-flow-evidence.json` (the evidence rules of (b)), `COARSE_OF_NODE` exported from `scripts/stage-advance.js` (:111-124), and the exporter itself. Content: `schema`, `graph_schema`, `autopilot_version`, `source_sha256` {`stage_graph`, `evidence`, `stage_advance`, `exporter`}, `export_sha256`, `sizes` (expanded walks per `(size, bug, urgent, explore)`), `loop_backs`, `bump_limits`, `evidence` (event, sizes, derivation id, code), `coarse_of_node`. Dropped from the first draft: `alarm_defaults` (fleet owns `stage_cap_ms`), the `Size:` regex (size comes only from `Task.size`), `USED_EVIDENCE_MISSING`.
- Canonical form: UTF-8, LF, keys sorted recursively, compact separators; `export_sha256` is the sha256 of that form with the field itself omitted. It is a convenience for diffing, not the check.
- Tamper and stale detection is re-derivation, not a self-checksum (a self-consistent edited or old export passes every checksum): fleet runs `node <pin>/scripts/export-fleet-flow.js --check --pin <pin>`, which regenerates the complete export in memory from the pin's four inputs and byte-compares the whole canonical content with the file it was given (evidence rules and `coarse_of_node` included), and requires the four input paths clean in the pin (`git diff --quiet`). Any difference: degrade (skip the autopilot-only rows), warn once with `flow_export_stale` / `flow_export_invalid`. Negative controls in P1, each red then green: (1) delete one evidence rule from the export and recompute `export_sha256`; (2) an older export with a valid checksum after `COARSE_OF_NODE` changed and `stage-graph.json` did not; (3) edit `stage-graph.json` without regenerating.

### (e) INTERFACE, fleet--claude reviews: joining the inbox issue model 01M7RAMY

Reviewed by fleet--claude (01M7RS0G); adopted: no new `issue.*` fields, map to what exists.

| Needed | Existing fleet carrier | Note |
|---|---|---|
| stage (and node) | `fleet tasks --json` `stage.stage` + `stage.fine` (`Task.stages`, tasks.rs:250; filled from `[stage:<coarse>/<fine>]`, tasks.rs:820); coarse outside the 7 known values is a `bad_marker` | telemetry (reported). Verified status is the verifier's result, kept apart so progress text cannot suppress alarms |
| size, bug, urgent | `Task.size` (task.proto:186) from the title SizeTag via `size_of_title` / `effective_size` (tasks.rs:855); `[bug S]`, `[!L]` | no `issue.type`; no `Size:` regex in the export |
| used | `stage.used` | |
| evidence due | `task_evidence` / `next_evidence_due` | |
| plan path@sha | new additive `Task.plan_blob` (string; `Schedule.plan_ref`, task.proto:312, is a `[a-z0-9_-]` plan code) | the only new field. At dispatch it carries `Plan:` verbatim: `<path>@<sha>`, or the literal `plan-first`. For `plan-first` the courier rewrites it once, to `<path>@<sha>`, when row 1 first resolves the plan; rows 2 and later bind to that value |
| verifier verdict | a task comment (`Task.comments`, field 43) carrying the verdict JSON below | not a field |
| dependencies | `Task.schedule` step with `ScheduleEdge{type:"data", task:<id>, step:"result", output:<name>}`; an untyped edge is refused by the gate (R1 `edge_untyped`) | see (h) |
| owner, deadline, used_by | `assignee`; `TaskLeaseTerms.hard_deadline_ms` (task.proto:250); a `Used:` expectation in the title | |

Receipt carrier. `task_result` text holds one `Receipt: <kind>=<sha256>` line per bundle; `<kind>` is exactly one of `plan-review`, `code-review`, `qc-record` (any other: `receipt_kind_unknown`). A bundle is a tar uploaded with `fleet upload`, 20 MB per part, 50 MB total (fleet blob limits), holding `bundle.json` `{kind, files:[names]}` plus: `plan-review` = `gN.json`, `gN-disp.json`, plan, rubric; `code-review` = the `review-<phase>/` ledger dir, optionally `packets.json`, `chain.txt`, `post-head-ledger.json`; `qc-record` = `qc-runs/<head>.json`. The courier fetches by sha256 and extracts each into `<dir>/<kind>/`.

Verifier CLI (both the courier and a lane's local preflight call it): `node scripts/fleet-flow-verify.js --repo <path> --task <id> --size <XS|S|M|L|XL> [--bug] [--urgent] --target <ref> --tip <sha> [--merge <sha>] --plan <path>@<sha>|plan-first --receipts <dir> [--row <1..8>] --json`. `--receipts` is the courier's extraction dir, or a lane's local dirs laid out the same way before it uploads. Without `--merge` it runs the pre-merge rows only; read-only, never mutates. stdout is one JSON `autopilot.fleet-flow-verdict/1`: `{schema, task, size, mode:"pre-merge"|"finish", allowed, plan_blob, rows:[{row, status:"pass"|"fail"|"skip"|"warn", code, detail}], findings:[{code, step, explanation, suggested_change, severity}]}`. Exit 0 = allowed, 1 = refused (codes in `rows`), 2 = could not check (courier degrades and warns once).

One interface with the scheduling gate 01M7PMGYS50QEN5JSE8A1K39FA: (h) and (i) are defined only here; the gate consumes `autopilot.plan-phases/1` (P4) and fleet's own alarm mechanisms. Delivery state ("did the receiver get it") is fleet's 01M7RH3Y; this plan only aligns: alarm and report messages are ordinary fleet sends and carry the finding code. Phase tasks are created through fleet `dispatch` (courier-held queue), not by a plugin.

### (f) Non-Claude harness lanes (codex, agy, grok)

Enforcement sits at fleet's re-derivation, so no Claude hook is needed; a lane runs plain CLI, documented in `references/multi-agent-portability.md` (P3). Sequence for a work-order lane with a write seat, session id `wo-<task id>` (explicit and fresh, because `resolveMarkerWriteTarget` refuses inherited ids when a rail exported `AUTOPILOT_PARENT_SESSION_ID`, session-mode.js:216-233, exit 3, and a cwd-keyed marker collides between concurrent sessions):

1. `node scripts/work-order-adopt.js --task <id> --session-id wo-<id>`; then `node scripts/stage-advance.js --session-id wo-<id> --to <node>` per node.
2. Plan review (L/XL, M after P5): `node scripts/dispatch-plan-review.js --repo-root <r> --plan-file <plan> --rubric-file <rubric> --ticket <id> --session-id wo-<id> --generation <n> --manifest-file <m>`; tar `gN.json`, `gN-disp.json`, plan and rubric; `fleet upload <tar> --summary "plan-review <id>"` returns the sha256.
3. Code review (M+): `node scripts/hetero-review-loop.js collect ...` then `finalize ...`; tar the resulting `review-<phase>/` dir; `fleet upload` it.
4. Merge per finish-flow "Merge" (the `QC-Verdict` trailer in the last paragraph); tar `qc-runs/<head>.json` from the git common dir; `fleet upload` it.
5. `node scripts/fleet-flow-verify.js ... --receipts <local dir>` (preflight; fix what it refuses), then `task_result` with the `Receipt:` lines and the `Used:` line.

`dispatch-author.sh` is a read-only rail (its header: no repo mutation path), so no work-order wording is attached to it; read-only seats and `noncq.js` items do not call `task_result` and get none of this. Honest limit: a harness that never writes the marker loses lane-side early refusal; fleet still refuses at result. `references/multi-agent-portability.md` stays the authority on hook parity; this plan claims none.

### (g) Retiring the PM plan-gate hook

Named: opt-in stem `pm-dispatch-plan-guard` (`hooks/opt-in-manifest.json:24`, sub-stem of `fleet-send-work-order-guard`) = the dispatch branch of `hooks/fleet-send-work-order-guard.js` (`decideDispatch`, :64-76: runs only on the PM console; denies a missing Size and an M+ missing Plan; constants `DISPATCH_OPT_IN`, `DISPATCH_SIZE_DENY_REASON`, `DISPATCH_PLAN_DENY_REASON`), test `hooks/pm-dispatch-plan-guard.test.js`. Order, so there is never a window with neither system and never a deadlock between the two size syntaxes (today `work-order-plan.js:15-17` accepts only a `Size:` line, while fleet reads only the title SizeTag):

1. Merge P2 and promote the autopilot pin on the PM host, so the hook accepts title SizeTags.
2. P6a deploys live on the PM host's courier and hub (after the canary); observe on the live PM console both refusals: a dispatch with no size and an M+ dispatch with no `Plan:`. Only then proceed.
3. P8, one push in the autopilot repo, then promote the PM pin. Before deleting the test file, move its `isPmConsole` cases (pm-dispatch-plan-guard.test.js:115-139) and the stub negative controls (:262-274) to `hooks/pm-console.test.js`, and its `mcp__fleet__send` regression cases (:230-247) into `hooks/fleet-send-work-order-guard.test.js`; `hooks/_shared/pm-console.js` is still used by `askpm-remind.js` and `pm-output-cap.js`.
4. Delete the dispatch branch, the stem line, the dispatch-only test cases; keep the default-on `mcp__fleet__send` branch; narrow the `hooks/hooks.json` matcher (`mcp__fleet__send|mcp__fleet__dispatch`, hooks.json:195) to `mcp__fleet__send`.
5. Update every file that names the stem (`git grep -ln pm-dispatch-plan-guard`: CHANGELOG.md, docs/guide/settings-reference.md, hooks/README.md, manifest), regenerate generated matrices, run `check-hook-inventory.js`; the PM console opt-in config loses the stem.

### (h) Plan freeze expands into fleet tasks (INTERFACE)

- Plan format (P4): a fenced ` ```phases ` block in the Phases section, one JSON object per line: `{"id","title","size","deps":[{"phase"|"task","output"}],"owner","task","cap_deadline","target","used_by"}` plus optional `"conditional":"<phase id>"` and `"task_opens"`. `owner` is a full fleet address `namespace/courier/member` resolved against fleet `directory`; an unresolved owner is a problem, not a guess. Every dep is a typed edge: `phase` (same plan) or `task` (`<id>`), with a named `output`, because fleet's gate refuses untyped edges. `task` is the fleet task id, or null with `task_opens` saying when it is opened. `cap_deadline` is an alarm only, computed from fleet's `whole_cap_ms` for the size at the freeze time; `target` is the plan's own estimate and never alarms. This plan carries its own block below; `plan-template.md` self-review gains "phase block parses".
- Legacy plans (frozen before P4, such as e6f6623a, a prose table with an owner column and no size, deadline or used_by): `plan-phase-expand.js` reads a markdown table whose header has `歸屬|Owner`, reports `legacy_table_parsed`, maps owner text to a member by name prefix (ambiguity: `owner_unresolved`). For a legacy table a missing size, `cap_deadline` or `used_by` is not a freeze problem; only owner resolution and `--check-tasks` apply.
- Conditional phases: `"conditional":"P0"` (P5) means the phase is expanded with its task opened, and `--check-tasks` accepts either that task or the task being cancelled with the controlling phase's verdict recorded (`conditional_skipped`); it never reports `phase_task_missing` for a cancelled conditional.
- Freeze event: the final-generation plan-review disposition at `plan_sha256` (M with no plan-review: entering `implement`). `node scripts/plan-phase-expand.js --repo <path> --plan <path>@<sha> --json` emits `autopilot.plan-phases/1`: phases, edges, `problems`. Fleet's gate is the consumer, idempotent on `(plan_sha256, phase id)`.
- Expansion into fleet: one task per phase (dependencies first), `size` -> `Task.size`, `owner` -> assignee, `cap_deadline` -> `hard_deadline_ms` (alarm), each dep -> `ScheduleEdge{type:"data", task, step:"result", output:<named>}`; the phase is a step whose `Schedule.plan_ref` is the logical plan id.
- Problems reported before work starts (a comment on the plan's parent task, and the PM woken): no owner; unknown owner; edge to a phase absent from the block or without an `output`; `task:<id>` fleet does not know (T0); cycle; no `cap_deadline` or `used_by` (non-legacy).
- Owner-task check (PM 01M7RSQF), `plan-phase-expand.js --check-tasks <fleet tasks json>`: after a freeze, every phase with an owning lane must have a fleet task with `schedule.plan_ref` = the plan's logical id, step = the phase id, assignee = that lane. A missing one yields `phase_task_missing` (step = phase id), a comment on the plan's parent task and a PM wake. Real cases it blocks: 01M7MD5Z (P2 never created) and plan e6f6623a P5 (owner autopilot, no autopilot task). Acceptance replay: against a fleet tasks snapshot taken before this plan, the check on e6f6623a reports `phase_task_missing` for P5 via the legacy reader (today nothing reports it); after the expansion run, none.

### (i) Dependencies are task-id edges; alarms (INTERFACE)

Edges are task ids only. `--blocked-on` targets that are member addresses or decision cards (`d-xxxxxxxx`, fleet-task.js:11-13) or the global rule's `waiting_on_operator <id>` text are a different wait kind: they never trigger T0 and are exempt from T3. Who alarms: fleet's scheduling gate (a stuck lane cannot alarm itself) to the waiting lane and the PM. Only T0 and T3 are new; the rest cite fleet mechanisms that exist (01M7RS0G). Single source of numbers (PM 01M7RTGA): no number is invented here; each threshold is the fleet constant named, quoted at P6b acceptance, and re-set after 7 days of the finding log.

| # | Condition | Mechanism and threshold (fleet's value) | Real case it blocks |
|---|---|---|---|
| T0 | an edge points to a task id that does not exist | NEW: schedule validator `TaskLookup`; no timer, refused at validation (today `is_valid_blocked_on_target`, tasks.rs:411, checks format only) | observed: 01M7MD5Z "waiting on P2", no P2 task |
| T1 | target exists, no accepted owner | lease `accept_by_ms` (task.proto:249), fleet's lease default | assumption: a phase task nobody picks up |
| T2 | target has no progress past its evidence due | stuck check; due = the lane's `task_evidence` `next_evidence_due` | observed: the PM chased 01M7MD5Z for three rounds with nothing moving |
| T3 | progress or blocked text says the lane is waiting but no edge exists and the blocked target is not a member, card or `waiting_on_operator` | NEW: `wait_on.rs` / `check_inprogress_wait` (tasks.rs:1753); fires on the first matching update, no timer. Phrases: `waiting on`, `blocked on`, `等待`, `卡在` (not the bare `等`) | observed: 01M7MD5Z text-only wait |
| T4 | stage stall | `stage_cap_ms` per size and stage (stages.rs:288; M plan 8 h, M build 24 h per 01M7RS0G) and `whole_cap_ms` per size; the phase `cap_deadline` values below are `whole_cap_ms` from 2026-11-19 12:00 Taipei | assumption: stuck between plan-review and implement |
| T5 | accepted but stage never leaves entry | `dwell_unstaged`, `UNSTAGED_CAP_MS` 24 h (stages.rs:10) | assumption: dispatch accepted and forgotten |

PM ruling: T0-T5 go live directly (no shadow period), every firing is logged as a finding with its inputs, thresholds are re-set after 7 days from that log (P6b acceptance). Repeat alarms back off (second after twice the threshold, then PM only).

### (j) Company-management check (have now / gap / owner)

| Method | Have now | Gap | Owner |
|---|---|---|---|
| Work breakdown + critical path | 有: plan phase tables and a per-task stage graph; `check-backlog-entries.js` deps | machine phase block, task expansion, edge-based critical path = (h), (i) | autopilot (format, P4), fleet (tasks and edges, P6b) |
| Stage gates / definition of done | 有: stage-advance refusals, finish-flow rows, QC-Verdict trailer (lane-local) | fleet re-derivation (b) | autopilot (P2), fleet (P6a) |
| Kanban WIP limit per lane | none; global CLAUDE.md states the pipeline rule only | PM ruling: WIP limit 4 per lane; an accepted-but-unstarted task past the cap returns to backlog | fleet (scheduler, P6b); pm (the cap) |
| Budget lines (quota pools before the ceiling) | 有: `capacity.pace/1` rows (used_pct, hours_to_reset, waste_pct_if_unused) drive `noncq.js drain`; P7 shipped ad08844 | pre-ceiling alarm to lane + PM, dispatch routing away from a hot pool: P6b consumes P7's rows and depends on P7 | capacity (rows, P7), fleet (gate consumes, P6b), hangar (pool switch, existing) |
| Each lane keeps >= 2 startable items | 有: `check-backlog-entries.js --ready` computes `ready_count`; rule text in global CLAUDE.md | fleet-side count over tasks; fewer than two alarms the lane scheduler and PM | fleet (count, P6b), autopilot (READY marker, existing) |
| Retrospective / lessons | 有: `retro`, `learn` | none for this plan | autopilot |
| RACI / ownership per work item | 有: task assignee, backlog Queued-by | `owner` per phase = (h) | autopilot, pm |

### PM decides

- T4 total budget: cited from fleet's constants, not a new number; whether to change them is the PM's call (T4 row above).
- Outcome of the P0 eval (M plan-review ON/OFF): adopt or not (P5).

### The phase block (machine form; times Taipei, UTC+8; `cap_deadline` from a freeze at 2026-11-19 12:00)

```phases
{"id":"P0","title":"Eval: M with plan-review ON vs OFF","size":"M","deps":[],"owner":"cookys/aimax395-team/autopilot--claude","task":"01M7RTVBCX2HS58QV1NFWZRNXW","cap_deadline":"2026-11-24 12:00","target":"2026-11-19 20:00","used_by":"eval result read by the PM, one line with run ids"}
{"id":"P1","title":"fleet-flow export, schema, sync gate","size":"S","deps":[],"owner":"cookys/aimax395-team/autopilot--claude","task":"01M7RTV31Q9SCBWSAMY3ZN4S7T","cap_deadline":"2026-11-22 06:00","target":"2026-11-19 16:00","used_by":"fleet loads the file on the PM host and prints the M walk"}
{"id":"P2","title":"fleet-flow-verify and shared fixtures","size":"M","deps":[{"phase":"P1","output":"fleet-flow-graph"}],"owner":"cookys/aimax395-team/autopilot--claude","task":null,"task_opens":"at P1 merge","cap_deadline":"2026-11-27 06:00","target":"2026-11-20 12:00","used_by":"allowed:true on a real finished task, allowed:false with the trailer stripped"}
{"id":"P3","title":"work-order-adopt and hook","size":"S","deps":[],"owner":"cookys/aimax395-team/autopilot--claude","task":"01M7RTV8ENTA7QJ5SFT12AFJM5","cap_deadline":"2026-11-22 06:00","target":"2026-11-19 18:00","used_by":"a real dispatch shows marker fields without a manual set"}
{"id":"P4","title":"plan-phase-expand, owner-task check, template","size":"M","deps":[{"phase":"P1","output":"fleet-flow-graph"}],"owner":"cookys/aimax395-team/autopilot--claude","task":null,"task_opens":"at P1 merge","cap_deadline":"2026-11-27 06:00","target":"2026-11-20 18:00","used_by":"e6f6623a P5 reported missing, then none after expansion (local replay); the gate ingest is P6b's"}
{"id":"P5","title":"Add plan-review to M in the graph (conditional on P0)","size":"S","deps":[{"phase":"P0","output":"eval-verdict"},{"phase":"P1","output":"fleet-flow-graph"}],"conditional":"P0","owner":"cookys/aimax395-team/autopilot--claude","task":null,"task_opens":"at P1 merge","cap_deadline":"2026-11-27 06:00","target":"2026-11-20 12:00","used_by":"export lists plan-review for M; one real M task passes through it"}
{"id":"P6a","title":"fleet: verifier at courier, dispatch validation, refusal codes","size":"M","deps":[{"phase":"P2","output":"verifier-promoted"}],"owner":"cookys/openclaw/fleet--claude","task":null,"task_opens":"fleet opens","cap_deadline":"2026-12-02 06:00","target":"2026-11-22 18:00","used_by":"a real refused accept and a real refused no-Size and no-Plan dispatch, with message ids"}
{"id":"P6b","title":"fleet: phase expansion, T0, T3, WIP limit 4, startable count, P7 pace rows, trigger log","size":"M","deps":[{"phase":"P4","output":"phase-expander"},{"phase":"P7","output":"pace-rows"}],"owner":"cookys/openclaw/fleet--claude","task":null,"task_opens":"fleet opens","cap_deadline":"2026-12-02 06:00","target":"2026-11-23 18:00","used_by":"codeforge-shape replay fires T0; the gate ingests this plan and creates tasks with edges; a real alarm and a real pre-ceiling row reach a lane and the PM"}
{"id":"P7","title":"capacity: pre-ceiling pace rows","size":"S","deps":[],"owner":"cookys/aimax395-team/capacity--claude","task":"01M7RTPPCP2APNFG8PYZX369E8","cap_deadline":"2026-11-22 06:00","target":"2026-11-19 18:00","used_by":"a real pre-ceiling row emitted (shipped ad08844, awaiting the first real row); consumption is P6b's"}
{"id":"P8","title":"Retire pm-dispatch-plan-guard","size":"S","deps":[{"phase":"P6a","output":"refusals-observed"}],"owner":"cookys/aimax395-team/autopilot--claude","task":null,"task_opens":"after P6a observed","cap_deadline":"2026-12-05 00:00","target":"2026-11-24 18:00","used_by":"a no-Size dispatch and a no-Plan M+ dispatch refused by fleet with the stem absent"}
```

Prose table (human form; the block above is authoritative; same ids, owners, tasks and times):

| Phase | Size | Owner | Task | Deps (output) | Cap deadline | Target | Ships | Acceptance | Used-by evidence |
|---|---|---|---|---|---|---|---|---|---|
| P0 | M | autopilot | 01M7RTVBCX2HS58QV1NFWZRNXW | none | 2026-11-24 12:00 | 2026-11-19 20:00 | eval pack and result for M plan-review ON/OFF (scorecard-first; no graph change here) | ON/OFF scores on the same tasks with run ids; PM reads the verdict | one-line result with run ids |
| P1 | S | autopilot | 01M7RTV31Q9SCBWSAMY3ZN4S7T | none | 2026-11-22 06:00 | 2026-11-19 16:00 | `export-fleet-flow.js`, `fleet-flow-evidence.json`, `fleet-flow-graph.json`, schema, `COARSE_OF_NODE` export, sync-all gate, Codex mirror, tests | validates against schema; the three negative controls of (d) red then green; `--check` regenerates byte-identical | fleet loads the file on the PM host and prints the M walk (command + output line) |
| P2 | M | autopilot | at P1 merge | P1 (fleet-flow-graph) | 2026-11-27 06:00 | 2026-11-20 12:00 | `fleet-flow-verify.js` (rows of (b)), SizeTag parse in `work-order-plan.js`, fixture repos usable from Rust | per row: green with evidence, red with it removed (incl. row 6 trailer-without-record, row 5 unrelated latest commit, a pre-merge fixture with no merge commit, the urgent-low sequence); passes on a real finished M task; promoted on the PM host pin | real task id JSON `allowed:true`; one `allowed:false` with the trailer stripped |
| P3 | S | autopilot | 01M7RTV8ENTA7QJ5SFT12AFJM5 | none | 2026-11-22 06:00 | 2026-11-19 18:00 | `work-order-adopt.js`, `session-mode.js` edits, hook `hooks/work-order-adopt.js`, registries, portability section, canary probe | fixture task writes `wo_size`, `fleet_task_id`, entry stage with `wo_state: resolved`; second task and a task after a local task use `--new-task`; no-size title -> `unresolved`, one stderr line, no stage-advance; `check-hook-inventory.js` green | a real dispatch shows marker fields without a manual `set` |
| P4 | M | autopilot | at P1 merge | P1 (fleet-flow-graph) | 2026-11-27 06:00 | 2026-11-20 18:00 | phase block + legacy-table parser, `plan-phase-expand.js` (`--check-tasks`), `plan-phases.schema.json`, template line, tests (cycle, missing owner, dangling or untyped dep, owner-task check, conditional phase) | `problems` correct on 5 fixture plans; this plan's block parses; e6f6623a red then green | e6f6623a P5 reported missing, then none after expansion (local replay); the gate ingest is P6b's |
| P5 | S | autopilot | at P1 merge; conditional on P0 | P0 (eval-verdict), P1 (fleet-flow-graph) | 2026-11-27 06:00 | 2026-11-20 12:00 | `stage-graph.json` M walk gets `plan-review` after `plan`; tests; profiles chain; export regenerated | only if P0 passes (else task cancelled, `conditional_skipped`); own commit (mechanism vs guidance); `stage-graph.js validate` green | one real M task through plan-review |
| P6a | M (fleet) | fleet | fleet opens | P2 (verifier-promoted) | 2026-12-02 06:00 | 2026-11-22 18:00 | courier verifier calls, `plan_blob`, dispatch validation, refusal codes | accept of an M task missing the qc outcome refused with a lowercase code | real refused accept, refused no-Size dispatch and refused no-Plan M+ dispatch, message ids |
| P6b | M (fleet) | fleet | fleet opens | P4 (phase-expander), P7 (pace-rows) | 2026-12-02 06:00 | 2026-11-23 18:00 | gate consumption of `autopilot.plan-phases/1` and of P7 pace rows (pre-ceiling alarm, routing), T0, T3, WIP limit 4, startable count, finding log | codeforge 01M7MD5Z shape fires T0; text-only wait fires T3, a card wait does not; fifth unstarted task returns to backlog; a pace row past the line alarms | gate creates tasks with edges from this plan; real alarm and pre-ceiling row delivered to a lane and the PM |
| P7 | S | capacity | 01M7RTPPCP2APNFG8PYZX369E8 | none | 2026-11-22 06:00 | 2026-11-19 18:00 | pre-ceiling pace rows (shipped ad08844) | row emitted when used_pct and hours_to_reset cross the line | first real row (awaited); consumption is P6b's |
| P8 | S | autopilot | after P6a observed | P6a (refusals-observed) | 2026-12-05 00:00 | 2026-11-24 18:00 | retire the hook per (g) | hook tests preserved elsewhere; inventory counts updated | both refusals observed with the stem absent |

## 5. Test / validation

- Script-gated: node tests per new script with the negative controls above; `stage-graph.js validate`; `check-hook-inventory.js` after P3 and P8; `sync-all.sh --check`; fixtures shared between Node and Rust.
- Human/PM-gated: freeze of this plan; the "PM decides" items; the M plan-review adoption after P0.
- Done (global baseline) only when a real lane has had an M task refused and an alarm delivered on fleet (P6a, P6b Used-by), and e6f6623a's P5 case has gone from undetected to detected.

## 6. Risks + inversion

What guarantees failure: (1) the verifier trusts lane text instead of git: mitigated by deriving the merge by exact `Fleet-Task` trailer, ancestry, a derived `--phase-base`, uploaded receipts bound to git bytes and QC from the outcome record (row 6); the trailer is only a summary, and XS/S have no pre-merge receipt (their evidence is row 6 at finish). (2) Two systems: fleet refuses and the hook also denies with different rules: P8 only after P6a is observed live. (3) Alarm noise: logged triggers, backoff, thresholds re-set on data after 7 days. (4) Export drift: pin read plus whole-content regeneration (`export-fleet-flow.js --check`), not checksums. (5) Stale phase block after a plan edit: expansion keyed by `plan_sha256`; a changed plan is a new freeze. (6) The M plan-review requirement is not enforceable until P5 lands; until then M enforces plan blob only. (7) Hand-written phase blocks wrong: parser errors at plan-review time. (8) Degrade-and-warn lets a broken verifier go unseen: the warning is a finding in the log; a warning that repeats for 24 h goes to the PM. (9) Fleet `last_merge` trailer scan missing a trailer: verifier discovers the merge by exact `Fleet-Task` trailer and refuses zero or several candidates. (10) P2 not yet promoted when P6a goes live: the PM host would refuse every title-SizeTag dispatch; (g) orders P2 first.

## 7. Out of scope

- Changing the graph's nodes or sizes, except P5.
- Fleet's internal storage, UI and the inbox issue model beyond the single `plan_blob` field (fleet--claude owns).
- Delivery-state tracking (did the receiver get it): fleet 01M7RH3Y; this plan only keeps messages ordinary sends carrying finding codes.
- Re-running the full test suite on the fleet side (row 6 re-runs only the push gate's bounded sample); judging explore/research/proposal/diagnose content.
- Capacity's pacing math and hangar's pool switching beyond the P7 rows.
- Credentials, approval gates (`fleet approve` stays human-only), anything outward-facing; hosted CI; any version bump; renaming or privatizing the repo.

## 8. Open questions

1. Which tool call does a Claude lane make on receiving a dispatch (decides the P3 hook matcher)? Settled by P3's probe, not by the Board. Tasks of P2, P4, P5, P8 and fleet's P6a/P6b are opened as their deps merge (the `task` field is null until then).
2. Does the courier call the verifier as a node subprocess (configured autopilot pin path) or port the receipt rows? fleet--claude recommends the subprocess for receipt rows and Rust for cheap rows; P6a confirms.

## Review log

- R0: author = chair (Sonnet), draft 2026-11-19; rubric `project/plans/2026-11-19-fleet-stage-graph-binding.rubric.md` (ids R1..R11 unchanged); manifest beside the plan.
- Generation 1 (astra chair + carbon red-team): CONDITIONAL, 18 findings (13 blocking, 5 non-blocking); disposition in `project/plans/2026-11-19-fleet-stage-graph-binding.disposition.json` (generation 1); every claim re-verified against code.- Generation 2 (astra chair + carbon red-team): 14 blocking candidates, `generation: 2` entries in the same disposition file; each re-verified against the code it cites. Accepted ones are folded into this revision 3; the sections changed are named per entry in the disposition file.
- Revision 2 (before generation 2) adopted fleet--claude's interface review 01M7RS0G, the PM rulings (M through plan-review after an eval; T1-T5 live directly with logged triggers and a 7-day threshold reset; WIP limit 4; T4 conflict to "PM decides") and the PM 01M7RSQF owner-task check. Correction: an earlier draft of this log said the rubric wording of R3, R6 and R9 was updated and the seal re-taken. That was false: the rubric file and manifest were not changed after generation 1 and the seal is the generation-1 seal; the plan, not the rubric, was brought into line.
- Revision 3 (PM 01M7RC6H ticket): phases block carries full fleet addresses, fleet task ids, `cap_deadline` (alarm only) and `target`, typed dependency edges per PM 01M7RTP0; thresholds cite fleet's constants only (PM 01M7RTGA).
