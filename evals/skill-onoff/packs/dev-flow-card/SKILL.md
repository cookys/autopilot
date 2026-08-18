---
name: dev-flow
description: >
  Start here before writing any code — sizes task (S/L/H/Fix), sets up branch and session rules.
  Use when: "I'm starting on X", "quick fix for Y", "continuing from yesterday", "hotfix needed",
  "let's implement X", "skip to coding", "我要開始做 X", "快速修一下", "接續昨天的進度",
  resuming a feature branch, or any task that touches code. Not for: debugging
  (→ debug), authoring a plan doc (→ references/plan-template.md), pre-code design
  exploration (→ brainstorm), or code review (→ quality-pipeline).
---

# Development Flow Evaluation

## Project Config (auto-injected)
!`cat .claude/dev-flow-config.md 2>/dev/null || true`

## Model Routing (for subagent dispatch)
!`cat .claude/model-routing-config.md 2>/dev/null || true`

If no project config above, use defaults from [references/model-routing.md](references/model-routing.md).

## Dispatch Chains (for orchestrator routing)
!`cat .claude/dispatch-config.md 2>/dev/null || true`

If no project config above, autopilot's own fallback skills are primary for methodology; `native` Task dispatch for parallel; `autopilot:reviewer` for code review. See [project-config-template/dispatch-config.md](../../project-config-template/dispatch-config.md) for the schema.

---

## Phase 1: Session Start

Run before any code changes. Size determines which path executes.

### S-Size Fast Path

Overhead target under 5 seconds: (1) restate the task in one sentence; (2) branch check
`git branch --show-current`; (3) proceed to S Workflow — no further gates. S-size skips:
branch freshness, knowledge/digest review, draft plan overlap, risk escalation.

### L-Size Full Gates

All gates must pass before any code changes begin; a blocked gate surfaces to the decision-maker (user in normal mode, CEO in CEO mode).

```
1. Session start SHA:  git rev-parse HEAD > .claude/session-start-sha
2. Branch check:       git branch --show-current
3. Branch freshness:   BEHIND=$(git log HEAD..main --oneline 2>/dev/null | wc -l)
                       AHEAD=$(git log main..HEAD --oneline 2>/dev/null | wc -l)
                       → freshness table below; no main (new repo) = skip.
4. Knowledge review:   check .claude/knowledge/ + unprocessed session digests.
5. Draft plan overlap: ls docs/plans/*.md (or project-configured path); overlap with
                       the current task (same feature/module/story) → normal mode:
                       confirm with user (proceed vs adopt draft); CEO mode: DOA.
6. Skill routing:      per CLAUDE.md / project config, invoke the code-area skills
                       before writing code. Active enforcement = the L-1.6 TaskCreate
                       (see L Workflow) — reading this bullet is NOT enough.
```

### Branch Freshness Table

| Behind | Ahead | Status | Action |
|--------|-------|--------|--------|
| 0 | any | Up to date with main | Proceed |
| 1-5 | any | Slightly behind | Proceed with note |
| >5 | 0 | Behind, no local work | Warn user, recommend merge |
| >5 | >0 | DIVERGED | Flag to user before proceeding |

### Fix Path

Same lightweight start as S, plus branch creation: (1) restate the bug and known fix in one
sentence; (2) `git checkout -b fix/<description>`; (3) skill-routing check for the target code
area; (4) proceed to Fix Workflow. Fix skips: knowledge/digest review, plan overlap, branch
freshness (short-lived branch).

### Context Continuation (Resuming Prior Work)

Resuming work on an existing feature branch with an active project → follow the 5-step procedure in [references/context-continuation.md](references/context-continuation.md) (uncommitted-changes check, SHA refresh, branch freshness, resume point, skill routing). Context continuation never re-evaluates size — it uses the size from the original session.

---

## Session Rules (persist throughout)

### Config Injection Rules

Before each activity below, read its config file if it exists (project-specific tools, commands, known issues); absent config = proceed normally.

| Activity | Config File |
|----------|------------|
| Debugging (bugs, crashes, logic errors) | `.claude/debug-config.md` |
| Writing or running tests | `.claude/test-strategy-config.md` |
| Parallel task dispatch (team work) | `.claude/team-config.md` |
| Performance profiling | `.claude/profiling-config.md` |
| Comparison audit (old vs new) | `.claude/audit-config.md` |
| Methodology / reviewer / parallel dispatch routing | `.claude/dispatch-config.md` (also auto-injected at top of this skill) |

