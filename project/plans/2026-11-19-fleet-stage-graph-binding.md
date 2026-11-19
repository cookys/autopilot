# Plan — Bind the work lifecycle into fleet's mechanized flow (stage graph export, receipt re-derivation, dependency alarms)

> Status: draft for plan-loop review. Owner: autopilot lane (planner: chair draft). Consumers: fleet--claude (interface review), PM (freeze), fleet scheduling gate 01M7PMGYS50QEN5JSE8A1K39FA.
> Branch: `plan/fleet-stage-graph`. Frame: plan only; no implementation ships with this file. Version stays 3.0.0-alpha line (no bump).
> Logical plan id: `fleet-stage-graph-binding`.

## 0. Context / thesis

Source (operator, verbatim):

- 「你忘記做 brainstorm / survey -> plan -> plan loop review -> dev-flow -> qc gate -> finish flow 這件事情，是不是可以綁到在 fleet pm sys 裡面的機械化流程中? 只是那個 harness flow graph 可能要設計一下?」
- 「這種查證應該讓 pm sys 自動化? 看是做成 script 還是怎樣? 理論上中間卡住應該要告警你? 看怎樣把它系統化?」
- 「{pm, fleet, autopilot, capacity, hangar} 整套系統根本是在營運一間公司的內部管理機制了?」

What already exists in this repo (do not re-invent):

- The graph: `references/stage-graph.json` (schema `autopilot.stage-graph/1`, `schemas/stage-graph.schema.json`) with 12 `node_ids`, per-size walks for XS..XL, bug and urgent variants, loop-backs, bump limits and a `writers` map. Query CLI: `scripts/stage-graph.js` (`nodes|next|validate|limits`, header lines 4-20).
- The telemetry writer: `scripts/stage-advance.js`. Each transition appends `[stage:<coarse>/<node>] <unit>` to the fleet task via `scripts/lib/fleet-task.js progress()` (stage-advance.js:160, :1058). Fleet receives text and blocks nothing.
- Work-order fields in the marker: `fleet_task_id, wo_task, wo_size, wo_plan, wo_state, wo_fetched_at, plan_receipt` (stage-advance.js:993 copy list; scripts/session-mode.js:960-1040 `fetchAndResolveWorkOrder` / `applyWorkOrderToMarker`). Size and Plan are parsed from the fleet task title by `scripts/lib/work-order-plan.js` (`Size:` and `Plan: <path>@<sha>|plan-first`).
- Lane-side enforcement already present but local to the lane: for wo_size M/L/XL, stage-advance refuses to enter `implement` without a plan receipt (`PLAN_RECEIPT_REQUIRED`, `PLAN_BLOB_MISSING`, stage-advance.js:841-884); for L/XL it also requires a passing plan-review receipt (`verifyLargePlanReview`, :698, delegating to `scripts/check-phase-review-receipt.js` Mode B). Code-review receipts: same script Mode A (header lines 3-9). Plan review rail: `scripts/dispatch-plan-review.sh`/`.js`.
- The PM plan gate: opt-in hook stem `pm-dispatch-plan-guard` (hooks/opt-in-manifest.json:24), implemented as the dispatch branch of `hooks/fleet-send-work-order-guard.js` (header lines 13-18; denies a PM dispatch with no Size, or Size M+ with no `Plan:`), tested by `hooks/pm-dispatch-plan-guard.test.js`.
- finish-flow requires one `Used:` line and the `QC-Verdict:` trailer on the merge commit (skills/finish-flow/SKILL.md rows "qc verdict", "Merge", item 7).

The gap: every check above runs inside the lane's own session and its own hooks, so a lane that skips the flow, runs on a harness without Claude hooks, or never ran `session-mode.js set --fleet-task` (there is no automatic adoption today) is invisible to fleet. And dependencies between tasks are prose. This plan moves verification to fleet's side of the boundary, by re-derivation from git and receipt files (ADR-0001), and makes a plan's phase table a source of fleet tasks and edges.

## 1. Problem

