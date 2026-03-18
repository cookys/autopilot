---
name: dev-flow
description: >
  Evaluate task size (S/L) and determine workflow. Invoke BEFORE starting any code changes —
  including context continuations. Routes to direct-commit (S) or plan+project flow (L).
---

# Development Flow Evaluation

## Project Config (auto-injected)
!`cat .claude/dev-flow-config.md 2>/dev/null || echo "_No .claude/dev-flow-config.md found — using defaults below._"`

## Entry Point

```
Task received
├── New task          → Quick Decision (S or L)
├── Context continuation → Resume Project (below)
└── Existing Phase    → Continue on current branch
```

### Resume Project (Context Continuation)

1. Session start checklist (health check / knowledge review)
2. `git branch --show-current` — confirm feature branch
3. Find current project/phase docs
4. `git status --short` — check uncommitted changes
5. Continue from unfinished Phase

## Quick Decision

| Size | Criteria |
|------|----------|
| **S** | Single commit (single module, no interface change, self-contained) |
| **L** | Multiple commits (3+ modules / public API / incompatible data / Feature Flag / user requests planning) |

**Risk Escalation** (force L): money/points, auth/security, production protocol changes.

---

## S Workflow — Direct Commit

1. Implement
2. Quality gate (per project config, or: lint + test)
3. Commit to develop (descriptive message)
4. Cleanup: if from backlog, delete the item

> S does not use TodoWrite — too few steps to justify tracking overhead.

---

## L Workflow — Plan + Project

> **Continuous execution**: proceed between Phases without asking "continue?".
> **Stop only for**: Staging Gate | Build/test failure | Design decision needed | Context near limit.

Create Phase Todos at start (extract p0...pN + completion from plan).

### L-1. Intent Confirmation
- Final goal / success criteria / scope boundaries → record in project README

### L-2. Plan
- User provides plan → skip Plan Mode
- Needs design → EnterPlanMode → design → ExitPlanMode → user approval

### L-3. Project Setup (mandatory)
- Create project directory structure, branch, update project index
- Per project config for specific bootstrap commands

### L-4. Per Phase
- Implement → quality gate → commit → mark phase done

### L-5. Completion (all mandatory)
1. **Goal Review** — verify all goals/criteria/boundaries met
2. **Pre-Merge Review** — max 3 rounds
3. **Merge** — invoke `superpowers:finishing-a-development-branch`
4. **Post-Merge Review** — verify no merge losses
5. **Archive** — archive project docs

> `finishing-a-development-branch` only handles merge. After merge, return here for post-merge → archive.

### Staging Gate

**Trigger**: Phase/feature awaiting user review | session ending with undeployed committed changes.

Deploy per project config (default: build + restart).

---

## Skill Routing (project-specific)
!`cat .claude/skill-routing.md 2>/dev/null || echo "_No .claude/skill-routing.md found — no project-specific skill routing._"`

## Completeness Principle

AI makes the marginal cost of completeness near-zero. When choosing between approaches:

- **Option A** (complete: all edge cases, full test coverage, proper error handling) vs **Option B** (shortcut: happy path only) — **always choose A**.
- This applies to: test coverage, error handling, edge cases, documentation, and feature completeness.

## Anti-patterns

| Wrong | Correct |
|-------|---------|
| Ask "continue?" after Phase | Proceed directly to next Phase |
| Team commit task says only "commit changes" | Must include quality gate |
| User provides plan → skip project setup | Project dir must be created regardless |
| End session after merge | Must continue: post-merge → archive |

## Pre-implementation Checklist

- [ ] Check for existing in-progress projects
- [ ] L-size: project structure created (plan + project dir + branch)
