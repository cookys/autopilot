---
name: team
description: Team allocation and dependency-aware parallelization — decide when to use teams, select roles, dispatch parallel work safely. Invoke for L-size tasks to evaluate whether team dispatch reduces wall-clock time.
---

# Team Allocation

## Coexistence with Superpowers

This skill is autopilot's standalone methodology for *team allocation decisions* — when to organize parallel work, which roles to assign, how to analyze dependencies. If the `superpowers` plugin is installed, `superpowers:dispatching-parallel-agents` is the **dispatch mechanism** (the verb), but role/dependency planning (the noun) is still this skill's domain.

Differences worth knowing:

- **autopilot:team** = allocation decision tree (when to組隊, role 選擇, 依賴分析, team size rules, shutdown flow).
- **superpowers:dispatching-parallel-agents** = the technical dispatch mechanism — issuing parallel agent calls with structured reporting.
- For the dispatch mechanism preference (after allocation decided), see `.claude/dispatch-config.md`'s `## Parallel Dispatch` chain. For allocation methodology, this skill is the primary entry point regardless.

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
  prompt: |
    You are <role>, responsible for <specific work>...

    ### SKILLS — Invoke these via the Skill tool before touching code
    - /<plugin>:<skill>   # e.g. /autopilot:debug if this teammate will touch
                          # failure-prone code
    - /<project>:<skill>  # project skill for the affected module, if any
    - none — explain why  # explicit fallback when no skill applies

    <rest of role-specific instructions>
```

Paraphrasing a skill's methodology inside `<role-specific instructions>` is NOT
a substitute for the SKILLS block. The subagent must call the Skill tool so the
skill's full checklist / red-line rules / rationalization table load into its
session context — same discipline dev-flow L-1.6 enforces on the main session,
applied to subagent dispatch. For the full Seven-Element template (including
SKILLS) when dispatching L-size project work, see
`skills/ceo-agent/references/task-prompt-templates.md`.

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
| Dispatch teammate prompt without `### SKILLS` section | Subagent must invoke required skills via the Skill tool before touching code; paraphrasing the methodology in the prompt loses fidelity (same rule as ceo-agent step 9 and dev-flow L-1.6) |

## See Also

- [Dependency Analysis + Parallelization Tactics](references/team-tactics.md)
- `autopilot:dev-flow` — orchestrates team evaluation at L-4