### Quality Gate Rule

**Before committing or merging, invoke `autopilot:quality-pipeline`** (test → scan →
completeness → review). Non-negotiable.

### Session End Rule

User signals session end (or S-size task completion) → update project tracking if L-size
(`docs/projects/*/README.md` + `INDEX.md`); record knowledge if something was surprising or took
>1 retry (`autopilot:learn`).

---

## Quick Decision

First ask: **what kind of work is this?** — then, if neither Fix nor H, size the feature:

| Kind | Criteria | Workflow |
|--------|----------|----------|
| **Fix** | Bug fix — root cause known, solution clear. No design needed. | Fix (any module count) |
| **H** | Production broken — immediate fix needed. | Hotfix |
| **S** | Single commit (single module, no interface change, self-contained) | Direct commit |
| **L** | Multiple commits (3+ modules / public API / incompatible data / Feature Flag / user requests planning) | Plan + Project |

**Fix vs L**: "Do I need to *design* the solution, or just *implement* a known fix?" Design → L. Known fix → Fix.

**Risk Escalation** (force L for features): money/points, auth/security, production protocol changes.
Risk-escalated bug fixes stay Fix but add PR review before merge.

### 驗證合約(必答)

Mandatory question: **「這個任務做完,跑什麼命令能客觀證明?」**

| 答案 | 機械判定 | 路由 |
|------|---------|------|
| 命令,且通過**紅綠驗證** | 見下方紅綠語意 | 紅綠通過 ⇒ **驗證錨定恆成立**(ratchet + 一輪 advisory review)。review 降為**非 gating** 需三條件**同時**:紅綠通過 **且** implementer scorecard-qualified(機械定義:`engine-scorecard.js` status=qualified,由 `engine-qualify.sh` 的 known-bad 零漏放 bar 產生 — 非主觀判斷)**且** risk=low(opus R2:連言架構 — 單靠騙過紅綠拿不掉否決權) |
| 命令,但未過紅綠(vacuous)或紅無法成立 | 自動降級 | 同「無驗證」列 |
| 「沒有客觀驗證」(合法誠實答案) | 記入 run summary | **審查 gating 常駐**,不分模型強弱(零機械觀測不可證偽;reviewer 是唯一觀測通道,保留否決權;模型強只降輪數 ≤2,不降為零)。此 gating review **優先派工具可執行的原生 reviewer**(能實跑探索性檢查),而非 diff-text 軌(MiniMax R2) |

紅綠語意:
- base 定義: dispatcher 釘死的 immutable base SHA(engine `--base`;dev-flow inline = intake 時的 HEAD);dirty tree 不是 base。
- base-run = base 的產品碼 + diff 中的驗證 artifact 套上去跑,避免純新增 TDD artifact 被誤降級。
- 紅的資格 = assertion/行為失敗;基礎設施錯誤(檔案不存在、import error、collect 0)不算紅。
- 紅必須可重現(flaky base-fail 重跑一次確認;不可重現 → 降級)。

Engine wiring: answer flows to `engine implement-review --verify-cmd`;non-gating only per conjunction(紅綠 ∧ scorecard-qualified ∧ risk=low),else keep `--no-verify-first`.
Campaign identity requires `--campaign-contract <campaign.json>` and automatically owns durable
ledger/resume.
Side-effect warning: verify-cmd is dispatcher-authored, isolated-worktree, read-only expectation.
The campaign contract is the mandatory durable-ledger authority boundary.

### Scope Creep Detection

Size is evaluated once at start, but scope grows silently. **S → L escalation** is enforced by
the `S-scope-gate` TaskCreate (see S Workflow). **L scope expansion**: after every phase
completion ask "does the REMAINING scope still match the README's scope boundary?"

```
Indicators of L-scope expansion:
  - New subsystem not listed in original README phases
  - Public API surface larger than original estimate
  - Estimate doubled (2x+ original effort)
  - User added requirements beyond original OKR

If expanded:
  → STOP. This is a Board Decision (user in normal mode, CEO escalates in CEO mode).
  → Update README scope boundary FIRST.
  → Only proceed after explicit approval.
  → Record in project decision log.
```

