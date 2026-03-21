---
name: dev-flow
description: >
  Unified lifecycle orchestrator -- session start, task sizing (S/L/H/Fix), workflow execution, goal alignment,
  and session end. Invoke BEFORE starting any code changes, including context continuations.
  Fix = bug fix with known root cause (any module count, no plan/project needed).
---

# Development Flow Evaluation

## Project Config (auto-injected)
!`cat .claude/dev-flow-config.md 2>/dev/null || echo "_No .claude/dev-flow-config.md found -- using defaults below._"`

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

Create Phase Todos at start (extract p0...pN + completion from plan).

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

### L-2. Plan
- User provides plan: skip Plan Mode
- Needs design: EnterPlanMode -> design -> ExitPlanMode -> user approval

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

### L-5. Completion (all mandatory)

1. **Final Goal Review** -- verify all goals/criteria/boundaries from L-1 are met
2. **Pre-Merge Review** -- max 3 rounds
3. **Merge** -- merge feature branch to main (or create PR per project convention)
4. **Post-Merge Review** -- verify no merge losses
5. **Archive** -- archive project docs (invoke project-lifecycle archive flow)
6. **Post-Archive Sanity Check** -- verify archive was clean:
   ```
   - Active section in projects/INDEX has no entries pointing to _archive/
   - Feature branch is deleted (local + remote)
   - No stale plan entries remain in plans/INDEX Active section
   ```
7. **L Session End** -- run the full Session End checklist below

> Merge completes integration. After merge, return here for post-merge review -> archive.

### Staging Gate

**Trigger**: Phase/feature awaiting user review | session ending with undeployed committed changes.

Deploy per project config (default: build + restart).

---

## H Workflow -- Hotfix

> **Production is broken. Smallest possible fix, fastest path to stable.**

1. `git checkout -b hotfix/<description> main`
2. **Scope check**: if fix requires DB migration -> STOP, re-route to L. Cross-module bug fixes stay as H (or Fix if not production-critical).
3. Fix the issue (smallest possible change)
4. Run tests -- all must pass
5. Quality gate (per project config, or: lint + test)
6. Merge to main (`--no-ff`)
7. Post-incident: invoke `learn` skill -- mandatory knowledge entry
8. Delete hotfix branch
9. Run the full Session End checklist below

---

## Session End

### S-Lite (S, H, and Fix workflows)

Inline above in each workflow. Recap:

1. **Retry check**: retried a non-trivial operation 2+ times? Invoke `learn`.
2. **Deferred items**: anything postponed -> BACKLOG with context + trigger.
3. **Confirm commit**: change landed on the correct branch.
4. **Fix only**: verify ongoing-maintenance entry was written.

### L-Full (L workflow)

Run all steps. Create a checklist and complete each item before concluding.

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

5. Triggered BACKLOG pickup + invalidation:
   Scope "this session" using session-start-sha:
     git log --oneline $(cat .claude/session-start-sha 2>/dev/null || echo "HEAD~10")..HEAD

   a) **Trigger check**: any BACKLOG items have their trigger condition met?
      Surface matches to decision-maker:
      - Normal mode: present to user for action.
      - CEO mode: CEO decides autonomously (tactical). Record in CEO Report.

   b) **Invalidation check**: did this session delete files referenced by BACKLOG items?
      git diff --name-only --diff-filter=D $(cat .claude/session-start-sha 2>/dev/null || echo "HEAD~10")..HEAD
      For each deleted file, grep BACKLOG for references.
      If found: mark those BACKLOG items as obsolete with reason (e.g., "component deleted in insights-v2").
      This prevents stale items from accumulating after refactors.

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
!`cat .claude/skill-routing.md 2>/dev/null || echo "_No .claude/skill-routing.md found -- no project-specific skill routing._"`

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
