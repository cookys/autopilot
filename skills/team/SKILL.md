---
name: team
description: Team allocation and dependency-aware parallelization — decide when to use teams, select roles, dispatch parallel work safely. Invoke for L-size tasks to evaluate whether team dispatch reduces wall-clock time.
---

# Team Allocation

## Project Config (auto-injected)
!`cat .claude/team-config.md 2>/dev/null || echo "_No config — using generic role templates below._"`

## When Teams Are Needed

| Size | Team | Action |
|------|------|--------|
| S | No | Do directly |
| L | Evaluate | Use decision tree below |

## Decision Tree

```
L-size task
├── All phases sequentially dependent? → No team, solo by phase
├── 2+ independent parallel work blocks? → Build team
│   ├── Backend + Frontend changes   → backend-dev + frontend-dev
│   ├── Audit then implement         → auditor + implementer
│   ├── Multiple modules each need changes → per-module agents
│   └── Research + implement can overlap   → researcher + implementer
└── Unsure? → Solo Phase 0 design first, then decide
```

## Role Templates

| Role | subagent_type | Use Case |
|------|--------------|----------|
| backend-dev | `general-purpose` | Backend/server changes |
| frontend-dev | `general-purpose` | Frontend/client changes |
| auditor | `Explore` | Code audit, investigation |
| researcher | `Explore` | Architecture research, comparison |
| tester | `general-purpose` | E2E/stress testing |

## Team Size Rules

- **Minimize**: 2 agents sufficient? Do not use 3.
- **Cap at 3**: Coordination cost exceeds parallelism benefit beyond 3.
- **Leader = self**: Main agent coordinates. Do not spawn a separate leader.

## Dependency Analysis

Details on dependency graph construction, file overlap checks, and common parallelization patterns: [references/team-tactics.md](references/team-tactics.md)

## Execution

### Create Team

```
TeamCreate:
  team_name: "<project-name>"
  description: "<one-line description>"
```

### Create Tasks

One task per parallelizable work unit:
```
TaskCreate:
  subject: "Phase N: <specific work>"
  description: "Full description including:
    - Files to modify
    - Completion criteria
    - Verification method"
  activeForm: "Working on Phase N"
```

### Spawn Teammates

```
Agent tool:
  subagent_type: "<from role templates>"
  team_name: "<project-name>"
  name: "<role-name>"
  prompt: "You are <role>, responsible for <specific work>..."
```

### Coordination Principles

1. **Task-driven**: Each teammate picks work from TaskList
2. **Concise messaging**: SendMessage only when coordination needed
3. **Leader does not implement**: Leader coordinates + reviews, does not take tasks
4. **Report on completion**: Teammate does TaskUpdate + SendMessage when done
5. **Timely shutdown**: All tasks complete -> run shutdown flow

### Shutdown

```
All tasks completed
├── 1. Confirm all TaskUpdate status=completed
├── 2. Leader reviews each teammate's output
├── 3. TeamDelete team_name="<project-name>"
└── 4. Report final results to user
```

## Anti-patterns

| Wrong | Correct |
|-------|---------|
| "I'll do it faster solo" | Evaluate objectively — 2 modules = worth parallelizing |
| Team commit task says "commit changes" | Must include quality-pipeline |
| Dispatch without file overlap check | Always check overlap first |

## See Also

- [Dependency Analysis + Parallelization Tactics](references/team-tactics.md)
- `autopilot:dev-flow` — orchestrates team evaluation at L-4
