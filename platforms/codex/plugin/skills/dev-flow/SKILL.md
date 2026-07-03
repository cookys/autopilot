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

Total overhead target: under 5 seconds.

```
1. Confirm task: restate what will be done in one sentence.
2. Branch check: `git branch --show-current` -- confirm on expected branch.
3. Proceed to S Workflow. No further gates.
```

S-size skips: branch freshness, knowledge/digest review, draft plan overlap, risk escalation.

### L-Size Full Gates

All gates must pass before any code changes begin. If any gate is blocked, surface to the decision-maker (user in normal mode, CEO in CEO mode).

```
1. Record session start SHA:
   git rev-parse HEAD > .claude/session-start-sha

2. Branch check:
   git branch --show-current

3. Branch freshness:
   BEHIND=$(git log HEAD..main --oneline 2>/dev/null | wc -l)
   AHEAD=$(git log main..HEAD --oneline 2>/dev/null | wc -l)
   Evaluate using the freshness table below.
   If main does not exist (new repo), skip this gate.

4. Knowledge and digest review:
   Check .claude/knowledge/ for relevant prior learnings.
   Check for unprocessed session digests.

5. Draft plan overlap check:
   ls doc/plans/*.md 2>/dev/null  (or project-configured path)
   If draft plans exist, check if the current task overlaps with any draft plan
   (same feature, same module, or same user story).
   If overlap found:
   - Normal mode: surface to user -- confirm whether to proceed or adopt the draft.
   - CEO mode: CEO decides within DOA (tactical decision).
   If no draft plans or no overlap: proceed.

6. Skill routing:
   Check CLAUDE.md (or project config) for code-area-specific skills.
   If a skill is listed for the target code area, invoke it before writing code.
   **Active enforcement**: For L-size, this gate is backed by the L-1.6 TaskCreate
   parent task (see L Workflow → Task tracking). Reading this bullet is NOT enough —
   the TaskCreate is the forcing function that prevents skipping.
```

### Branch Freshness Table

| Behind | Ahead | Status | Action |
|--------|-------|--------|--------|
| 0 | any | Up to date with main | Proceed |
| 1-5 | any | Slightly behind | Proceed with note |
| >5 | 0 | Behind, no local work | Warn user, recommend merge |
| >5 | >0 | DIVERGED | Flag to user before proceeding |

### Fix Path

Same lightweight start as S, plus branch creation:

```
1. Confirm root cause: restate the bug and known fix in one sentence.
2. Branch: `git checkout -b fix/<description>`
3. Skill routing check for the target code area.
4. Proceed to Fix Workflow.
```

Fix skips: knowledge/digest review, plan overlap, branch freshness (short-lived branch).

### Context Continuation (Resuming Prior Work)

Resuming work on an existing feature branch with an active project → follow the 5-step procedure in [references/context-continuation.md](references/context-continuation.md) (uncommitted-changes check, SHA refresh, branch freshness, resume point, skill routing). Context continuation never re-evaluates size — it uses the size from the original session.

---

## Session Rules (persist throughout)

These rules apply to ALL subsequent work in this session, regardless of which skills are invoked.
They complement (not replace) any built-in skills — providing project-specific context.

### Config Injection Rules

When performing these activities, FIRST read the corresponding config file if it exists.
The config provides project-specific tools, commands, known issues, and conventions.
If the config file does not exist, proceed normally without it.

| Activity | Config File | What It Contains |
|----------|------------|-----------------|
| Debugging (bugs, crashes, logic errors) | `.claude/debug-config.md` | Debug tools, Docker commands, known gotchas, layer-by-layer diagnosis |
| Writing or running tests | `.claude/test-strategy-config.md` | Test framework, commands, coverage thresholds, test pyramid conventions |
| Parallel task dispatch (team work) | `.claude/team-config.md` | Role templates, tech stack context, team size rules |
| Performance profiling | `.claude/profiling-config.md` | Profiling tools, metrics collection, baseline commands |
| Comparison audit (old vs new) | `.claude/audit-config.md` | Known by-design divergences, audit scope definitions |
| Methodology / reviewer / parallel dispatch routing | `.claude/dispatch-config.md` | Preference chains for debugging / testing / profiling / team / review / parallel dispatch (also auto-injected at top of this skill) |

### Quality Gate Rule

**Before committing or merging, invoke `autopilot:quality-pipeline`.**
This is non-negotiable. The quality pipeline runs: test → scan → completeness → review.

### Session End Rule

When the user signals session end (or task completion for S-size):
- Update project tracking if L-size (`docs/projects/*/README.md` + `INDEX.md`)
- Record knowledge if something was surprising or took >1 retry (`autopilot:learn`)