---

## S Workflow -- Direct Commit

**Scope gate (MANDATORY before any implementation)**: Create this task at S-start:

```
TaskCreate: "S-scope-gate: Evaluate scope before every commit"
  description: MANDATORY before every commit. Check all three indicators:
    (1) Fewer than 3 commits on this task so far?
    (2) Fewer than 3 different modules touched?
    (3) No features added beyond original goal?
  If ANY indicator is NO → STOP. Escalate to L:
    - Create project dir + README + INDEX (retroactive)
    - Record prior commits as completed phases
    - Create L-1.6 and L-5 TaskCreates, then continue with L Workflow tracking
  Mark this task ONLY when: work is complete AND scope stayed S throughout (all YES),
  OR L-escalation is complete and project tracking is in place.
```

This task stays pending and surfaces before every tool use — the forcing function that
prevents "it was obviously S" from silently becoming a multi-module project without tracking.
S creates exactly this ONE TaskCreate (no TodoWrite) — intentionally minimal.

0. 驗證合約必答 — 見上
1. Implement
2. Quality gate (per project config, or: lint + test)
3. Evaluate S-scope-gate indicators before committing
4. Commit to current branch (descriptive message)
5. Cleanup: if from backlog, delete the item; session end runs S-Lite (see Session End)

---

## Fix Workflow -- Bug Fix (any module count)

> Clear root cause; no plan/project needed; feature branch for traceability.