1. A dispatched M+ task can be accepted with no plan, no plan-loop verdict, no qc receipt, or an un-reviewed merge. Nothing outside the lane notices. (Real case: this repo's own "forgot brainstorm/survey -> plan -> review" slip that triggered the operator's first quote.)
2. A plan freezes with a phase table, but fleet learns nothing from it. Real case: codeforge task 01M7MD5Z wrote "waiting on P2" in text; no P2 task existed on fleet, no alarm fired, the PM chased it for three rounds.
3. The graph lives only in autopilot, so fleet cannot know which stage is legal or what evidence a stage owes.

## 2. OKR / KRs

- O: a fleet task of size M+ cannot be accepted unless fleet itself re-derived the evidence for every stage the graph requires for that size and type.
- KR1: `fleet-flow-verify` run on a task with each single piece of evidence removed refuses (negative control per evidence kind, section 4 P2), and passes on one real completed task.
- KR2: freezing a plan creates one fleet task per phase with task-id dependency edges; a phase with a missing owner or an edge to a nonexistent phase is reported at freeze time. Replaying the codeforge 01M7MD5Z shape produces the alarm within the T1 threshold (section 4 (i)).
- KR3: after P6 the PM plan-gate hook is gone and nothing else changed behavior (one system, not two).

## 2.5 Global Constraints (copied verbatim into every dispatch)

- ADR-0001: verify by independent re-derivation from git and receipt files. No hash chains, ledgers, witness receipts, attestation or trust roots are added.
- autopilot is the only source of the stage graph; fleet never hand-copies node lists or evidence tables.
- Node >= 20.10, built-ins only for every new script; bash only for pure git glue.
- Every new check ships a negative control shown red before green (evidence-discipline section 58).
- No hosted CI. No version bump. No new JSON-schema script beyond the two named in P1/P4.
- Text such as "waiting on X" never counts as a dependency; only task-id edges do.
- Migrate, do not run two systems: the PM plan-gate hook retires in the same push that turns fleet's refusal on (P6).

## 2.6 Change-policy decisions

- **Compatibility impact**: `published-compatible`. Adds one new versioned export (`autopilot.fleet-flow/1`) and two new scripts; existing `stage-graph.json`, marker fields and `[stage:...]` progress lines are unchanged. Consumer: fleet (new reader). P6 removes the `pm-dispatch-plan-guard` opt-in stem: its only consumer is the PM console; migration is P5 landing first (section 4 (g)).
- **Dependency decision**: `none`. Node built-ins and existing scripts only.

## 3. File-structure map

| File | Responsibility | Phase |
|---|---|---|
| `scripts/export-fleet-flow.js` (new) | derive `autopilot.fleet-flow/1` from `references/stage-graph.json` + evidence table | P1 |
| `references/fleet-flow-graph.json` (new, generated) | the versioned export fleet reads | P1 |
| `schemas/fleet-flow.schema.json` (new) | schema for the export | P1 |
| `scripts/fleet-flow-verify.js` (new) | per-transition re-derivation, one JSON verdict, exit code | P2 |
| `scripts/lib/work-order-plan.js` (existing) | stays the one Size/Plan parser; fleet reads its rules via the export | P1 |
| `scripts/work-order-adopt.js` (new, thin) or a `session-mode.js set --fleet-task` hook wiring | automatic marker write on accept (a), harness-neutral | P3 |
| `scripts/plan-phase-expand.js` (new) | parse the plan's machine-readable phase block into `autopilot.plan-phases/1` | P4 |
| `references/plan-template.md` (edit) | add the phase block format to section 4 of the skeleton | P4 |
| `hooks/fleet-send-work-order-guard.js`, `hooks/opt-in-manifest.json`, `hooks/pm-dispatch-plan-guard.test.js` (edit/delete) | retire the dispatch branch and stem | P6 |
| `scripts/CLAUDE.md`, `docs/scripts-inventory.md`, `skills/dev-flow/SKILL.md` table | wire each new script (dead until wired) | each |

## 4. Phases and answers

### (a) Accepting a dispatch writes size and fleet_task_id into the marker (INTERNAL, autopilot)