---

## Quick Decision

First ask: **what kind of work is this?**

| Nature | Criteria | Workflow |
|--------|----------|----------|
| **Fix** | Bug fix — root cause known, solution clear. No design needed. | Fix (any module count) |
| **H** | Production broken — immediate fix needed. | Hotfix |

If neither → size the **feature**:

| Size | Criteria | Workflow |
|------|----------|----------|
| **S** | Single commit (single module, no interface change, self-contained) | Direct commit |
| **L** | Multiple commits (3+ modules / public API / incompatible data / Feature Flag / user requests planning) | Plan + Project |

**Fix vs L**: "Do I need to *design* the solution, or just *implement* a known fix?" Design → L. Known fix → Fix.

**Risk Escalation** (force L for features): money/points, auth/security, production protocol changes.
Risk-escalated bug fixes stay Fix but add PR review before merge.

### Scope Creep Detection

Size is evaluated once at start, but scope can grow silently. Two escalation paths:

**S → L escalation** is enforced by the `S-scope-gate` TaskCreate (created at S-start — see S
Workflow). That task stays pending and surfaces before every tool use, forcing an explicit
check before each commit. Passive self-checks after commits fail because memory is exactly
what keeps failing.

**L scope expansion** (L work grows beyond its original README scope boundary — new subsystems,
unplanned API surfaces, additional stakeholder requirements mid-flight):

```
After every phase completion, ask:
  "Does the REMAINING scope still match the README's scope boundary?"

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

1. Implement
2. Quality gate (per project config, or: lint + test)
3. Evaluate S-scope-gate indicators before committing
4. Commit to current branch (descriptive message)
5. Cleanup: if from backlog, delete the item

> Unlike L's multi-task infrastructure, S creates exactly ONE TaskCreate: the S-scope-gate.
> Intentionally minimal — one pending task that surfaces the scope-creep check without adding L-level overhead.

**S Session End (lite)**:

```
1. Retry check:
   "Did I retry any non-trivial operation 2+ times?
   If yes, invoke `learn` skill to record the finding."

2. Deferred items:
   If anything was postponed, add to BACKLOG with context + trigger condition.

3. Confirm commit:
   Verify the change landed on the correct branch.
```

> S does not use TodoWrite -- too few steps to justify tracking overhead.

---

## Fix Workflow -- Bug Fix (any module count)

> Bug fix with clear root cause. No plan/project needed. Feature branch for traceability.

1. `git checkout -b fix/<description>`
2. Investigate root cause (read code, trace data flow)
3. Implement fix
4. Quality gate (per project config, or: lint + test)
5. Commit with **detailed message**: root cause + what was wrong + how it's fixed
6. **Write ongoing-maintenance entry** — append one line to `doc/projects/ongoing-maintenance/YYYY-MM.md` (or the project-configured projects path — e.g. `docs/` plural; check the injected config so you don't create a stray sibling tree):
   `| MM-DD | commit_hash | fix(area): 根因 → 修法 (跨 N 模組) |`
7. Merge to develop
8. Cleanup: delete fix branch

If the fix revealed a non-obvious lesson, invoke `learn` skill.

**Fix does NOT create**: plan, project dir, or PR (unless risk-escalated).

---

## L Workflow -- Plan + Project

> **Continuous execution**: proceed between Phases without asking "continue?".
> **Stop only for**: Staging Gate | Build/test failure | Design decision needed | Context near limit.

**Task tracking (MANDATORY at L-1)**: Create Phase Todos at start (extract p0...pN + completion
from plan) **AND** create TWO parent tasks. Both are non-optional forcing functions — missing
either one = failed L-1 gate:

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

Both parent tasks are forcing functions: they remain pending through every phase and are
surfaced by system-reminder after each tool use. They cannot be silently skipped because
marking them completed requires explicit work — L-1.6 requires Skill-tool invocations,
L-5 requires invoking `autopilot:finish-flow` which itself creates 6 more discrete pending
tasks.

**Why L-1.6 exists** (historical rationale): see references/historical-rationale.md § Why L-1.6 exists

**Phase task dependency** (mechanical enforcement, not just a reminder): When TaskCreating
phase tasks P0..PN, each MUST be created with `blockedBy=[L-1.6]`. This means phases
literally cannot be claimed/started until L-1.6 reaches `completed`. The system-reminder
surfaces pending L-1.6 after every tool use; the blockedBy dependency makes starting
implementation impossible without first resolving it. Two layers of defense.

**If either parent task is missing at any point after L-1**: STOP, create it retroactively,
then continue. For L-1.6 specifically, if implementation has already started without skill
routing: pause current phase, create L-1.6 now, invoke the missing skills, then resume.

### L-1. Intent Confirmation

Confirm before starting. Record in the project README:

```markdown
## Project Goal

