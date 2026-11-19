# Plan — Bind the work lifecycle into fleet's mechanized flow (stage graph export, receipt re-derivation, dependency alarms)

> Status: generation 2 revision (round-1 findings folded in; see Review log). Owner: autopilot lane (planner: chair). Consumers: fleet--claude (interface review, done 01M7RS0G), PM (freeze), fleet scheduling gate 01M7PMGYS50QEN5JSE8A1K39FA.
> Branch: `plan/fleet-stage-graph`. Frame: plan only; no implementation ships with this file. Version stays 3.0.0-alpha line (no bump).
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
- No hosted CI. No version bump. New JSON schemas: exactly `schemas/fleet-flow.schema.json` (P1) and `schemas/plan-phases.schema.json` (P4).
- Text such as "waiting on X" never counts as a dependency; only task-id edges do.
- No new fleet fields where an existing one fits (fleet design principle); errors use fleet's `wire_error` / `ScheduleFinding`, lowercase snake_case codes.
- A failing component (missing or stale export, absent verifier) degrades and warns once; only credentials, cert pins and `_access` fail closed. A verifier that ran and found evidence missing refuses; that refusal is the product, not a component failure.
- Migrate, do not run two systems: the PM plan-gate hook retires only after fleet's dispatch refusal is observed live (P8).

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`. Adds one versioned export (`autopilot.fleet-flow/1`), one phase format (`autopilot.plan-phases/1`) and new scripts; `stage-graph.json`, marker fields and `[stage:...]` lines are unchanged except P5 (M gains `plan-review`, conditional on the P0 eval). P8 removes the `pm-dispatch-plan-guard` opt-in stem (consumer: PM console only; fleet refusal lands first).
- **Dependency decision**: `none`.

## 3. File-structure map

| File | Responsibility | Phase |
|---|---|---|
| `scripts/export-fleet-flow.js` (new) | derive `autopilot.fleet-flow/1` from `references/stage-graph.json`; `--check` = byte-compare with regeneration | P1 |
| `references/fleet-flow-graph.json` (new, generated) | the versioned export fleet reads | P1 |
| `schemas/fleet-flow.schema.json` (new) | schema of the export | P1 |
| `scripts/sync-manifest.json`, `scripts/sync-all.sh` (edit) | mirror the export and gate drift in `--check` | P1 |
| `scripts/fleet-flow-verify.js` (new) | rows of (b) that need receipt files; one JSON verdict | P2 |
| `scripts/lib/work-order-plan.js` (edit) | also parse the title SizeTag (`[bug S]`, `[!L]`) with fixtures shared with fleet's `size_of_title` | P2 |
| `scripts/work-order-adopt.js` (new) + `hooks/work-order-adopt-hook.js` (new, opt-in stem `work-order-adopt`), `hooks/hooks.json`, `hooks/opt-in-manifest.json`, `hooks/README.md` | marker write at the start of a task | P3 |
| `scripts/plan-phase-expand.js` (new), `schemas/plan-phases.schema.json` (new), `references/plan-template.md` (edit) | phase block parse, legacy-table parse, freeze-time owner-task check | P4 |
| `references/stage-graph.json`, `scripts/stage-graph.js` tests, profiles chain (edit) | M gains `plan-review` | P5 (conditional) |
| `hooks/fleet-send-work-order-guard.js`, `hooks/opt-in-manifest.json`, `hooks/hooks.json`, `hooks/README.md`, `docs/guide/settings-reference.md`, `CHANGELOG.md`, tests | retire the dispatch branch and stem | P8 |
| `scripts/CLAUDE.md`, `docs/scripts-inventory.md`, `skills/dev-flow/SKILL.md` table | wire each new script (dead until wired) | each |

## 4. Phases and answers

### (a) Accepting a dispatch writes size and fleet_task_id into the marker (INTERNAL, autopilot)

Today `session-mode.js set --fleet-task <id>` fetches the task, parses the title and stores `wo_*`, but nothing runs it automatically. P3 adds `scripts/work-order-adopt.js --task <id> [--session-id <id>]`:

1. Reads `fleet task show <id> --json`; size, bug and urgent come from the title SizeTag (fleet's `size_of_title`, tasks.rs:855), plan from the `Plan:` line.
2. If the live marker already has a different `fleet_task_id` (persistent lane, second task) it runs `session-mode.js set --new-task --fleet-task <id> --size <S> [--bug] [--urgent]` (`--new-task` drops the prior position and task-scoped fields, session-mode.js:1141, :1200-1238); without it size would only move up, base_ref and stage stay on the prior task, and the entry transition would exit 3.
3. Then `stage-advance.js --to <entry>` where entry comes from `stage-graph.js nodes`. If the work order is unresolved (`wo_state: unresolved`, no size) it writes that state, prints one stderr line, exits non-zero and does NOT call stage-advance.

Trigger. A lane's "accept" is not `mcp__fleet__task_accept` (that tool is the requester accepting a reported result). The hook `hooks/work-order-adopt-hook.js` fires PostToolUse on the lane's first `mcp__fleet__task_progress` or Bash `fleet task progress <id>` whose id differs from the marker's `fleet_task_id`. P3 opens with a probe (one dispatch to a canary lane, record which tool call a Claude lane makes on receipt) and fixes the matcher to what it shows. New hook = opt-in stem in `hooks/opt-in-manifest.json`, wired in `hooks/hooks.json`, listed in `hooks/README.md`, counts via `check-hook-inventory.js`. Other harnesses: section (f). Fleet does not depend on the marker: (b) re-derives without it.

### (b) What fleet re-derives, and when (INTERFACE, see (e))

Where it runs. The assignee's courier, at the same place as `used_required` (fleet--claude: the repo exists only on that host; the hub knows no member or repo). Cheap rows are implemented in Rust there (plan blob, `Task.last_merge` trailers, `Used:`); the rows that read receipt files call `node <autopilot-pin>/scripts/fleet-flow-verify.js` as a subprocess, path from courier config (a courier never launches node otherwise; non-login shells can find an old `/usr/bin/node`, fleet gotcha G28). Missing node or script degrades and warns once. P2's fixtures are the contract both implementations pass.

Output. One missing item: fleet `wire_error {"error": <code>, "detail": ...}`; several: a `ScheduleFinding` array (code, step, explanation, suggested_change, severity). Codes are lowercase snake_case.

Receipts outside git. Plan-review artifacts (`~/.autopilot/plan-review/...`, dispatch-plan-review.js:81) and code-review ledgers are lane-local and never pushed (`.githooks/pre-push` blocks evidence paths). The lane uploads them with `fleet upload` (blob sha256) and lists `Receipt: <kind>=<sha256>` lines in `task_result`; the verifier fetches the blobs and re-derives from them against git. A receipt a lane merely names but that does not bind to git bytes fails the row.

Timing is per transition, not per merge (the merge commit does not exist before finish; finish-flow merges only after qc passed):

| Event | Sizes | Fleet re-derives (command / source) | Missing -> code |
|---|---|---|---|
| leaving `plan` | M, L, XL | `Plan: path@sha` from the title: `git cat-file -e <sha>:<path>`, blob sha256 recorded. For `plan-first`: in the task's commit range `<phase-base>..<tip>` the plan path is added by a commit that is an ancestor of (or equal to) the first commit touching any other path (`git rev-list --reverse`, `git diff-tree`); the branch name is never resolved, because finish deletes it | `plan_receipt_required` / `plan_blob_missing` / `plan_not_first` |
| leaving `plan-review` | L, XL (and M if P5 lands) | uploaded plan-review artifact JSON (`artifact_type: plan_review_artifact`): `plan_sha256` equals the sha256 of the plan blob from the row above, verdict not blocking, every blocker candidate has a disposition: `check-phase-review-receipt.js` Mode B, as in `verifyLargePlanReview` | `plan_review_required` |
| leaving `code-review` | M, L, XL (urgent-low: after finish) | uploaded ledger bundle; `check-phase-review-receipt.js --ledger <extracted> --phase <id> --branch <tip> --phase-base <sha> --repo-root <repo>` Mode A. `--phase-base` is derived, not asserted: `git merge-base <merge>^1 <merge>^2` (a lane cannot shrink the reviewed range); the tip is the branch tip being merged, never the last reviewed head | `code_review_receipt_missing` |
| leaving `qc-gate` | all | no merge exists yet; only the stage-order check below. M+ pre-merge evidence is the code-review row; XS/S have no receipt before the merge (stated gap, section 6) | - |
| finish: merge sha | all | `Task.last_merge` (`TaskMerge{sha12, branch, review_generation}`, from the trailers); fall back to `git log -1 --format=%(trailers:key=QC-Verdict,valueonly)` only if absent. Check `git merge-base --is-ancestor <merge> origin/<target>`, `git cat-file -t` = commit. M+: the merge is `--no-ff` and `<merge>^2` equals the reviewed tip of the code-review row; XS/S may land with one parent | `merge_not_on_target` / `merge_not_reviewed_tip` |
| finish: qc receipt | all | the `QC-Verdict` trailer value (last paragraph only) must match `^PASS \(reviewer \S+, \d{4}-\d{2}-\d{2}\)$`; non-PASS or empty is refused. Honest limit: the value is lane-authored by design; its strength is the pre-push qc-gate (`resolve-qc-gate.sh`), which fleet cannot re-run. For M+ the reviewer id must also appear in the uploaded code-review ledger | `qc_trailer_missing` / `qc_verdict_not_pass` |
| finish: Used | all | fleet's own check (`used_required`, `used_na_reason`, stages.rs:419) stays the base. Autopilot adds one verifier row: at M+ `n/a` is accepted only with the reason "no user can run it yet" plus one end-to-end run line; `user` / `e2e` need a non-empty evidence token after the kind | `used_na_not_allowed` / `used_evidence_empty` |

Non-derivable stages: `intent`, `explore`, `research`, `proposal` (prose writers) and `diagnose` (prose:debug). Their `[stage:...]` lines are telemetry, never evidence. They are not accept gates; the only mechanical check is stage order from fleet's `Task.stages` against the export's walk, reported as a `ScheduleFinding` with severity `warn` (`diagnose_skipped`, `entry_stage_skipped`). What they produce that IS derivable (the plan blob, the plan-review artifact) is enforced by the rows above. Writing the expected text without doing the work passes only these warn-level checks and nothing that gates accept.

Fleet does not store receipts or sign anything; each call recomputes from git and the uploaded bytes. It does not re-run test suites (cost); the receipts bind a branch tip.

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
- Content: `schema`, `graph_schema`, `autopilot_version`, `source_sha256` {`stage_graph`: sha256 of `references/stage-graph.json`}, `export_sha256`, `sizes` (expanded walks per `(size, bug, urgent, explore)`), `loop_backs`, `bump_limits`, `evidence` (the table in (b) as data: event, sizes, derivation id, code), and `coarse_of_node`, a table identical to `COARSE_OF_NODE` (stage-advance.js:111-124), generated from it, so fleet's `Stage::parse` needs no node ids. Dropped from the first draft: `alarm_defaults` (fleet owns `stage_cap_ms`), the `Size:` regex (size comes only from `Task.size`), `USED_EVIDENCE_MISSING`.
- Canonical form: UTF-8, LF, keys sorted recursively, compact separators; `export_sha256` is the sha256 of that form with the field itself omitted, so two parsers agree.
- Tamper and stale detection (not just an internal checksum): fleet (a) recomputes `export_sha256`; (b) recomputes the sha256 of the pin's own `references/stage-graph.json` and compares it with `source_sha256.stage_graph` (an old but self-consistent export, or an edited export with a recomputed checksum, both fail this); (c) compares `autopilot_version` with the pin's. Any mismatch: degrade (skip the autopilot-only rows), warn once with `flow_export_stale` / `flow_export_invalid`. Negative controls in P1: an older export with a valid checksum, and an edited export with a recomputed checksum, both detected.

### (e) INTERFACE, fleet--claude reviews: joining the inbox issue model 01M7RAMY

Reviewed by fleet--claude (01M7RS0G); adopted: no new `issue.*` fields, map to what exists.

| Needed | Existing fleet carrier | Note |
|---|---|---|
| stage (and node) | `fleet tasks --json` `stage.stage` + `stage.fine` (`Task.stages`, tasks.rs:250; filled from `[stage:<coarse>/<fine>]`, tasks.rs:820); coarse outside the 7 known values is a `bad_marker` | telemetry (reported). Verified status is the verifier's result, kept apart so progress text cannot suppress alarms |
| size, bug, urgent | `Task.size` (task.proto:186) from the title SizeTag via `size_of_title` / `effective_size` (tasks.rs:855); `[bug S]`, `[!L]` | no `issue.type`; no `Size:` regex in the export |
| used | `stage.used` | |
| evidence due | `task_evidence` / `next_evidence_due` | |
| plan path@sha | new additive `Task.plan_blob` (not `plan_ref`: `Schedule.plan_ref`, task.proto:312, is a `[a-z0-9_-]` plan code) | the only new field |
| verifier verdict | a task comment (`Task.comments`, field 43) | not a field |
| dependencies | `Task.schedule` step with `ScheduleEdge{type:"data", task:<id>, step:"result", output:<name>}`; an untyped edge is refused by the gate (R1 `edge_untyped`), so every dep carries an `output` | see (h) |
| owner, deadline, used_by | `assignee`; `TaskLeaseTerms.hard_deadline_ms` (task.proto:250); a `Used:` expectation in the title | |

One interface with the scheduling gate 01M7PMGYS50QEN5JSE8A1K39FA: (h) and (i) are defined only here; the gate consumes `autopilot.plan-phases/1` (P4) and fleet's own alarm mechanisms. Delivery state ("did the receiver get it") is fleet's 01M7RH3Y; this plan only aligns: alarm and report messages are ordinary fleet sends and carry the finding code. Phase tasks are created through fleet `dispatch` (courier-held queue), not by a plugin.

### (f) Non-Claude harness lanes (codex, agy, grok)

Enforcement sits at fleet's re-derivation, so no Claude hook is needed. A lane runs plain CLI: `node scripts/work-order-adopt.js --task <id> --session-id <own-id>` at start, `node scripts/stage-advance.js --session-id <own-id> --to <node>` per node. The session id must be explicit and fresh (for example keyed by the fleet task id) because `resolveMarkerWriteTarget` refuses inherited ids when a rail exported `AUTOPILOT_PARENT_SESSION_ID` (session-mode.js:216-233, exit 3), and a cwd-keyed marker collides between concurrent sessions in one checkout. Lane briefs for fleet work orders (dispatch-author headers) carry one line: run `node scripts/fleet-flow-verify.js --task <id> --repo <path>` (read-only by default, it never mutates) before `task_result`. Read-only seats and `noncq.js` items do not call `task_result`; they are not fleet work-order lanes and get no such line. Honest limit: a harness that never writes the marker loses lane-side early refusal; fleet still refuses at result. `references/multi-agent-portability.md` stays the authority on hook parity; this plan claims none.

### (g) Retiring the PM plan-gate hook

Named: opt-in stem `pm-dispatch-plan-guard` (`hooks/opt-in-manifest.json:24`, sub-stem of `fleet-send-work-order-guard`) = the dispatch branch of `hooks/fleet-send-work-order-guard.js` (`DISPATCH_OPT_IN`, `DISPATCH_SIZE_DENY_REASON`, `DISPATCH_PLAN_DENY_REASON`), test `hooks/pm-dispatch-plan-guard.test.js`. Its dispatch-time check (Size present; M+ has `Plan:`) moves into fleet's dispatch validation (P6a), reading size from the title SizeTag. Retirement, P8, one push in the autopilot repo, after P6a is deployed and one real dispatch without Size has been refused by fleet on the canary (so there is never a window with neither system; the two repos are sequenced, not simultaneous):

1. Before deleting the test file, move its `isPmConsole` cases (pm-dispatch-plan-guard.test.js:115-139) to a new `hooks/pm-console.test.js` and its `mcp__fleet__send` regression cases (:230-247) into `hooks/fleet-send-work-order-guard.test.js`; `hooks/_shared/pm-console.js` is still used by `askpm-remind.js` and `pm-output-cap.js`.
2. Delete the dispatch branch, the stem line, the dispatch-only test cases; keep the default-on `mcp__fleet__send` branch; narrow the `hooks/hooks.json` matcher (`mcp__fleet__send|mcp__fleet__dispatch`, hooks.json:195) to `mcp__fleet__send`.
3. Update every file that names the stem (`git grep -ln pm-dispatch-plan-guard`: CHANGELOG.md, docs/guide/settings-reference.md, hooks/README.md, manifest), regenerate generated matrices, run `check-hook-inventory.js`.
4. PM console opt-in config loses the stem.

### (h) Plan freeze expands into fleet tasks (INTERFACE)

- Plan format (P4): a fenced ` ```phases ` block in the Phases section, one JSON object per line: `{"id","title","size","deps":[...],"owner","deadline","used_by"}`. `owner` is a fleet member name (`autopilot--claude`, `fleet--claude`, `pm--claude`, ...) resolved against fleet `directory`; an unresolved owner is a problem, not a guess. `deps` are phase ids of the same plan or `task:<id>`. This plan carries its own block below. `plan-template.md` self-review gains "phase block parses".
- Legacy plans (frozen before P4, such as e6f6623a, which has only a prose table with an owner column): `plan-phase-expand.js` also reads a markdown phase table whose header has an owner column (`歸屬|Owner`) and reports `legacy_table_parsed`; owner text maps to a member by name prefix, ambiguity -> `owner_unresolved`.
- Freeze event: the final-generation plan-review disposition at `plan_sha256` (M with no plan-review: entering `implement`). `node scripts/plan-phase-expand.js --repo <path> --plan <path>@<sha> --json` emits `autopilot.plan-phases/1`: phases, edges, `problems`. Fleet's gate is the consumer (invoked by the gate at its freeze event and again each tick for frozen plans), idempotent on `(plan_sha256, phase id)`.
- Expansion into fleet: one task per phase (dependencies first), `size` -> `Task.size`, `owner` -> assignee, `deadline` -> `hard_deadline_ms`, each dep -> `ScheduleEdge{type:"data", task, step:"result", output:"result"}`; the phase is a step whose `Schedule.plan_ref` is the logical plan id.
- Problems reported before work starts (to the plan's parent task as a comment, and the PM woken): no owner; unknown owner; edge to a phase absent from the block; `task:<id>` fleet does not know (T0); cycle; no deadline or `used_by`.
- Owner-task check (PM 01M7RSQF), `plan-phase-expand.js --check-tasks <fleet tasks json>`: after a freeze, every phase that has an owning lane must have a fleet task with `schedule.plan_ref` = the plan's logical id, step = the phase id, and assignee = that lane. A missing one yields finding `phase_task_missing` (step = phase id), a comment on the plan's parent task (the plan's `Fleet-Task:` header) and a PM wake. Real cases it blocks: 01M7MD5Z (P2 never created) and plan e6f6623a P5 (owner autopilot, no autopilot task). Acceptance replay: against a fleet tasks snapshot taken before this plan, the check on e6f6623a reports `phase_task_missing` for P5 (the legacy-table reader; today nothing reports it); after the expansion run, it reports none.

### (i) Dependencies are task-id edges; alarms (INTERFACE)

Edges are task ids only; `--blocked-on` targets that are member addresses or decision cards (`d-xxxxxxxx`, fleet-task.js:11-13) are a different wait kind and never trigger T0. Who alarms: fleet's scheduling gate (a stuck lane cannot alarm itself) to the waiting lane and the PM. Only two alarms are new; the rest cite fleet mechanisms that exist (fleet--claude, 01M7RS0G).

| # | Condition | Mechanism | Real case it blocks |
|---|---|---|---|
| T0 | an edge points to a task id that does not exist | NEW: schedule validator `TaskLookup`; today `is_valid_blocked_on_target` (tasks.rs:411) checks format only | observed: 01M7MD5Z "waiting on P2", no P2 task |
| T1 | target exists, no accepted owner | existing: lease `accept_by_ms` (task.proto:249) | assumption (no observed case yet): a phase task nobody picks up |
| T2 | target has no progress past its evidence due | existing: stuck check plus `task_evidence` / `next_evidence_due` | observed: the PM chased 01M7MD5Z for three rounds with nothing moving |
| T3 | progress or blocked text says the lane is waiting but no edge exists | NEW: `wait_on.rs` / `check_inprogress_wait` (tasks.rs:1753). Phrases: `waiting on`, `blocked on`, `等待`, `卡在` (not the bare character `等`, which appears in ordinary Chinese) | observed: 01M7MD5Z text-only wait |
| T4 | stage stall | existing: `stage_cap_ms` per size and stage (stages.rs:288), `whole_cap_ms`. See "PM decides" | assumption: stuck between plan-review and implement |
| T5 | accepted but stage never leaves entry | existing: `dwell_unstaged`, `UNSTAGED_CAP_MS` 24 h (stages.rs:10) | assumption: dispatch accepted and forgotten |

PM ruling: T0-T5 go live directly (no shadow period), every firing is logged as a finding with its inputs, and thresholds are re-set after 7 days from that log (P6b acceptance). Repeat alarms back off (second after twice the threshold, then PM only).

### (j) Company-management check (have now / gap / owner)

| Method | Have now | Gap | Owner |
|---|---|---|---|
| Work breakdown + critical path | 有: plan phase tables and a per-task stage graph; `check-backlog-entries.js` deps | machine phase block, task expansion, edge-based critical path = (h), (i) | autopilot (format, P4), fleet (tasks and edges, P6b) |
| Stage gates / definition of done | 有: stage-advance refusals, finish-flow rows, QC-Verdict trailer (lane-local) | fleet re-derivation (b) | autopilot (P2), fleet (P6a) |
| Kanban WIP limit per lane | none; global CLAUDE.md states the pipeline rule only | PM ruling: WIP limit 4 per lane; an accepted-but-unstarted task past the cap returns to backlog | fleet (scheduler, P6b); pm (the cap) |
| Budget lines (quota pools before the ceiling) | 有: `capacity.pace/1` rows (used_pct, hours_to_reset, waste_pct_if_unused) drive `noncq.js drain` | pre-ceiling alarm to lane + PM, dispatch routing away from a hot pool | capacity (threshold rows, P7), fleet (gate consumes), hangar (pool switch, existing) |
| Each lane keeps >= 2 startable items | 有: `check-backlog-entries.js --ready` computes `ready_count` (READY rows with deps satisfied); rule text in global CLAUDE.md | fleet-side count over tasks; fewer than two alarms the lane scheduler and PM | fleet (count, P6b), autopilot (READY marker, existing) |
| Retrospective / lessons | 有: `retro`, `learn` | none for this plan | autopilot |
| RACI / ownership per work item | 有: task assignee, backlog Queued-by | `owner` per phase = (h) | autopilot, pm |

### PM decides

- T4 total budget. Fleet's `stage_cap_ms` is per size and stage (fleet--claude example: M plan 8 h, build 24 h), plus `whole_cap_ms` and `UNSTAGED_CAP_MS` 24 h. The first draft proposed XS/S 4 h, M 12 h, L/XL 48 h in total, which conflicts. This plan cites fleet's numbers and adopts them; whether to change them is the PM's call.
- Outcome of the P0 eval (M plan-review ON/OFF): adopt or not (P5).

### The phase block (machine form; deadlines are proposals for the PM to set at freeze)

```phases
{"id":"P0","title":"Eval: M with plan-review ON vs OFF","size":"M","deps":[],"owner":"autopilot--claude","deadline":"2026-11-24","used_by":"eval result read by the PM, one line with run ids"}
{"id":"P1","title":"fleet-flow export, schema, sync gate","size":"S","deps":[],"owner":"autopilot--claude","deadline":"2026-11-22","used_by":"fleet loads the file on the PM host and prints the M walk"}
{"id":"P2","title":"fleet-flow-verify and shared fixtures","size":"M","deps":["P1"],"owner":"autopilot--claude","deadline":"2026-11-26","used_by":"allowed:true on a real finished task, allowed:false with the trailer stripped"}
{"id":"P3","title":"work-order-adopt and hook","size":"S","deps":[],"owner":"autopilot--claude","deadline":"2026-11-24","used_by":"a real dispatch shows marker fields without a manual set"}
{"id":"P4","title":"plan-phase-expand, owner-task check, template","size":"M","deps":["P1"],"owner":"autopilot--claude","deadline":"2026-11-26","used_by":"e6f6623a P5 reported missing, then none after expansion"}
{"id":"P5","title":"Add plan-review to M in the graph (conditional on P0)","size":"S","deps":["P0","P1"],"owner":"autopilot--claude","deadline":"2026-11-27","used_by":"export lists plan-review for M; one real M task passes through it"}
{"id":"P6a","title":"fleet: verifier at courier, dispatch validation, refusal codes","size":"M","deps":["P2"],"owner":"fleet--claude","deadline":"2026-12-01","used_by":"a real refused accept and a real refused no-Size dispatch, with message ids"}
{"id":"P6b","title":"fleet: phase expansion, T0, T3, WIP limit 4, startable count, trigger log","size":"M","deps":["P4"],"owner":"fleet--claude","deadline":"2026-12-03","used_by":"codeforge-shape replay fires T0; a real alarm delivered to a lane and the PM"}
{"id":"P7","title":"capacity: pre-ceiling pace rows","size":"S","deps":[],"owner":"capacity--claude","deadline":"2026-12-01","used_by":"a real pre-ceiling row consumed by the gate"}
{"id":"P8","title":"Retire pm-dispatch-plan-guard","size":"S","deps":["P6a"],"owner":"autopilot--claude","deadline":"2026-12-03","used_by":"a no-Size dispatch refused by fleet with the stem absent"}
```

Prose table (human form; the block above is authoritative):

| Phase | Size | Ships | Acceptance | Used-by evidence |
|---|---|---|---|---|
| P0 | M | eval pack and result for M plan-review ON/OFF (skills/CLAUDE.md scorecard-first; no graph change in this phase) | ON/OFF scores on the same tasks with run ids; PM reads the verdict | one-line result with run ids |
| P1 | S | `export-fleet-flow.js`, `references/fleet-flow-graph.json`, schema, sync-all gate, tests | validates against schema; editing `stage-graph.json` without regenerating turns `sync-all --check` red (negative control); `export_sha256` recomputes; old-valid and edited-recomputed exports are detected | fleet--claude loads the file on the PM host and prints the M walk (command + output line) |
| P2 | M | `fleet-flow-verify.js` (rows of (b)), SizeTag parse in `work-order-plan.js`, fixture repos usable from Rust | per row: green with evidence, red with it removed; passes on a real finished M task; `--phase-base` mismatch fails | real task id JSON `allowed:true`; one `allowed:false` with the trailer stripped |
| P3 | S | `work-order-adopt.js`, hook, canary probe of the accept signal | fixture task writes `wo_size`, `fleet_task_id`, entry stage with `wo_state: resolved`; second task uses `--new-task`; unresolved title -> `unresolved`, one stderr line, no stage-advance | a real dispatch shows marker fields without a manual `set` |
| P4 | M | phase block + legacy-table parser, `plan-phase-expand.js` (`--check-tasks`), `plan-phases.schema.json`, template line, tests (cycle, missing owner, dangling dep, owner-task check) | `problems` correct on 5 fixture plans; this plan's block parses; e6f6623a red then green (above) | gate 01M7PMGYS50QEN5JSE8A1K39FA ingests this plan's output and creates tasks with edges |
| P5 | S | `stage-graph.json` M walk gets `plan-review` after `plan`; tests; profiles chain; export regenerated | only if P0 passes; shipped as its own commit (mechanism vs guidance rule); `stage-graph.js validate` green; urgent and loop-back rows consistent | one real M task through plan-review |
| P6a | M (fleet) | courier verifier calls, `plan_blob`, dispatch validation, refusal codes | accept of an M task missing the qc trailer refused with a lowercase code | real refused accept and refused dispatch, message ids |
| P6b | M (fleet) | gate consumption of `autopilot.plan-phases/1`, T0, T3, WIP limit 4, startable count, finding log | codeforge 01M7MD5Z shape fires T0; text-only wait fires T3; fifth unstarted task returns to backlog; thresholds re-set after 7 days from the log | real alarm delivered to a lane and the PM |
| P7 | S (capacity) | pre-ceiling pace rows | row emitted when used_pct and hours_to_reset cross the line | a real row consumed by the gate |
| P8 | S | retire the hook per (g) | hook tests preserved elsewhere; inventory counts updated | the refusal observed with the stem absent |

## 5. Test / validation

- Script-gated: node tests per new script with the negative controls above; `stage-graph.js validate`; `check-hook-inventory.js` after P3 and P8; `sync-all.sh --check`; fixtures shared between Node and Rust.
- Human/PM-gated: freeze of this plan; the "PM decides" items; the M plan-review adoption after P0.
- Done (global baseline) only when a real lane has had an M task refused and an alarm delivered on fleet (P6a, P6b Used-by), and e6f6623a's P5 case has gone from undetected to detected.

## 6. Risks + inversion

What guarantees failure: (1) the verifier trusts lane text instead of git: mitigated by deriving from the merge commit, ancestry, derived `--phase-base` and uploaded receipts bound to git bytes; the QC trailer value stays lane-authored (stated limit), and XS/S have no pre-merge receipt. (2) Two systems: fleet refuses and the hook also denies with different rules: P8 only after P6a is observed live. (3) Alarm noise: logged triggers, backoff, thresholds re-set on data after 7 days. (4) Export drift: pin read plus `source_sha256` and version comparison. (5) Stale phase block after a plan edit: expansion keyed by `plan_sha256`; a changed plan is a new freeze. (6) The M plan-review requirement is not enforceable until P5 lands; until then M enforces plan blob only. (7) Hand-written phase blocks wrong: parser errors at plan-review time. (8) Degrade-and-warn lets a broken verifier go unseen: the warning is a finding in the log; a warning that repeats for 24 h goes to the PM. (9) Fleet `last_merge` trailer scan missing a trailer: verifier falls back to git.

## 7. Out of scope

- Changing the graph's nodes or sizes, except P5.
- Fleet's internal storage, UI and the inbox issue model beyond the single `plan_blob` field (fleet--claude owns).
- Delivery-state tracking (did the receiver get it): fleet 01M7RH3Y; this plan only keeps messages ordinary sends carrying finding codes.
- Re-running test suites on the fleet side; judging explore/research/proposal/diagnose content.
- Capacity's pacing math and hangar's pool switching beyond the P7 rows.
- Credentials, approval gates (`fleet approve` stays human-only), anything outward-facing; hosted CI; any version bump; renaming or privatizing the repo.

## 8. Open questions

1. Which tool call does a Claude lane make on receiving a dispatch (decides the P3 hook matcher)? Settled by P3's probe, not by the Board.
2. Does the courier call the verifier as a node subprocess (configured autopilot pin path) or port the receipt rows? fleet--claude recommends the subprocess for receipt rows and Rust for cheap rows; P6a confirms.

## Review log

- R0: author = chair (Sonnet), draft 2026-11-19; rubric `project/plans/2026-11-19-fleet-stage-graph-binding.rubric.md` (ids R1..R11 unchanged); manifest beside the plan.
- Generation 1 (astra chair + carbon red-team): CONDITIONAL, 18 findings (13 blocking, 5 non-blocking); disposition in `project/plans/2026-11-19-fleet-stage-graph-binding.disposition.json` (generation 1); every claim re-verified against code.
- Generation 2 revision: adopts fleet--claude's interface review 01M7RS0G, the PM rulings (M through plan-review after an eval; T1-T5 live directly with logged triggers and a 7-day threshold reset; WIP limit 4; T4 conflict to "PM decides") and the PM 01M7RSQF owner-task check. Rubric R3, R6, R9 wording updated to match (ids unchanged), so the rubric seal is re-taken for generation 2.