Today `session-mode.js set --fleet-task <id>` does the work (fetches `fleet task show <id> --json`, parses the title, stores `wo_*`) but nothing runs it automatically. P3: `scripts/work-order-adopt.js --task <id>` = `set --fleet-task <id>` plus `stage-advance --to` the entry node of the walk for the parsed size/type (entry from `stage-graph.js nodes`). It is invoked (1) on Claude Code by a PostToolUse hook on `mcp__fleet__task_accept` (the lane-side accept), and (2) on other harnesses by the lane's brief/boot step (section (f)). Failure mode it prevents: lane starts work with `wo_state` absent, so `stage-advance` has no size to enforce. Fleet does not depend on this marker: (b) re-derives everything without it; the marker only makes lane-side early refusal work.

### (b) What fleet re-derives at each transition (INTERFACE, see (e))

Fleet calls `node <autopilot>/scripts/fleet-flow-verify.js --task <id> --to <node> --repo <path> --json` (or the equivalent in-process port, which must pass the same fixtures) at each stage transition and at `task_result`/`accept`. Exit 0 = allowed; non-zero = refused, stdout JSON `{allowed, code, to, missing:[...]}`. Fleet refuses `task_result`/`accept` on any non-zero. Inputs are only the task (title, progress lines, result text) and the repo; nothing the lane asserts is trusted without re-derivation:

| Transition into | Required for sizes | Fleet re-derives (command / source) | Missing -> code |
|---|---|---|---|
| `plan` complete (enter implement or plan-review) | M, L, XL | `Plan: path@sha` from title resolves: `git cat-file` blob at that sha exists and sha256 matches (reuse `derivePlanReceiptFromGit`, session-mode.js ~:900; for `plan-first`, plan path in the result text must resolve at HEAD of the task branch) | `PLAN_RECEIPT_REQUIRED` / `PLAN_BLOB_MISSING` |
| `plan-review` complete | L, XL (M: see open question 1) | plan-review artifact JSON (`artifact_type: plan_review_artifact`) whose `plan_sha256` equals the plan blob's sha256, verdict not blocking, and every blocker candidate has a disposition: `check-phase-review-receipt.js --plan-artifact ... --dispositions ...` (Mode B), found as in `verifyLargePlanReview` | `PLAN_REVIEW_REQUIRED` |
| `code-review` complete | M, L, XL (urgent-low: terminal after finish) | `check-phase-review-receipt.js --ledger ... --phase ... --branch <tip>` Mode A against the branch tip being merged (CLAUDE.md process rule: tip, never last reviewed head) | `CODE_REVIEW_RECEIPT_MISSING` |
| `qc-gate` complete | all sizes | merge commit last paragraph carries `QC-Verdict: PASS (reviewer <id>, <date>)`: `git log -1 --format='%(trailers:key=QC-Verdict,valueonly)' <merge>` non-empty, and the merge commit is `--no-ff` with the reviewed tip as a parent | `QC_TRAILER_MISSING` |
| `finish` complete (task_result/accept) | all sizes | merge sha in the result text: `git merge-base --is-ancestor <merge> origin/<target>` true and `git cat-file -t` = commit; result text has exactly one `Used: user|e2e|n/a <reason>` line, where `n/a` without a reason is refused and for M+ `n/a` is accepted only with the reason "no user can run it yet" plus one end-to-end run line | `MERGE_NOT_ON_TARGET` / `USED_EVIDENCE_MISSING` |
| `diagnose` (bug) | any bug | not machine-derivable (prose writer); fleet checks only that the task's progress shows a `[stage:...diagnose]` line before the first `implement` line | `DIAGNOSE_SKIPPED` |
| `explore`/`research`/`proposal`/`intent` | L, XL | same progress-order check; their content is judged by plan review, not by fleet | `ENTRY_STAGE_SKIPPED` |

Boundaries: stage order is checked against the export's walk for (size, bug, urgent, explore); loop-backs from the export are legal. Fleet does not store receipts or sign anything; each call recomputes from git. A lane may claim "tests green"; fleet does not re-run suites (cost), it re-derives only the receipts above, which themselves bind a branch tip.