> **Final goal**: [one sentence]
> **Success criteria**: [quantifiable conditions]
> **Scope boundary**: [explicit include/exclude]
```

**Quantifiable** means each criterion must include (a) a measurable threshold (number, percentage, boolean state, or named command output), AND (b) how it will be verified.

| | Example |
|------|---------|
| PASS | "API returns <200ms for 95th percentile (measured by load test)." |
| FAIL | "Performance is acceptable." |

Any criterion without a threshold or verification method means the plan is incomplete. Do not proceed until fixed. Select acceptance criteria from [acceptance-patterns.md](../../references/acceptance-patterns.md) for acceptance-pattern selection (referencing pattern ids and evidence including negative controls).

**CEO mode**: SKIP intent confirmation -- CEO already confirmed OKR during Startup. Do not ask the user again.

#### Scope Completeness Audit (MANDATORY before phase TaskCreate)

A correctly-executed phase plan cannot recover from an incomplete scope. Before creating
phase tasks, run a dimensions audit so the scope boundary reflects every surface this
change touches, not just the one the task description mentions.

**Create a discrete TaskCreate as the first item**:

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

**For each "yes" row**, either:
- Add a phase task covering it, OR
- Document in `README.md` scope boundary why it's explicitly out-of-scope

**Feeds into L-1.6**: The module/surface list produced here is the direct input to the
L-1.6 Skill routing TaskCreate. Every "Source code + tests" module enumerated here must
have its required project skills invoked before any phase starts. Do not mark L-1.5
completed without first cross-referencing each module against `.claude/skill-routing.md`
(or project equivalent).

**Historical rationale** (why this gate exists): see references/historical-rationale.md § Why the L-1.5 Scope Completeness Audit exists

**Why "Version sync verification (grep)" and "Credit / attribution" exist** (historical rationale): see references/historical-rationale.md § Why Version Sync Verification and Credit / Attribution exist

**CEO mode**: CEO performs the audit autonomously and records the coverage in the README
scope boundary. Do not ask the user to enumerate dimensions — that's CEO tactical work.

### L-2. Plan
- User provides plan → use it directly, skip Plan Mode.
- Needs design → EnterPlanMode → design → ExitPlanMode → user approval.
- Save plan to: `docs/plans/YYYY-MM-DD-<feature-name>.md`

### L-3. Project Setup (mandatory)
- Create project directory structure, branch, update project index
- Per project config for specific bootstrap commands

### L-4. Per Phase

**Goal verification** -- answer all three before starting each phase:

1. Does this change move us closer to the **final goal**?
2. Is this phase essential — would skipping it prevent the final goal from being achieved?
3. Does my understanding match the user's stated goal?

**Pass threshold**: Q1=yes, Q2=yes (essential), Q3=yes. Any "no" or "unsure" = blocked. Surface to decision-maker before proceeding.

**CEO mode**: CEO evaluates the three questions autonomously. Only escalate to user (Board) if the answer is "no" AND the required response is a strategic pivot (goal change, scope expansion) -- per CEO's DOA.

**Drift signals**:

| Signal | Response |
|--------|----------|
| "This phase has low ROI, skip it" | STOP -- Does it affect the final goal? |
| "We can do this later" | STOP -- Any hidden dependencies? |
| "Project is basically done" | STOP -- Has the final goal been achieved? |
| "User probably just wants..." | STOP -- Ask and confirm directly. |

**Execution**: Implement -> quality gate -> commit -> mark phase done.

**Backlog safety** (before deferring anything):

1. Does this item affect the final goal? If **yes**, do NOT defer.
2. Can the goal be achieved without it? If **no**, do NOT defer.
3. Unsure? **Ask the user.**

If deferral passes: add to BACKLOG with context + trigger condition, mark phase "Deferred" in project docs.

**Phase advance gate** -- all must be true before starting the next phase:

- [ ] Goal check: all three verification questions answered "yes"
- [ ] Tests pass: zero failures
- [ ] Completeness scan: no placeholder markers or stub implementations
- [ ] Code review: no blocking issues remain
- [ ] Project docs: progress row updated to reflect phase completion

**CEO mode**: CEO verifies all prerequisites. No user confirmation needed for passing gates.

### L-5. Completion (MANDATORY — via finish-flow forcing function)

**Invoke `autopilot:finish-flow`.** That skill owns the L-size closing sequence. On invocation
it TaskCreates 7 discrete sub-tasks (Final Goal Review → Pre-Merge Review → Merge → Post-Merge
Review → Archive → L Session End → Delete merged branch), each with an explicit verification
output. Every sub-task must be individually completed — they cannot be batched or compressed.

Why delegated: Historically L-5 was an inline 6-step list that got mentally compressed into
"one action" and silently skipped. The `finish-flow` skill replaces passive markdown with
active TaskCreate reminders that system-reminder surfaces until addressed. See
`autopilot:finish-flow` for the full size → sub-tasks table.

**CEO mode**: All 7 sub-tasks are within CEO DOA (tactical, reversible, local git ops). CEO
does not pause to ask the user between sub-tasks — execute all, then report.

### Staging Gate

**Trigger**: Phase/feature awaiting user review | session ending with undeployed committed changes.

Deploy per project config (default: build + restart).

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
4. Invoke `autopilot:finish-flow` — it expands the remaining closing sequence into 6 discrete
   sub-tasks (verify fix → quality gate → merge to main `--no-ff` → post-incident `learn`
   (MANDATORY) → delete hotfix branch → session end). Each must be individually completed.

> H workflow prioritizes speed. The forcing function does not add steps — it only prevents
> skipping the existing ones. For rollback situations, invoke `finish-flow` after the
> rollback is verified stable.

---

## Session End

> **L-size and H-size**: Session End is a **sub-task inside `autopilot:finish-flow`** (L-5.6 /
> H-9.6), not a standalone section you run yourself. Do not duplicate the checklist here —
> `finish-flow` creates the discrete tasks and this section is their reference material.
>
> **S and Fix**: `finish-flow` is optional. You may either run the inline S-Lite below or
> invoke `autopilot:finish-flow` for the same effect in TaskCreate form.

### S-Lite (S and Fix workflows, inline)

1. **Retry check**: retried a non-trivial operation 2+ times? Invoke `learn`.
2. **Deferred items**: anything postponed -> BACKLOG with context + trigger.
3. **Confirm commit**: change landed on the correct branch.
4. **Fix only**: verify ongoing-maintenance entry was written.

### L-Full Reference (invoked by finish-flow L-5.6)

The L Session End sub-task (L-5.6) runs the full checklist below. Create a checklist and
complete each item before concluding.

```
1. Verify completion:
   - User's last request is completed (or user explicitly said pause/stop).
   - No background work pending.
   - If on a feature branch: check if branch is merged to main.
     If not merged, flag to user before proceeding.