0. 驗證合約必答 — 見上
1. `git checkout -b fix/<description>`
2. Investigate root cause (read code, trace data flow)
3. Implement fix
4. Quality gate (per project config, or: lint + test)
5. Commit with **detailed message**: root cause + what was wrong + how it's fixed
6. **Write ongoing-maintenance entry** — append one line to `docs/projects/ongoing-maintenance/YYYY-MM.md` (or the project-configured projects path — e.g. `docs/` plural; check the injected config so you don't create a stray sibling tree):
   `| MM-DD | commit_hash | fix(area): 根因 → 修法 (跨 N 模組) |`
7. Merge to develop; delete fix branch; non-obvious lesson → invoke `learn`

**Fix does NOT create**: plan, project dir, or PR (unless risk-escalated).

---

## L Workflow -- Plan + Project

> **Continuous execution**: proceed between Phases without asking "continue?". Stop only for:
> Staging Gate | Build/test failure | Design decision needed | Context near limit.

**Task tracking (MANDATORY at L-1)**: Create Phase Todos at start (extract p0...pN + completion
from plan) **AND** these TWO non-optional parent forcing functions — missing either = failed L-1
gate:

```
TaskCreate: "L-1.6: Skill routing — invoke required skills for all affected code areas"
  description: MANDATORY before any implementation phase. Input: the module/surface list
  produced by L-1.5 Scope Completeness Audit. For each affected area, consult project
  CLAUDE.md and/or .claude/skill-routing.md for required skills. Invoke each required
  skill via the Skill tool (reading the file is NOT invoking). Mark this task completed
  ONLY after:
    (a) every required skill has been invoked via Skill tool, AND
    (b) one-line summary of "what this skill told me for this task" is captured in
        session context (either a note or a TaskCreate subtask).
  If a module has no skill routing entry, mark N/A with a one-line justification.
  Phase implementation tasks (P0..PN) MUST be created with blockedBy=[this task] so
  they cannot start until skill routing is confirmed done.

TaskCreate: "L-5: Invoke autopilot:finish-flow"
  description: MANDATORY L-size completion. Invoke autopilot:finish-flow which will
  expand into 7 discrete sub-tasks (Final Goal Review, Pre-Merge Review, Merge,
  Post-Merge Review, Archive, L Session End, Delete merged branch). Do not mark this
  completed until the skill has run and all 7 sub-tasks reach completed.
```

Both parent tasks stay pending through every phase (system-reminder surfaces them each tool
use); completing them requires explicit work. Phase tasks P0..PN MUST carry `blockedBy=[L-1.6]`
— the dependency is the mechanical enforcement. A missing parent task after L-1 = STOP, create
retroactively (L-1.6: pause the phase, invoke the missing skills), continue. Rationale:
references/historical-rationale.md § Why L-1.6 exists.

### L-1. Intent Confirmation

Confirm before starting. Record in the project README:

```markdown
## Project Goal

> **Final goal**: [one sentence]
> **Success criteria**: [quantifiable conditions]
> **Scope boundary**: [explicit include/exclude]
```

**Quantifiable** = each criterion has (a) a measurable threshold (number, percentage, boolean
state, or named command output) AND (b) how it will be verified; a criterion missing either =
incomplete plan, do not proceed (examples: references/historical-rationale.md § Quantifiable
criteria). Select acceptance criteria from
[acceptance-patterns.md](../../references/acceptance-patterns.md) (pattern ids + evidence incl.
negative controls). **CEO mode**: SKIP — OKR already confirmed at Startup; do not re-ask.

#### Scope Completeness Audit (MANDATORY before phase TaskCreate)

A correctly-executed phase plan cannot recover from an incomplete scope — before creating phase
tasks, audit every surface this change touches. **Create a discrete TaskCreate as the first item**:

```
TaskCreate: "L-1.5: Scope completeness audit — enumerate all affected surfaces"
  description: Before phase TaskCreate. Walk the dimensions checklist below.
  For each "yes" row, either add a phase task for it OR document in README
  scope boundary why it's explicitly out-of-scope. Do NOT mark this task
  completed without dimension-by-dimension coverage recorded in README.
```

**Dimensions checklist** (non-exhaustive starter — add project-specific rows as needed):

| Dimension | Trigger |
|-----------|---------|
| Source code + tests | Almost always |
| User-facing docs (README, guides, help text) | Any user-visible behavior change |
| API / interface reference | Any public interface change |
| Config file templates / examples | Any new or changed config format |
| CHANGELOG entry | Any release-worthy change to a versioned artifact |
| Version bump (semver) | Any externally-visible change to a versioned artifact |
| Version sync verification (grep) | Any version bump — `grep` the old version string across **all tracked files** (don't pre-filter by extension; tomorrow's repo may add `.toml` / `Dockerfile` / `.yaml`). If the grep returns N hits, the edit list must touch all N. Never enumerate the file list from memory |
| Migration guide / notes | Any breaking change or schema change |
| Dependent repos / external consumers | Any interface change with downstream consumers |
| Credit / attribution | Any feature absorbing external OSS, prior art, or third-party design — README's `Inspired By` / credits / acknowledgements section must list the source(s) |
| Dogfood target | Any tooling/infra change (does it apply to itself?) |

For each "yes" row: add a phase task covering it, OR document in `README.md` scope boundary why
it is explicitly out-of-scope.

- **User-stated requirements ledger**: list EVERY requirement the user explicitly stated for this task (features, tests, docs, formats — verbatim-quote each) → map each to a phase/task. This ledger is carried to finish-flow L-5.1. An accepted requirement that maps to nothing = the audit FAILS.

**Feeds into L-1.6**: the module/surface list produced here is the L-1.6 TaskCreate's direct
input; cross-reference each module against `.claude/skill-routing.md` (or equivalent) before
marking L-1.5 completed. Gate rationale: references/historical-rationale.md. **CEO mode**: audit
autonomously, record coverage in the README scope boundary — never ask the user to enumerate.

### L-2. Plan
User provides plan → use it directly, skip Plan Mode. Needs design → EnterPlanMode → design →
ExitPlanMode → user approval. Save to `docs/plans/YYYY-MM-DD-<feature-name>.md`.

### L-3. Project Setup (mandatory)
Create project directory structure + branch, update project index; per project config for
specific bootstrap commands.

### L-4. Per Phase

**Goal verification** -- all three must be "yes" before starting each phase; any "no"/"unsure" =
blocked, surface to decision-maker (CEO mode: evaluate autonomously; escalate to Board only when
the answer is "no" AND the response is a strategic pivot): (1) does this change move us closer to
the **final goal**? (2) is this phase essential — would skipping it prevent the goal? (3) does my
understanding match the user's stated goal?

**Drift signals**:

| Signal | Response |
|--------|----------|
| "This phase has low ROI, skip it" | STOP -- Does it affect the final goal? |
| "We can do this later" | STOP -- Any hidden dependencies? |
| "Project is basically done" | STOP -- Has the final goal been achieved? |
| "User probably just wants..." | STOP -- Ask and confirm directly. |

**Execution**: Implement -> quality gate -> commit -> mark phase done.

**Backlog safety**: an item that affects the final goal (or that the goal needs) is never
deferred; unsure → ask the user. Passing deferrals go to BACKLOG with context + trigger, phase
marked "Deferred" in project docs.

**Phase advance gate** -- all true before the next phase (CEO mode verifies autonomously):

- [ ] Goal check: all three verification questions answered "yes"
- [ ] Tests pass: zero failures
- [ ] Completeness scan: no placeholder markers or stub implementations
- [ ] Code review: no blocking issues remain
- [ ] Project docs: progress row updated to reflect phase completion

### L-5. Completion (MANDATORY — via finish-flow forcing function)

**Invoke `autopilot:finish-flow`.** It owns the L-size closing sequence: 7 discrete TaskCreated
sub-tasks (Final Goal Review → Pre-Merge Review → Merge → Post-Merge Review → Archive → L
Session End → Delete merged branch), each with an explicit verification output, each individually
completed — never batched or compressed. (Why delegated: references/historical-rationale.md §
Why L-5 is delegated.) **CEO mode**: all 7 are within DOA — execute all, then report.

### Staging Gate

**Trigger**: Phase/feature awaiting user review | session ending with undeployed committed
changes. Deploy per project config (default: build + restart).

---

## H Workflow -- Hotfix

> **Production is broken. Smallest possible fix, fastest path to stable.**

**Task tracking (MANDATORY at H-1)**: Create a parent closing task at the start:

```
TaskCreate: "H-9: Invoke autopilot:finish-flow"
  description: MANDATORY hotfix completion. Invoke autopilot:finish-flow which will
  expand into 6 discrete sub-tasks (verify fix, quality gate, merge to main, post-incident
  learn, delete hotfix branch, session end).
```

1. `git checkout -b hotfix/<description> main`
2. **Scope check**: if fix requires DB migration -> STOP, re-route to L. Cross-module bug fixes stay as H (or Fix if not production-critical).
3. Fix the issue (smallest possible change)
4. Invoke `autopilot:finish-flow` — it expands the closing sequence into 6 discrete sub-tasks
   (verify fix → quality gate → merge to main `--no-ff` → post-incident `learn` (MANDATORY) →
   delete hotfix branch → session end), each individually completed. H prioritizes speed — the
   forcing function only prevents skipping existing steps. For rollbacks, invoke `finish-flow`
   after the rollback is verified stable.

---

## Session End

L-size and H-size Session End is a **sub-task inside `autopilot:finish-flow`** (L-5.6 / H-9.6),
never a standalone section you run yourself. S and Fix: `finish-flow` optional — run S-Lite:

### S-Lite (S and Fix workflows, inline)

1. **Retry check**: retried a non-trivial operation 2+ times? Invoke `learn`.
2. **Deferred items**: anything postponed -> BACKLOG with context + trigger.
3. **Confirm commit**: change landed on the correct branch.
4. **Fix only**: verify ongoing-maintenance entry was written.

### L-Full Reference (invoked by finish-flow L-5.6)

The L-5.6 sub-task runs the full 8-step checklist in
[references/session-end.md](references/session-end.md) (verify completion → project docs →
knowledge extraction → deferred items → triggered BACKLOG pickup via session-start-sha → learn
summary → staging verify → checklist summary); the conditional Context Health Check lives there too.

### Post-Feature Doc Sync

After code changes, verify documentation matches the new state — changed→update mapping table in
[references/post-feature-doc-sync.md](references/post-feature-doc-sync.md). Skip for: bug fixes,
minor value tweaks, log message changes.

---

## Skill Routing (project-specific)
!`cat .claude/skill-routing.md 2>/dev/null || true`

## Completeness Principle

Complete beats shortcut (edge cases, error handling, test coverage, documentation) — AI makes
the marginal cost of completeness near-zero; always choose the complete option.

## Anti-patterns

| Wrong | Correct |
|-------|---------|
| Bug fix escalated to L because it crosses 3 modules | Use Fix -- module count doesn't determine bug fix workflow |
| Ask "continue?" after Phase | Proceed directly to next Phase |
| User provides plan -> skip project setup | Project dir must be created regardless |
| End session after merge | Must continue: post-merge -> archive -> session end |
| Force knowledge extraction when nothing happened | Skip -- do not force it |
| Defer work that affects the final goal | Never defer goal-critical items |
| Re-evaluate size on context continuation | Use size from the original session |
| Auto-execute context reduction without confirmation | List confirm operations with numbered choices |
| Skip / postpone / inline a forcing-function TaskCreate (S-scope-gate, L-1.5, L-1.6, L-5, H-9) "because I remember the steps" | The task IS the forcing function — memory is exactly what keeps failing. Create it at start; reading ≠ invoking (L-1.6); phases carry `blockedBy=[L-1.6]`; finish-flow is invoked, never inlined, and its parent completes only after ALL sub-tasks |
| Enumerate L-size phases before running the L-1.5 Scope Completeness Audit | Scope audit determines WHICH phases should exist — it runs first, even when the task "is obvious" |
| L-size scope expands mid-project without Board notification | Expansion beyond the README scope boundary is a Board Decision (Resources 2x+ per DOA) — never CEO-tactical; approve before continuing |

## Pre-implementation Checklist

- [ ] Check for existing in-progress projects
- [ ] S-size: S-scope-gate TaskCreate created (MANDATORY before any implementation)
- [ ] Fix: `fix/` branch created, root cause confirmed, skill routing checked (passive — Fix
      stays lightweight, no TaskCreate)
- [ ] L-size: project structure created (plan + project dir + branch)
- [ ] L-size: L-1.5 / L-1.6 / L-5 TaskCreates created (parent forcing functions, non-optional)
- [ ] L-size: Phase tasks (P0..PN) created with `blockedBy=[L-1.6]`

---

## User Override Protocol

User may request skipping process steps: state which check is skipped + the risk, log
`[OVERRIDE: skipped {step}]` in the commit message, then comply — user has final authority.
**Cannot be overridden** (explain why, suggest alternatives): migration integrity check (data
corruption), SQL injection / security validation, completeness scan on new handlers/routes
(invisible data loss), code review Critical-severity findings (security/correctness).

## Capability-adaptive compatibility

This skill remains the canonical guided compatibility path. When a verified profile session is
active, the host retains the full task graph, checklist, completed history, and future slices, then
sends the worker only the current six-field active slice plus its matching envelope and role grant.
A late profile/grant change requires a fresh-session handoff and never edits the project default.
The `profile-session.js` lane is a no-effect isolation probe, not an effectful handoff gate;
rehashable artifacts, same-process observations, and caller-authored traces cannot qualify one.

## Mission Routing Override

When project governance configures `mission_convergence`, this section overrides every legacy
Phase/P0 task-enumeration rule above. Before any TaskCreate, branch, worktree, runner, or model
effect:

```bash
node <autopilot-source>/scripts/mission-routing-admission.js \
  --repo-root "$(git rev-parse --show-toplevel)" --level <l3|l4|l5|l6>
```

(`scripts/mission-execution-graph-check.js` validates graph limits, source/rubric coverage,
critical path, batches, gate attempts, reservations, and ICC campaign projection bounds.)

| Admission | Meaning |
|---|---|
| `READY` | The only enforce-mode admission. One implementation TaskCreate per admitted graph node, plus the parent forcing-function tasks; every legacy "phase" above means an admitted graph node, `P0..PN` heading-extraction is disabled, and admitted tasks remain blocked by `L-1.6`. |
| `SHADOW` | Observation only — record `admitted`/`would_block` honestly, continue the legacy workflow, claim no enforced receipt or grant. |
| `LEGACY` | Project Mission policy is off. |

- Source `Phase`/`P0..PN` headings, modules, reviewer seats, tests, retries, repairs, and
  fallbacks remain coverage or gates inside a caller-authored bounded deliverable — never tasks
  one-for-one.
- Topology fallback reuses the same admission and owning gate-attempt budget; it does not create
  a second graph or reset authority. The project README keeps historical completed phases in a
  non-executable ledger and reports only current admitted deliverables as executable work.
- **Resume projection**: Mission nodes are remaining deliverables only — an already integrated
  deliverable is omitted or satisfied by an authoritative receipt/commit, never redispatched;
  `output_paths` list required mutations for the new candidate, not historical files already in
  HEAD, and correct campaign rejection of historical-output replay is not a cue to rewrite those
  paths. This judgment is methodology until a deterministic gate lands (BACKLOG).