### (c) Flow graph by size and type (INTERNAL; source of truth `references/stage-graph.json`)

```mermaid
flowchart LR
  XS[XS: implement -> qc-gate -> finish]
  S[S: implement/verify loop -> qc-gate -> finish]
  M[M: plan -> implement/verify loop -> code-review -> qc-gate -> finish]
  subgraph LXL[L / XL]
    direction LR
    I[intent] --> R{{research optional: survey}} --> PR[proposal] --> P[plan] --> PRV[plan-review] --> L[implement/verify loop] --> CR[code-review] --> Q[qc-gate] --> F[finish]
    E[explore: brainstorm] --> P
  end
  D[diagnose] -. bug: prepend at XS..M, replaces intent at L/XL .-> XS
```

| Size / type | Walk (nodes in order) | Entry | Notes |
|---|---|---|---|
| XS | implement, qc-gate, finish | implement | no plan; bump limit 2 files / 20 lines |
| S | (implement, verify) x units, qc-gate, finish | implement | no plan; 6 files / 200 lines |
| M | plan, (implement, verify) x units, code-review, qc-gate, finish | plan | plan receipt required; no plan-review node in the graph today |
| L | intent, [research], proposal, plan, plan-review, loop, code-review, qc-gate, finish | intent | `--explore` slices the walk at `plan` and prepends `explore` |
| XL | same as L, unit kind `deliverable` | intent | same |
| any bug, XS..M | diagnose then the size's walk | diagnose | `bug_node` prepend |
| bug, L/XL | diagnose replaces intent | diagnose | replace |
| urgent-low | code-review moves after finish and is terminal, no loop-back | as size | `urgent --high-risk` keeps normal order |

When brainstorm vs survey (L/XL entry, from the skill contracts): `explore` (writer `autopilot:brainstorm`) when the options do not exist yet and the design must be discovered; `research` (writer `survey` / `probe-unknown.js`) when the option space is known but an external fact or industry practice is unknown. Both precede `proposal`/`plan`; `explore` replaces intent/research/proposal in the walk, `research` is the optional node. Neither is fleet-derivable; fleet only checks they appear before `plan` (table above).

### (d) autopilot is the single source; fleet reads a versioned export (INTERFACE)

- Name and version: schema `autopilot.fleet-flow/1` (`schemas/fleet-flow.schema.json`). Additive changes keep `/1`; any removed or renamed field bumps to `/2` and fleet must refuse an unknown major.
- Lives at `references/fleet-flow-graph.json` in the autopilot plugin, produced by `node scripts/export-fleet-flow.js` and byte-gated in `scripts/sync-all.sh --check` like other mirrors. Fleet reads it from the autopilot version pinned on its host (hangar pin), never from a copy it maintains.
- Content: `schema`, `graph_schema` (the `autopilot.stage-graph/1` it derives from), `autopilot_version`, `export_sha256` (of the rest), `sizes` with expanded walks for every variant key `(size, bug, urgent, explore)` (precomputed from `stage-graph.js`, so fleet needs no walk logic), `loop_backs`, `evidence` (the table in (b) as data: node, sizes, derivation id, refusal code), `work_order_fields` (the `Size:`/`Plan:` regexes from `work-order-plan.js`), `alarm_defaults` (section (i) thresholds).
- Fleet verifies the export by recomputing `export_sha256`; a mismatch refuses all transitions with `FLOW_EXPORT_INVALID` (fail closed for M+, fail open with one alarm for XS/S).

### (e) INTERFACE, fleet--claude reviews: joining the inbox issue model 01M7RAMY

Proposed, to be corrected by fleet--claude (autopilot has not read 01M7RAMY; every field name below is a proposal):