2. Update project docs:
   - Update project progress table and last-updated date.
   - Sync project index.
   - If 100% complete + merged: invoke project archival.

3. Knowledge extraction -- ask yourself:
   - Stepped on a non-obvious landmine?       -> record in .claude/knowledge/
   - Made an architecture decision?            -> record in project docs
   - Discovered a process gap?                 -> update relevant skill
   - Learned something cross-session useful?   -> record in persistent memory
   - None of the above?                        -> skip, do not force it

4. Deferred items:
   Anything postponed goes to BACKLOG with:
   - Context: what it is and why it was deferred
   - Trigger condition: when it should be picked up
   Backlog safety: if the item affects the final goal, do NOT defer.

5. Triggered BACKLOG pickup:
   Check if any BACKLOG items have their trigger condition met by this session's work.
   Scope "this session" using session-start-sha:
     git log --oneline $(cat .claude/session-start-sha 2>/dev/null || echo "HEAD~10")..HEAD
   Surface matches to decision-maker:
   - Normal mode: present to user for action.
   - CEO mode: CEO decides autonomously (tactical). Record in CEO Report.

6. Invoke learn skill:
   Produce a session learning summary covering:
   - Errors encountered and resolved (root cause + fix)
   - Key decisions made (rationale)
   - Surprises or counter-intuitive discoveries

7. Staging verify (if applicable):
   Confirm staging reflects latest code.
   Skip if: mid-implementation, only doc changes, or no staging environment.

8. Checklist summary:
   Output pass/fail for each gate. Include in PR description for L-size tasks.
```

### Context Health Check (conditional)

If the session was long or context feels degraded, measure token budget:

```
Budget baseline: 200K tokens = 100%.
Approximate conversion: 1 token ~ 3.5 bytes (blended estimate for mixed-language codebases).

Report three layers:
- Fixed (loaded every session): CLAUDE.md, MEMORY.md, auto-injected context
- Loaded this session: skills invoked in current conversation
- On-demand (not yet loaded): remaining skills, knowledge files

