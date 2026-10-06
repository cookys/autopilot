---
name: dev-flow
description: >
  Start here before writing any code — sizes the task (XS/S/M/L/XL, bug, urgent `!`), sets up branch and session rules.
  Use when: "I'm starting on X", "quick fix for Y", "continuing from yesterday", "hotfix needed",
  "let's implement X", "skip to coding", "我要開始做 X", "快速修一下", "接續昨天的進度",
  resuming a feature branch, or any task that touches code. Not for: debugging
  (→ debug), authoring a plan doc (→ references/plan-template.md), pre-code design
  exploration (→ brainstorm), or code review (→ quality-pipeline).
---

# Development Flow

## Project Config (auto-injected)
!`cat .claude/dev-flow-config.md 2>/dev/null || true`

## Model Routing (for subagent dispatch)
!`cat .claude/model-routing-config.md 2>/dev/null || true`

If no project config above, use defaults from [references/model-routing.md](references/model-routing.md).

## Dispatch Chains (for orchestrator routing)
!`cat .claude/dispatch-config.md 2>/dev/null || true`

If no project config above, autopilot's own fallback skills are primary for methodology; `native` Task dispatch for parallel; `autopilot:reviewer` for code review. See [project-config-template/dispatch-config.md](../../project-config-template/dispatch-config.md) for the schema.

---

## Session Start

Run before any code change. Steps 1 and 4 run at every size (bug, urgent included); step 1 precedes any research or
question, so every session has a marker. `references/stage-graph.json` alone defines which nodes run; this skill
says what to do inside each. Script contract and exits: [references/stage-graph.md](references/stage-graph.md).

```
1. Size the task (table below), then record it — the flags are separate, never `--size M!`:
   node scripts/session-mode.js set --size <XS|S|M|L|XL> [--urgent] [--bug]
2. Read your node sequence (never copy it from prose):
   node scripts/stage-graph.js nodes --size <size> [--bug] [--urgent]
3. Run the start gates for your size (gate table below).
4. Enter the first node: node scripts/stage-advance.js --to <entry from step 2>
```

