---
name: dev-flow
description: >
  Start here before writing any code — sizes task (S/L/H/Fix), sets up branch and session rules.
  Use when: "I'm starting on X", "quick fix for Y", "continuing from yesterday", "hotfix needed",
  "let's implement X", "skip to coding", "我要開始做 X", "快速修一下", "接續昨天的進度",
  resuming a feature branch, or any task that touches code. Not for: debugging
  (→ systematic-debugging), writing plans (→ writing-plans), brainstorming (→ brainstorming),
  or code review (→ quality-pipeline).
---

# Development Flow Evaluation

## Project Config (auto-injected)
!`cat .claude/dev-flow-config.md 2>/dev/null`

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

When resuming work on an existing feature branch with an active project:

```
1. Check for uncommitted changes: `git status -s`
   If dirty, ask user: commit, stash, or discard.
   Default if no response: `git stash push -m "auto-stash"`

2. Refresh session start SHA:
   git rev-parse HEAD > .claude/session-start-sha

3. Branch check + freshness (same as L-size gates 2-3).

4. Identify resume point from project docs or prior task state.

5. Skill routing check for the target code area.
```

Context continuation never re-evaluates size. It uses the size established in the original session.

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

Size is evaluated once at start, but scope can grow. After every commit, self-check:

```
Has the scope grown beyond original S-size?
  - 3+ commits already made
  - 3+ files in different modules changed
  - User asked for additional features beyond original goal

If yes → re-evaluate as L-size:
  - Create project dir + README + INDEX (retroactive)
  - Record prior commits as completed phases
  - Continue with L Workflow tracking
```

---

## S Workflow -- Direct Commit

1. Implement
2. Quality gate (per project config, or: lint + test)
3. Commit to current branch (descriptive message)
4. Cleanup: if from backlog, delete the item

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
6. **Write ongoing-maintenance entry** — append one line to `doc/projects/ongoing-maintenance/YYYY-MM.md`:
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
from plan) **AND** create a final parent closing task:

```
TaskCreate: "L-5: Invoke autopilot:finish-flow"
  description: MANDATORY L-size completion. Invoke autopilot:finish-flow which will
  expand into 6 discrete sub-tasks (Final Goal Review, Pre-Merge Review, Merge,
  Post-Merge Review, Archive, L Session End). Do not mark this completed until the
  skill has run and all 6 sub-tasks reach completed.
```

This parent task is the forcing function: it remains pending through every phase and is
surfaced by system-reminder after each tool use. It cannot be silently skipped because
marking it completed requires invoking `autopilot:finish-flow`, which itself creates 6 more
discrete pending tasks.

**If the parent L-5 task is missing at any point after L-1**: STOP, create it retroactively,
then continue.

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

Any criterion without a threshold or verification method means the plan is incomplete. Do not proceed until fixed.

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

**Historical rationale** (why this gate exists): On 2026-04-11, the `dev-flow-l5-enforcement`
project shipped the new `finish-flow` skill but initially missed the autopilot-side
user-facing surface (README skill count, CHANGELOG entry, template example, plugin version
bump). The source-code dimension was complete; the documentation dimension was invisible.
The finish-flow forcing function could not recover this — it enforces closing discipline,
not scope completeness. This is a different failure mode that belongs at L-1, not L-5.

**Why "Version sync verification (grep)" and "Credit / attribution" exist** (added v2.2.1):
The v2.2.0 `think-tank-dialectic` release walked the dimensions checklist correctly but
still had two near-misses: (1) `marketplace.json`'s version bump was missed because the
audit was walked from memory instead of grepping the old version string, so the edit list
forgot one of the two version files; (2) the README's `Inspired By` section was not
updated to credit the two source repos (`agora`, `council-of-high-intelligence`) because
the dimensions checklist had no row for attribution at all. Both failures share a root
cause: the audit was *enumerated* rather than *grepped*. The two new rows make grep the
default for version bumps, and add attribution as a first-class dimension whenever
external prior art is absorbed.

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
it TaskCreates 6 discrete sub-tasks (Final Goal Review → Pre-Merge Review → Merge → Post-Merge
Review → Archive → L Session End), each with an explicit verification output. Every sub-task
must be individually completed — they cannot be batched or compressed.

Why delegated: Historically L-5 was an inline 6-step list that got mentally compressed into
"one action" and silently skipped. The `finish-flow` skill replaces passive markdown with
active TaskCreate reminders that system-reminder surfaces until addressed. See
`autopilot:finish-flow` for the full size → sub-tasks table.

**CEO mode**: All 6 sub-tasks are within CEO DOA (tactical, reversible, local git ops). CEO
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

After code changes, verify documentation matches the new state:

| Changed | Should Update |
|---------|--------------|
| Core logic / business rules | Module docs or skills |
| Architecture / system design | Architecture docs |
| Interfaces / API contracts | API spec files |
| New/removed components | Component index, project config |
| Environment / infra changes | Deploy or infra docs |

Skip doc sync for: bug fixes, minor value tweaks, log message changes.

---

## Skill Routing (project-specific)
!`cat .claude/skill-routing.md 2>/dev/null`

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
| Inline L-5 / H-9 steps instead of invoking `finish-flow` | Always invoke `finish-flow`; inlining defeats the TaskCreate forcing mechanism |
| Mark parent L-5 / H-9 completed while finish-flow sub-tasks still pending | Parent only completes after all sub-tasks reach completed |
| Batch multiple finish-flow sub-tasks into one TaskCreate call | Each sub-task is its own TaskCreate — batching breaks the surface-per-tool-use mechanism |
| Enumerate L-size phases before running the L-1.5 Scope Completeness Audit | Scope audit determines WHICH phases should exist — it runs first |
| Skip the scope audit "because the task is obvious" | Invisible scope holes are the whole reason the audit exists; shipping an incomplete deliverable is always cheaper to prevent than to fix |

## Pre-implementation Checklist

- [ ] Check for existing in-progress projects
- [ ] Fix: `fix/` branch created, root cause confirmed
- [ ] L-size: project structure created (plan + project dir + branch)

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