- `issue.size` (XS..XL), `issue.type` (`feature|bug|urgent-low|urgent-high`), `issue.stage` (a node id from the export; set by the `[stage:coarse/node]` progress line or by fleet's own verify, whichever is later), `issue.plan_ref` (`path@sha`), `issue.depends_on` (list of task ids, the only dependency form), `issue.evidence_due` (existing `task_evidence`), `issue.used` (the `Used:` line, set at accept), `issue.flow_verdict` (last `fleet-flow-verify` JSON, informational only; never the source of truth).
- One interface with the scheduling gate: this section is the only place that defines (h) and (i); gate 01M7PMGY consumes `autopilot.plan-phases/1` (P4) and `alarm_defaults` (export). Questions for fleet--claude: where does an issue's stage live relative to the existing task progress line; does `task_result` refusal return a machine code the lane can read; can fleet run a node script on the PM host or must the verifier be ported (then fixtures from P2 are the contract).

### (f) Non-Claude harness lanes (codex, agy, grok)

No Claude hook is needed because the enforcement point is fleet's re-derivation, not the lane. What the lane does is plain CLI: `node scripts/work-order-adopt.js --task <id>` at start (session id from `AUTOPILOT_SESSION_ID`, or `CODEX_THREAD_ID`, then cwd: `session-mode.js getSessionId`, :183), `node scripts/stage-advance.js --to <node>` at each node, receipts from the same rails (`dispatch-plan-review`, `dispatch-review`) which are shell/Node. Lane briefs (dispatch-author, noncq) carry one line "run `fleet-flow-verify --dry-run` before task_result", the same style as the `noncq add` gate-header check (scripts/noncq.js header). Honest limit: if the harness never writes the marker, lane-side early refusal is absent; fleet still refuses at result. The platform doc stays the authority on which harness has which hooks (references/multi-agent-portability.md); this plan claims no hook parity.

### (g) Retiring the PM plan-gate hook

Named: opt-in stem `pm-dispatch-plan-guard` = the dispatch branch of `hooks/fleet-send-work-order-guard.js` (constants `DISPATCH_OPT_IN`, `DISPATCH_SIZE_DENY_REASON`, `DISPATCH_PLAN_DENY_REASON`), manifest entry `hooks/opt-in-manifest.json:24`, test `hooks/pm-dispatch-plan-guard.test.js`. Its dispatch-time check (Size present, M+ has Plan marker) moves to fleet's dispatch validation using the export's `work_order_fields`. Retirement step (P6, one push): (1) confirm fleet refuses a no-Size / M-without-Plan dispatch and an M+ accept missing evidence on the canary; (2) delete the dispatch branch, the stem, the manifest line and the test, keep the default-on `mcp__fleet__send` branch; (3) CHANGELOG + `check-hook-inventory.js` count; (4) PM console opt-in config loses the stem. Not before step (1) has run on a real dispatch, so there is never a window with neither system.

### (h) Plan freeze expands into fleet tasks (INTERFACE)

- Plan format (P4): section 4 of every plan gets one fenced block ` ```phases ` of JSON lines: `{"id":"P1","title":"...","size":"S","deps":[],"owner":"autopilot","deadline":"YYYY-MM-DD","used_by":"..."}`. `deps` are phase ids (same plan) or `task:<id>` (existing task elsewhere). The plan-template self-review gains one line "phase block parses". Prose tables remain for humans; the block is the machine form.
- Freeze event: the plan-review disposition for the final generation (or, for M with no plan-review, the stage-advance into `implement`) at the frozen `plan_sha256`. `node scripts/plan-phase-expand.js --plan <path>@<sha> --json` emits `autopilot.plan-phases/1`: phases, edges, and a `problems` list.
- Fleet (scheduling gate 01M7PMGY) consumes it idempotently keyed by `(plan_sha256, phase id)`: creates one task per phase in the owner lane's backlog with `depends_on` = task ids of the dependency phases (created first, topological order). `problems` it must refuse before any phase starts: phase with no `owner`; `owner` not a known lane; edge to a phase id absent from the block; `task:<id>` that fleet does not know; a cycle; a phase with no deadline or `used_by`. These are reported to the plan author and PM at freeze. Real case it blocks: 01M7MD5Z "waiting on P2" with no P2 task. Autopilot's part is the parser and the format; creation and reporting are fleet's.

### (i) Dependencies are task-id edges; alarms (INTERFACE)

Who alarms: fleet's scheduling gate (cron-like tick in fleet, not the lane's own session, since a stuck lane cannot alarm itself) sends the alarm to the waiting lane and the PM. Autopilot supplies the lane-side verb (`scripts/lib/fleet-task.js blocked(taskId, blockedOn, note)` already writes `--blocked-on <task id>`) and the defaults in the export. Thresholds (defaults, tunable in `alarm_defaults`; each blocks a named real case):

| # | Condition | Threshold | Real case it blocks |
|---|---|---|---|
| T0 | edge points to a task id that does not exist | immediate, at edge creation or first tick | 01M7MD5Z: "waiting on P2", no P2 task |
| T1 | waiting target exists but has no accepted owner | 1 h after the edge is created | a phase task created at freeze that no lane picks up, so its dependents idle |
| T2 | target has no progress line past its `evidence_due`; with no `evidence_due`, 24 h since its last progress | at deadline | PM chasing for three rounds because nothing moved and nothing said so |
| T3 | progress/blocked text matches "waiting on / blocked on / 等" with no `--blocked-on` edge | next tick | text-only wait counts for nothing; lane is told to add the edge |
| T4 | stage stall: no new `[stage:...]` line past the size's budget (XS/S 4 h, M 12 h, L/XL 48 h) while the task is `running` | at budget | a lane stuck between plan-review and implement with nobody told |
| T5 | task stays `accepted` but `stage` never leaves entry | 2 x entry budget | a dispatch accepted and forgotten |

Repeat alarms back off (second after 2x the threshold, then PM only) to avoid noise.

### (j) Company-management check (do we have it, the gap, who fills it)

| Method | Have now | Gap | Owner |
|---|---|---|---|
| Work breakdown + critical path | partial: plans have phase tables (prose), stage graph per task | machine phase block, task expansion, edge-based critical path | autopilot (format, P4), fleet (tasks, edges: (h), (i)) |
| Stage gates / definition of done | 有 (stage-advance plan and plan-review refusal, finish-flow rows, QC-Verdict trailer) | only lane-local today; fleet re-derivation (b) | autopilot (verifier P2), fleet (refusal) |
| Kanban WIP limit per lane | none; global CLAUDE.md states the pipeline rule only | per-lane cap on `running`; an unstarted accepted task past the cap returns to backlog automatically | fleet (scheduler); pm sets the cap per lane |
| Budget lines (quota pools before the ceiling) | partial: `capacity.pace/1` rows (used_pct, hours_to_reset, waste_pct_if_unused) already drive `noncq.js drain` | pre-ceiling alarm (e.g. used_pct >= 85 with hours_to_reset > 24) to lane + PM, and dispatch routing away from a hot pool | capacity (emit threshold rows), fleet (gate consumes), hangar (pool switch, existing) |
| Each lane keeps >= 2 startable items | rule text only (global CLAUDE.md, pipeline) | machine count of backlog rows with all deps done and an owner; fewer than 2 alarms the lane's scheduler and PM | fleet (count), autopilot (BACKLOG READY marker already per row; read it) |
| Retrospective / lessons | 有 (`retro`, `learn`) | none for this plan | - |
| RACI / ownership per work item | partial: phase `owner` field proposed in (h) | none beyond (h) | autopilot, pm |

### Phases

| Phase | Size | Ships | Acceptance | Used-by evidence |
|---|---|---|---|---|
| P1 | S | `export-fleet-flow.js`, `references/fleet-flow-graph.json`, schema, sync-all gate, tests | export validates against its schema; editing `stage-graph.json` without regenerating makes `sync-all --check` red (negative control); `export_sha256` recomputes | fleet--claude loads the file on the PM host and prints the M walk (command + output line) |
| P2 | M | `fleet-flow-verify.js` with every row of (b), fixtures, negative control per evidence kind | one fixture repo per row: green with evidence, red with it removed; passes on a real finished M task | run on a real completed task id, JSON `allowed:true`; and one `allowed:false` on a task with the trailer stripped |
| P3 | S | `work-order-adopt.js`, PostToolUse wiring for `task_accept` on Claude, boot line for other harnesses | accept of a fixture task writes `wo_size`, `fleet_task_id`, entry stage to the marker with `wo_state: resolved`; unresolved title -> `unresolved` + one stderr line | a real dispatch to a lane shows marker fields without a manual `set` |
| P4 | M | phase block in `plan-template.md`, `plan-phase-expand.js`, rubric line, tests (cycle, missing owner, dangling dep) | `problems` list correct on 5 fixture plans; this plan's own phase block parses | fleet gate 01M7PMGY ingests this plan's output and creates the P1..P6 tasks with edges |
| P5 | M (fleet-owned) | fleet: call verifier at transitions and accept; scheduler alarms T0..T5; WIP cap; startable-count; capacity pre-ceiling rows | replay of the codeforge 01M7MD5Z shape fires T0; accept of an M task missing the qc trailer is refused | a real alarm delivered to a lane and the PM; a real refused accept, with message ids |
| P6 | S | retire `pm-dispatch-plan-guard` (section (g)) | dispatch with no Size is refused by fleet, not the hook; hook test file gone; inventory counts updated | the same real refusal observed with the stem absent |

## 5. Test / validation

- Script-gated: each new script has a node test with the negative controls named in the phase table; `scripts/stage-graph.js validate` stays green; `check-hook-inventory.js` after P6; `sync-all.sh --check`.
- Human/PM-gated: freeze of this plan; fleet--claude's review of the INTERFACE sections ((d), (e), (h), (i)); the thresholds in (i) and WIP caps in (j).
- Done (per global baseline) only when a real lane has had an M task refused and an alarm delivered on fleet (P5 Used-by).

## 6. Risks + inversion

What guarantees failure: (1) the verifier trusts lane-supplied text instead of git, so a lane that writes "QC-Verdict: PASS" in prose passes: mitigated by re-deriving from the merge commit's own trailer and ancestry only. (2) Two systems: fleet refuses and the hook also denies, with different rules: mitigated by P6 in the same push as P5 enforcing. (3) Alarm noise trains everyone to ignore it: backoff and PM-only escalation; thresholds are data, tuned from the first week. (4) Export drift: fleet keeps a copy: pin read plus `export_sha256` check. (5) Phase block gets stale after a plan edit: expansion keyed by `plan_sha256`; a changed plan is a new freeze and fleet reports the diff instead of silently re-creating. (6) M has no plan-review node, so "plan-loop verdict at M+" cannot be enforced without changing the graph (open question 1). (7) Every lane hand-writes the phase block wrongly: parser errors at plan-review time, not at freeze.

## 7. Out of scope

- Changing the graph's nodes or sizes (only exposing it), except the open question on M plan-review.
- Fleet's internal storage, UI, and the inbox issue model beyond the proposed fields (fleet--claude owns).
- Re-running test suites on the fleet side; judging explore/research/proposal content.
- Capacity's pacing math and hangar's pool switching (only the alarm rows are requested).
- Credentials, approval gates (`fleet approve` stays human-only), anything outward-facing.
- Hosted CI; any version bump; renaming/privatizing the repo.

## 8. Open questions

1. M tasks: the graph has `plan` but no `plan-review`, while the operator's (b) lists the plan-loop verdict for "M and above". Options: (A) keep M plan-receipt only, plan-loop verdict L/XL (today's behavior); (B) add a lightweight `plan-review` to M (graph change, needs eval per skills/CLAUDE.md). Recommendation: A now, revisit after P5 data.
2. Alarm thresholds (T1..T5) and the WIP cap are defaults without data; PM to confirm or adjust before P5 enforcement.
3. Can fleet run `fleet-flow-verify.js` directly from the pinned autopilot on its host, or must it be ported? (fleet--claude; affects P2 packaging only.)

## Review log

- R0: author = chair (Sonnet), single draft, 2026-11-19; rubric `project/plans/2026-11-19-fleet-stage-graph-binding.rubric.md`; manifest to be written beside the plan before review.
- Generation 1 / 2: pending.