If usage > 70%: flag for attention.
If specific files are bloated: recommend compress or split strategies.
```

### Post-Feature Doc Sync

After code changes, verify documentation matches the new state — see the changed→update mapping table in [references/post-feature-doc-sync.md](references/post-feature-doc-sync.md). Skip doc sync for: bug fixes, minor value tweaks, log message changes.

---

## Skill Routing (project-specific)
!`cat .claude/skill-routing.md 2>/dev/null || true`

## Completeness Principle

AI makes the marginal cost of completeness near-zero. When choosing between approaches:

- **Option A** (complete: all edge cases, full test coverage, proper error handling) vs **Option B** (shortcut: happy path only) -- **always choose A**.
- This applies to: test coverage, error handling, edge cases, documentation, and feature completeness.

## Anti-patterns

| Wrong | Correct |
|-------|---------|
| Bug fix escalated to L because it crosses 3 modules | Use Fix -- module count doesn't determine bug fix workflow |
| Ask "continue?" after Phase | Proceed directly to next Phase |
| Team commit task says only "commit changes" | Must include quality gate |
| User provides plan -> skip project setup | Project dir must be created regardless |
| End session after merge | Must continue: post-merge -> archive -> session end |
| Skip branch freshness on L-size | Always check before starting L-size work |
| Force knowledge extraction when nothing happened | Skip -- do not force it |
| Defer work that affects the final goal | Never defer goal-critical items |
| Re-evaluate size on context continuation | Use size from the original session |
| Auto-execute context reduction without confirmation | List confirm operations with numbered choices |
| Skip the L-1 / H-1 parent closing TaskCreate "because I remember the steps" | The parent task IS the forcing function — memory is exactly what keeps failing; always create it |
| Skip the L-1.6 skill routing TaskCreate "because I already read CLAUDE.md" | Reading ≠ invoking. The TaskCreate exists because passive bullets get mentally compressed into "I know this area". Invoke each required skill via the Skill tool, even if you "remember" it |
| Create phase tasks without `blockedBy=[L-1.6]` | The dependency is the mechanical enforcement; a pending L-1.6 that doesn't actually block implementation is just another reminder to ignore |
| Mark L-1.6 completed after "reading" the skill files in knowledge base | Reading skill markdown is not the same as Skill-tool invocation. The invocation loads the skill into the session context and creates the explicit decision record. Read ≠ invoke |
| Inline L-5 / H-9 steps instead of invoking `finish-flow` | Always invoke `finish-flow`; inlining defeats the TaskCreate forcing mechanism |
| Mark parent L-5 / H-9 completed while finish-flow sub-tasks still pending | Parent only completes after all sub-tasks reach completed |
| Batch multiple finish-flow sub-tasks into one TaskCreate call | Each sub-task is its own TaskCreate — batching breaks the surface-per-tool-use mechanism |
| Enumerate L-size phases before running the L-1.5 Scope Completeness Audit | Scope audit determines WHICH phases should exist — it runs first |
| Skip the scope audit "because the task is obvious" | Invisible scope holes are the whole reason the audit exists; shipping an incomplete deliverable is always cheaper to prevent than to fix |
| Skip S-scope-gate TaskCreate "because it's clearly a small task" | Scope creep is invisible at S-start — the gate exists precisely because it grows silently; always create it |
| Create S-scope-gate but only evaluate it at task end | The task must be created at S-start so system-reminder surfaces it before EVERY commit, not just at completion |
| L-size scope expands mid-project without Board notification | Any expansion beyond the original README scope boundary is a Board Decision — CEO/user must approve before continuing |
| Treat L-scope expansion as a tactical decision CEO can make alone | Doubled estimate or new subsystem = Resources 2x+ = requires Board approval per DOA |

## Pre-implementation Checklist

- [ ] Check for existing in-progress projects
- [ ] S-size: S-scope-gate TaskCreate created (scope-creep forcing function — MANDATORY before any implementation)
- [ ] Fix: `fix/` branch created, root cause confirmed
- [ ] Fix: skill routing checked for affected module (passive — Fix stays lightweight, no
      TaskCreate; see BACKLOG for future Fix-workflow forcing function)
- [ ] L-size: project structure created (plan + project dir + branch)
- [ ] L-size: L-1.5 Scope Completeness Audit TaskCreate created
- [ ] L-size: L-1.6 Skill routing TaskCreate created (parent forcing function, non-optional)
- [ ] L-size: L-5 finish-flow TaskCreate created (parent forcing function, non-optional)
- [ ] L-size: Phase tasks (P0..PN) created with `blockedBy=[L-1.6]`

---

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