**No human available** (headless `-p`, a just-results level `/l3`–`/l6`, CEO mode): never stop to ask. Wherever this
skill says ask, confirm, pick or "unsure ⇒ ask", take the recommended option (within DOA when one is set), record it
as a decision taken on the owner's behalf, and continue: `node scripts/decision-ledger.js append --kind decision
--json '{"decision_id":"<node>-<n>","class":"tactical","rationale":"<question → choice, why>","reversibility":"two-way"}'`
(the default ledger the status band counts as ◆; the owner vetoes with `decision-ledger.js veto --id`; ceo-agent
`references/depth0-control-loop.md` §6). Board-class stops stay stops: scope expansion, a DOA boundary, and the
User Override Protocol's cannot-be-overridden list.

### Sizing

| Size | Predicate — decide structure first (XL, then L); otherwise the smallest of XS, S, M that holds |
|------|-----------|
| **XL** | Several deliverables that are independent of each other and each shippable alone |
| **L** | One deliverable in multiple phases that build on each other, OR an open design question, a public API change, incompatible data, a feature flag, or the user asks for planning |
| **M** | One deliverable touching several modules or adding a module, design already clear; fits `stage-graph.js limits --size M` |
| **S** | One module, one commit, no interface change beyond an additive flag; fits `stage-graph.js limits --size S` |
| **XS** | One spot (a value, a message, one condition) plus the test that pins it; fits `stage-graph.js limits --size XS` |

| Modifier | Predicate | Flag |
|----------|-----------|------|
| bug | The task is to make existing wrong behavior right. Size it by the fix's footprint: a cause that spans several modules, or is not yet located among several, is at least M; module count alone never makes a bug L | `--bug` (entry node `diagnose`) |
| urgent | Production is broken, or the user says it must ship now / today / within hours | `--urgent` (written `S!` / `S急` in prose and backlog) |

- Pick the smaller size only when two sizes genuinely fit their predicates: the E1 bump (`stage-advance.js` exit 4)
  moves the size up when the diff outgrows it. L and XL are decided by structure, not by diff size.
- Urgency never lowers the size: the urgent "smallest change" is about the diff, not the size flag.
- Risk (money/points, auth/security, production protocol) does not change the size. It raises review strength:
  `scripts/resolve-review-loop.sh` reads it from `classify-diff-risk.sh` (`review_risk`).
- Size moves only up (`set --size` refuses a downward move). A resumed session never re-sizes.

### Start gates

| Gate | Sizes | How | Enforcer |
|------|-------|-----|----------|
| Confirm task | all | Restate what will be done in one sentence (bug: the symptom and, when known, the root cause) | documented-only |
| Branch check | all | `git branch --show-current`; bug ⇒ `git checkout -b fix/<description>`; production broken ⇒ `git checkout -b hotfix/<description> main` | documented-only |
| Session start SHA | M, L, XL | `git rev-parse HEAD > .claude/session-start-sha` | documented-only |
| Branch freshness | M, L, XL | `git log HEAD..main --oneline \| wc -l` (behind) and `git log main..HEAD --oneline \| wc -l` (ahead) → freshness table; no `main` ⇒ skip | documented-only |
| Knowledge review | M, L, XL | `.claude/knowledge/` for prior learnings; unprocessed session digests; for L/XL also the ladder probe at `intent` | documented-only |
| Draft plan overlap | M, L, XL | `ls docs/plans/*.md` (or the configured path): same feature / module / user story ⇒ normal mode asks the user whether to adopt the draft; CEO mode decides within DOA | documented-only |
| Skill routing | all | Project skills for the target code area (CLAUDE.md, `.claude/skill-routing.md`) are invoked before code is written; L/XL via the skill-routing TaskCreate at `intent` | TaskCreate + blockedBy (L/XL); documented-only (XS–M) |
| TaskCreate tools | all | TaskCreate missing from the tool list (Claude 5-era models are gated off by default since CC 2.1.233) ⇒ warn the user once to set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` via `.claude/settings.json` `env` and continue — advisory, never a blocker (`references/multi-agent-portability.md`, task-persistence row) | documented-only |

Branch freshness:

| Behind | Ahead | Status | Action |
|--------|-------|--------|--------|
| 0 | any | Up to date with main | Proceed |
| 1-5 | any | Slightly behind | Proceed with note |
| >5 | 0 | Behind, no local work | Warn user, recommend merge |
| >5 | >0 | DIVERGED | Flag to user before proceeding |

### Context Continuation (Resuming Prior Work)

Resuming a feature branch with an active project → the 5-step procedure in
[references/context-continuation.md](references/context-continuation.md). The size is the original session's;
the walk resumes at the recorded node, never re-sized.

---

## Stage protocol

| Situation | Do |
|-----------|----|
| Entering any node | `node scripts/stage-advance.js --to <node>` before its work. Rails write `plan-review`, `code-review` and (at /l5–/l6) `implement` themselves; every other node is yours. A skill you hand off to may write the same node again — a repeat write is a harmless same-node update, so write it anyway |
| Entering `implement` when `nodes` prints a non-null `unit_kind` | Add `--unit <unit_kind>:<i>/<N>:<label>` (`phase:` or `deliverable:`). Same `<i>` = repair of that unit; `<i>+1` = next unit; leaving the loop needs `<i> = <N>` |
| Choosing the next node | `node scripts/stage-graph.js next --from <stage> --size <size> [--bug] [--urgent] [--research]`. `implement` in that list is the repair / next-unit edge; otherwise take the forward node |
| Leaving the last `verify` of an urgent session | Not `next` (the risk is sampled only on this move): `stage-advance.js --to code-review`. Exit 0 ⇒ high risk, normal order. Exit 3 with `qc-gate` in `legal_next` ⇒ urgent-low: go to `qc-gate`; finish-flow runs the code-review after `finish` |
| Exit 3 | Illegal move: read `legal_next`, go to one of those. Never retry the refused `--to`, never force |
| Exit 4 | E1 bump: `session-mode.js set --size <bump_to>`, then advance to the forward node of `stage-graph.js next --from <current stage> --size <bump_to>`. Never retry the original `--to` |
| Exit 2 / 5 | No marker / no size: run Session Start step 1, then retry the same call |

`/l3`–`/l6` decide who implements and who authors verification; they never change which nodes run.

---

## Nodes

### intent

`node scripts/stage-advance.js --to intent`, then record the goal in the project README; CEO mode skips the confirmation (the OKR was confirmed at CEO startup).

```markdown
## Project Goal

> **Final goal**: [one sentence]
> **Success criteria**: [quantifiable conditions]
> **Scope boundary**: [explicit include/exclude]
```

Each success criterion carries (a) a measurable threshold — number, percentage, boolean state, or named command
output — AND (b) how it will be verified. A criterion without both = incomplete, do not proceed. Pick acceptance
patterns (ids + evidence incl. negative controls) from [acceptance-patterns.md](../../references/acceptance-patterns.md).

**Task tracking (MANDATORY at intent)**: create both parent tasks. Missing either = failed intent gate; if one is
found missing later, STOP, create it retroactively (skill routing: pause the current unit, invoke the missing
skills, resume).

```
TaskCreate: "Skill routing — invoke required skills for all affected code areas"
  description: MANDATORY before any implement node. Input: the module/surface list
  produced by the Scope Completeness Audit. For each affected area, consult project
  CLAUDE.md and/or .claude/skill-routing.md for required skills. Invoke each required
  skill via the Skill tool (reading the file is NOT invoking). Mark this task completed
  ONLY after:
    (a) every required skill has been invoked via Skill tool, AND
    (b) one-line summary of "what this skill told me for this task" is captured in
        session context (either a note or a TaskCreate subtask).
  If a module has no skill routing entry, mark N/A with a one-line justification.
  Unit implementation tasks MUST be created with blockedBy=[this task] so
  they cannot start until skill routing is confirmed done.

TaskCreate: "finish: Invoke autopilot:finish-flow"
  description: MANDATORY completion. At the finish node invoke autopilot:finish-flow,
  which expands into its size-keyed sub-tasks. Do not mark this completed until the
  skill has run and every sub-task reaches completed.
```

Rationale for both: [references/historical-rationale.md](references/historical-rationale.md).

#### Scope Completeness Audit (MANDATORY before phase TaskCreate)

```
TaskCreate: "Scope completeness audit — enumerate all affected surfaces"
  description: Before unit TaskCreate. Walk the dimensions checklist below.
  For each "yes" row, either add a unit task for it OR document in README
  scope boundary why it's explicitly out-of-scope. Do NOT mark this task
  completed without dimension-by-dimension coverage recorded in README.
```

| Dimension | Trigger |
|-----------|---------|
| Source code + tests | Almost always |
| User-facing docs (README, guides, help text) | Any user-visible behavior change |
| API / interface reference | Any public interface change |
| Config file templates / examples | Any new or changed config format |
| CHANGELOG entry | Any release-worthy change to a versioned artifact |
| Version bump (semver) | Any externally-visible change to a versioned artifact |
| Version sync verification (grep) | Any version bump — `grep` the old version string across **all tracked files** (no extension pre-filter); N hits ⇒ the edit list touches all N. Never enumerate the file list from memory |
| Migration guide / notes | Any breaking change or schema change |
| Dependent repos / external consumers | Any interface change with downstream consumers |
| Credit / attribution | Any feature absorbing external OSS, prior art, or third-party design — README's `Inspired By` / credits section lists the source(s) |
| Dogfood target | Any tooling/infra change (does it apply to itself?) |

- **User-stated requirements ledger**: list EVERY requirement the user stated (verbatim quote each) → map each to a
  unit/task. finish-flow's goal review checks every row. An accepted requirement that maps to nothing = audit FAILS.
- Every "Source code + tests" module found here is cross-referenced against `.claude/skill-routing.md` (or the
  project equivalent) — it is the skill-routing task's input.
- CEO mode: the CEO runs the audit and records coverage in the README; it does not ask the user to enumerate.

**Ladder probe** (L/XL at the end of `intent`; L/XL bugs at the end of `diagnose`): `node scripts/probe-unknown.js
classify --ledger <ledger> --work-unit <task-id> --terms <dependency terms>`. Ledger: `<project>/ledger/decisions.jsonl`
(omitted ⇒ `~/.autopilot/ladder/<repo-hash>.jsonl`). Terms are the existing or external things the design depends on
and you cannot describe from the repo and general knowledge (libraries, APIs, modules, protocols, formats) — never
the names of what the task will create: a new command, flag, file or feature name is zero-hit and not an unknown.

| `classify` says | Next |
|-----------------|------|
| `recommend: U0`, or `none` with `eligible_max: U0` | Read the local hits it lists; propose from your own knowledge → `proposal` |
| `recommend: U1`–`U4` | An unknown exists → `research` (with `--research` on `stage-graph.js next`), climb that rung |
| `recommend: none` with `eligible_max` above `U0` (rung skipped) | `research` with local means (its `none` row) |

Sizes without a `research` node (XS–M bugs) work an unknown cause inside `diagnose` (`autopilot:debug` step 4).

### diagnose

`node scripts/stage-advance.js --to diagnose`, then invoke `autopilot:debug` unless the root cause is already known; either way, state the
root cause in one sentence before leaving the node. L/XL bugs also run the intent gates above (goal, audit, both
parent tasks, ladder probe) here.

### research (only when the probe found an unknown)

`node scripts/stage-advance.js --to research`, then act on `recommend` from the latest `classify`; re-run `classify` after each receipt until it says `U0` / `none`,
then advance to `proposal`. Budgets per work unit: U1 2 · U2 1 · U3 1 · U4 1 — a spent rung is never repeated.

| `recommend` | Rail, then receipt |
|-------------|--------------------|
| `U1` | `bash scripts/dispatch-consult.sh --question-file <q> --artifact <a> --ladder-receipt <ledger> --ladder-terms <terms> --ladder-unknown-type <unknown_type> --ladder-signals <ids> --ladder-work-unit <unit>` (writes its own receipt) |
| `U2` | `autopilot:survey` (`issue-search` mode for a `why` unknown), then `node scripts/probe-unknown.js receipt --ledger <ledger> --rung U2 --unknown-type <unknown_type> --terms <terms> --signals <ids> --work-unit <unit>` |
| `U3` | The `rail` classify names: `dispatch-discuss` (qualified discuss seat), else `autopilot:think-tank` (`whether`) / `autopilot:debugger` PUA (`why`); receipt `--rung U3 --rail <rail> --families <a,b>` (non-heterogeneous rail: add `--heterogeneous false`, no `--reason`) |
| `U4` | A spike in a throwaway worktree; receipt `--rung U4 --question <q> --criterion <c> --result pass\|fail\|inconclusive` |
| `none` (rung skipped, e.g. `not-heterogeneous`, or budget spent) | Research with local means (repo, docs, knowledge); record what stays assumed — the proposal lists it |

U5 (owner) is never recommended: it is reached only by your own stop (DOA boundary, stall fuse), carrying the
ladder receipts.

### proposal

`node scripts/stage-advance.js --to proposal`, then publish a web page (Artifact tool) with the assumptions (from research, or your own knowledge at U0) and 2–3
illustrated options, each with its trade-off and a recommendation; the user picks. Record the pick and the
assumptions in the plan. No Artifact tool ⇒ write the page as a local `.html` file and list the options in the
reply. No human available ⇒ take the recommended option and record it (Session Start), then continue to `plan`.

### plan

`node scripts/stage-advance.js --to plan`, then:

| Size | Plan |
|------|------|
| M | In-session: unit list (one task each), the verify command, acceptance |
| L, XL | User-provided plan ⇒ use it. Needs design ⇒ EnterPlanMode → design → ExitPlanMode → user approval. Save to `docs/plans/YYYY-MM-DD-<feature-name>.md` per [references/plan-template.md](../../references/plan-template.md). Project setup is mandatory even with a user-provided plan: project directory, branch, project index (bootstrap commands per project config) |

**Consult before design (L, XL; the ladder's U1 at this call site)**: `node scripts/probe-unknown.js classify
--ledger <ledger> --work-unit <phase> --terms <dependency terms, as at intent>`; call `bash scripts/dispatch-consult.sh --question-file
<design-question> --artifact <plan-draft> --ladder-receipt <ledger> --ladder-terms <terms> --ladder-unknown-type
<unknown_type> --ladder-signals <ids> --ladder-work-unit <phase>` **only on `recommend: U1`**. Any other
`recommend` follows the research table; a skipped U1 (`not-heterogeneous`, `consult_dispatch: off`) never invokes
`dispatch-consult.sh`. From here on the work unit is the phase id. Rail details:
[references/hetero-loops.md#consult-before-design](references/hetero-loops.md#consult-before-design).

L/XL unit tasks are created with `blockedBy=[Skill routing]` (Mission routing: one per admitted graph node).

### plan-review (the rail writes the stage)

Invoke `autopilot:hetero-review` with the plan file (plan loop). Gate: a frozen rubric plus `node
scripts/check-phase-review-receipt.js --plan-artifact <file> --dispositions <file>` exiting 0, or a valid opt-out
receipt when the `plan_review` knob resolves to off. Enforcer: `scripts/check-phase-review-receipt.js`
([references/hetero-loops.md#plan-review-gate--frozen-rubrics](references/hetero-loops.md#plan-review-gate--frozen-rubrics)).

### implement

`node scripts/stage-advance.js --to implement [--unit <unit_kind>:<i>/<N>:<label>]` (at /l5–/l6 the engine
writes it). Before the first implement, answer the verification contract (驗證合約, below). Before each unit
(M, L, XL):

1. Does this change move us closer to the **final goal**?
2. Is this unit essential — would skipping it prevent the final goal?
3. Does my understanding match the user's stated goal?

Any "no" or "unsure" = blocked; surface to the decision-maker. CEO mode answers them itself and escalates to the
Board only when the answer is "no" AND the response is a strategic pivot (goal change, scope expansion).

| Drift signal | Response |
|--------------|----------|
| "This unit has low ROI, skip it" | STOP — does it affect the final goal? |
| "We can do this later" | STOP — any hidden dependencies? |
| "Project is basically done" | STOP — has the final goal been achieved? |
| "User probably just wants..." | STOP — ask and confirm directly |

Continuous execution: proceed between units without asking "continue?". Stop only for: staging gate, build/test
failure, a design decision, context near limit.

### verify

`node scripts/stage-advance.js --to verify` (exit 4 = E1 bump). Each unit is verified by a qualified verifier: a seat `node scripts/engine-scorecard.js current --role verifier`
reports qualified (at /l6 the verification-author dispatch; in a campaign the engine's per-deliverable review). It
reads artifacts only (`references/blind-dispatch.md` § Verifier isolation). No qualified seat ⇒ the
`on_engine_unavailable` policy from `scripts/resolve-review-loop.sh`, never a silent skip.

**驗證合約(必答)** —「這個任務做完,跑什麼命令能客觀證明?」

| 答案 | 機械判定 | 路由 |
|------|---------|------|
| 命令,且通過**紅綠驗證** | 見下方紅綠語意 | 紅綠通過 ⇒ **驗證錨定恆成立**(ratchet + 一輪 advisory review)。review 降為**非 gating** 需三條件**同時**:紅綠通過 **且** implementer scorecard-qualified(`engine-scorecard.js` status=qualified,由 `engine-qualify.sh` 的 known-bad 零漏放 bar 產生)**且** risk=low |
| 命令,但未過紅綠(vacuous)或紅無法成立 | 自動降級 | 同「無驗證」列 |
| 「沒有客觀驗證」(合法誠實答案) | 記入 run summary | **審查 gating 常駐**,不分模型強弱(模型強只降輪數 ≤2,不降為零);優先派工具可執行的原生 reviewer,而非 diff-text 軌 |

紅綠語意:
- base = dispatcher 釘死的 immutable base SHA(engine `--base`;dev-flow inline = marker `base_ref`);dirty tree 不是 base。
- base-run = base 的產品碼 + diff 中的驗證 artifact 套上去跑,避免純新增 TDD artifact 被誤降級。
- 紅的資格 = assertion/行為失敗;基礎設施錯誤(檔案不存在、import error、collect 0)不算紅。
- 紅必須可重現(flaky base-fail 重跑一次確認;不可重現 → 降級)。

Engine wiring: the answer flows to `engine implement-review --verify-cmd`; non-gating only per the conjunction,
else keep `--no-verify-first`. Campaign identity requires `engine implement-review --campaign-contract
<campaign.json>`, which owns the durable ledger/resume. verify-cmd is dispatcher-authored, isolated-worktree,
read-only expectation.

**Unit advance gate** (M, L, XL) — TaskCreate these five as discrete sub-tasks of the unit task, named verbatim:

- [ ] Goal check: all three verification questions answered "yes"
- [ ] Tests pass: zero failures
- [ ] Completeness scan: `bash scripts/completeness-scan.sh` — no placeholder markers or stub implementations
- [ ] Verifier verdict: the qualified verifier passed this unit (artifacts, not the implementer's report)
- [ ] Project docs: progress row updated to reflect unit completion

Then commit the unit. CEO mode verifies the gate itself; no user confirmation for passing gates.

**Backlog safety** (before deferring anything): affects the final goal ⇒ do NOT defer; goal unreachable without
it ⇒ do NOT defer; unsure ⇒ ask the user. A passing deferral = one backlog row per
[`references/backlog-entry.md`](../../references/backlog-entry.md), evidence at the pointer, unit marked "Deferred".

**Scope expansion** (L, XL — after every unit): new subsystem not in the README, larger public API, estimate
doubled, or requirements beyond the OKR ⇒ STOP. Board decision (user; CEO escalates): update the README scope
boundary first, proceed only after explicit approval, record it in the project decision log.

**Leaving the last unit of an urgent session**: `--to code-review`, never `next` (Stage protocol row).

### code-review (the rail writes the stage)

After all units, invoke `autopilot:hetero-review` (code loop) on the full diff, `--phase full --phase-base
<base_ref>`. Strength = the distinct model families `bash scripts/resolve-review-loop.sh --field
required_review_families` resolves from risk and roster — low risk defaults to one family with a fresh-context
reviewer; a shortfall goes through `on_engine_unavailable`, never silently lowered. Gate: `node
scripts/check-phase-review-receipt.js --ledger <ledger> --phase full --branch <b> --phase-base "$(cat
<ledger>/phase-full.base)"` exits 0 (SHIP-AS-IS chain or explicit opt-out). `FIX-THEN-SHIP` ⇒ back to `implement`
(not on the urgent-low path, where each finding opens a new `S` task instead).

### qc-gate

`node scripts/stage-advance.js --to qc-gate` (exit 4 = E1 bump), then:

| Size | Gate |
|------|------|
| XS, S | Project-config gate (default: lint + test); risk flags (money, auth/security, production protocol) ⇒ `autopilot:quality-pipeline` instead. Before committing, check no feature was added beyond the original goal — if one was, stop and ask |
| M, L, XL | `autopilot:quality-pipeline` (per-size flags from project config), at most 3 fix-review rounds; requires a valid code-review receipt (urgent-low excepted) and, for L/XL, the plan-review receipt |

A failure loops back to `implement`. XS/S commit after the gate (bug: message states root cause + what was wrong +
how it is fixed).

### finish

`node scripts/stage-advance.js --to finish`, then invoke `autopilot:finish-flow`; it owns the size-keyed closing checklist (merge, archive,
session end, the urgent-low code-review). Never inline it, never mark the parent task done while its sub-tasks are
pending. CEO mode: every finish sub-task is within DOA — execute all, then report.

---

## Session Rules (persist throughout)

These apply to all subsequent work in this session, whichever skills are invoked.

| Activity | Read first (if it exists) | Contains |
|----------|---------------------------|----------|
| Debugging | `.claude/debug-config.md` | Debug tools, Docker commands, known gotchas |
| Writing or running tests | `.claude/test-strategy-config.md` | Framework, commands, coverage thresholds |
| Parallel task dispatch | `.claude/team-config.md` | Role templates, tech stack, team size |
| Performance profiling | `.claude/profiling-config.md` | Profiling tools, baseline commands |
| Comparison audit | `.claude/audit-config.md` | By-design divergences, audit scope |
| Methodology / reviewer / parallel routing | `.claude/dispatch-config.md` | Preference chains (also injected above) |

### Background Wait Rule

A turn must NEVER end waiting only on a background-task notification: Claude Code delivers subagent completion
notifications best-effort and drops them in practice (2026-09-02: 29 of 63 never arrived).

| Expected wait | Do this |
|---------------|---------|
| ≤ 15 min | Foreground `Bash` with an explicit `timeout`, or the `Monitor` tool. Not `run_in_background`. |
| > 15 min | `run_in_background` ONLY with both: the leaf's output path written down in the same turn, AND a second background dead-man timer (`sleep <deadline>; echo WAKE`). |

An orchestrator handing off a long unit starts its dead-man timer before ending the turn. Foremen under
`/l4`–`/l6` keep their stricter no-polling clause: the dead-man timer is itself a background task — never
foreground `sleep`, never `Monitor`.

### Urgent

- Smallest possible diff, fastest path to stable; the size stays what Sizing says. A DB migration ⇒ STOP:
  `session-mode.js set --size L`.
- Production broken ⇒ the `hotfix/` branch from `main`; finish-flow merges back to `main` and makes the
  post-incident `autopilot:learn` mandatory. Rollback: invoke finish-flow once the rollback is verified stable.

### Staging Gate

Trigger: a unit awaits user review, or the session ends with undeployed committed changes. Deploy per project
config (default: build + restart).

### Session End Rule

Work finished ⇒ the `finish` node. Session ends mid-work ⇒ `autopilot:handoff`; record knowledge if something was
surprising or took more than one retry (`autopilot:learn`). Long or degraded session ⇒
[Context Health Check](references/hetero-loops.md#context-health-check-reference). After code changes, the
doc-sync mapping in [references/post-feature-doc-sync.md](references/post-feature-doc-sync.md) applies (skip for bug
fixes, value tweaks, log messages).

---

## Skill Routing (project-specific)
!`cat .claude/skill-routing.md 2>/dev/null || true`

## Completeness Principle

Complete (all edge cases, full test coverage, proper error handling) beats shortcut (happy path only) — always
choose complete, for tests, error handling, edge cases, docs and features alike.

## Anti-patterns

| Wrong | Correct |
|-------|---------|
| `--size M!` or `!M` | `--size M --urgent`; `!` is written after the letter in prose only |
| Copying a node sequence into a plan or prompt | Cite `stage-graph.js nodes`; the JSON is the only definition |
| Retrying the refused `--to` after exit 3 or 4 | Exit 3: a `legal_next` node. Exit 4: bump, then `next` from the current stage |
| Sizing a bug L because it crosses 3 modules, or S while its cause is unlocated across several | Size the fix's footprint: a cause across several modules is at least M; L only for design / multi-phase work |
| `--terms` naming what the task will create | Terms are existing or external dependencies; new names are zero-hit by construction |
| Raising the size for a risky change | Risk raises review strength, not size |
| Ask "continue?" after a unit | Proceed directly to the next unit |
| Re-sizing on context continuation | Use the marker's size; only the E1 bump moves it |
| Skipping the skill-routing or finish parent TaskCreate "because I remember" | The task IS the forcing function — memory is what keeps failing |
| Reading a skill file instead of invoking it | Read ≠ invoke: the Skill tool loads it and records the decision |
| Unit tasks without `blockedBy=[Skill routing]` | The dependency is the mechanical enforcement |
| Enumerating units before the Scope Completeness Audit | The audit decides which units exist |
| Inlining finish-flow steps or batching its sub-tasks | Invoke finish-flow; each sub-task is its own TaskCreate |
| Scope expansion without Board approval | Doubled estimate or new subsystem = Board decision, never CEO-tactical |
| Defer work that affects the final goal | Never defer goal-critical items |
| Force knowledge extraction when nothing happened | Skip — do not force it |
| Auto-execute context reduction without confirmation | List the operations with numbered choices |

## User Override Protocol

User may request skipping process steps. When overridden:
1. State which check is skipped and the associated risk
2. Log `[OVERRIDE: skipped {step}]` in commit message
3. Comply -- user has final authority

**Cannot be overridden** (explain why and suggest alternatives):
- Migration integrity check (data corruption risk)
- SQL injection / security validation
- Completeness scan on new handlers/routes (invisible data loss)
- Code review Critical-severity findings (security/correctness)

## Capability-adaptive compatibility

This skill remains the canonical guided compatibility path. When a verified profile session is
active, the host retains the full task graph, checklist, completed history, and future slices, then
sends the worker only the current six-field active slice plus its matching envelope and role grant.
A late profile/grant change requires a fresh-session handoff and never edits the project default.
The `profile-session.js` lane is a no-effect isolation probe, not an effectful handoff gate;
rehashable artifacts, same-process observations, and caller-authored traces cannot qualify one.

## Mission Routing Override

When project governance configures `mission_convergence`, this section overrides every unit-enumeration rule above.

Before any TaskCreate, branch, worktree, runner, or model effect:

```bash
node <autopilot-source>/scripts/mission-routing-admission.js \
  --repo-root "$(git rev-parse --show-toplevel)" --level <l3|l4|l5|l6>
```

- `READY` is the only enforce-mode admission. Create one implementation TaskCreate per admitted
  graph node, plus the parent forcing-function tasks.
- `SHADOW` is observation only. Record `admitted`/`would_block` honestly and continue through the
  unit workflow without claiming an enforced receipt or grant.
- `LEGACY` means project Mission policy is off.
- Source `Phase`/`P0..PN` headings, modules, reviewer seats, tests, retries, repairs, and fallbacks
  remain coverage or gates inside a caller-authored bounded deliverable. They never become tasks
  one-for-one.
- In `READY`, every unit above means an admitted graph node, and instructions to extract units from
  source headings are disabled. Admitted implementation tasks remain blocked by the skill-routing task.
- Topology fallback reuses the same admission and owning gate-attempt budget; it does not create a
  second graph or reset authority.
- The project README keeps historical completed phases in a non-executable ledger and reports only
  current admitted deliverables as executable work.
- **Resume projection**: on resume, Mission nodes are remaining deliverables only — see
  [references/context-continuation.md](references/context-continuation.md#resume-projection-mission).

## Available Scripts

| Script | Purpose |
|---|---|
| `scripts/session-mode.js` | `set --size <XS\|S\|M\|L\|XL> [--urgent] [--bug]` creates or merges the session marker (size moves only up); `status` prints it. Session Start step 1. |
| `scripts/stage-graph.js` | Queries the canonical graph: `nodes`, `next --from`, `limits`, `validate`. Read the sequence and the next node here, never from prose. |
| `scripts/stage-advance.js` | Records entry into a node; refuses illegal moves (exit 3, `legal_next`) and requests the E1 size bump (exit 4, `bump_to`). Called on entering every prose-written node. |
| `scripts/check-stage-vocab.js` | Finds old stage ids, old size names and removed marker fields in shipped text; `--repo <consumer>` lists stale lines in a consumer's `.claude/*.md` and backlog with their replacement. |
| `scripts/mission-routing-admission.js` | Resolve project Mission policy and admit the authoritative bounded graph/source coverage before L/XL TaskCreate or execution topology effects. |
| `scripts/mission-execution-graph-check.js` | Validate graph limits, exact source/rubric coverage, critical path, batches, gate attempts, aggregate reservations, and ICC campaign projection bounds. In a repo with a codex mirror, pass `--mirror-roots <(scripts/sync-codex-plugin-skills.sh --mirror-roots-json)` so an `output_paths` entry under a mirrored dir must name its mirror too. |
| `scripts/plan-rubric-scaffold.js` | Generate structured rubric markdown skeletons from an input plan document for frozen review rubrics. |
| `scripts/hetero-review-loop.js` | Drive multi-seat review collection, disposition aggregation, verdict synthesis, and opt-out receipts for review loops. |
| `scripts/check-phase-review-receipt.js` | Validate review receipts against git history and review artifacts or validate plan artifact blocker dispositions. |
| `scripts/probe-unknown.js` | Unknown-escalation ladder probe: `classify` turns refuted hypotheses / loop non-convergence / stall / zero-hit terms / low consensus into one rung recommendation on the U0–U5 ladder (classify never emits U5 — the owner rung is reached only by the caller's own stop); `receipt` appends the ladder row after a rail returns. Call sites: `intent` / `diagnose` and the `plan` consult (this skill), debug step 4, think-tank Step 5, foreman round end. |
