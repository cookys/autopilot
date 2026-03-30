
# Agent Dispatch Protocol

> How to construct role prompts, dispatch agents, and handle their returns within the team skill.
> For dispatch decision logic (when to parallelize): [team-tactics.md](team-tactics.md)
> For coordinator escalation/circuit breaker: `autopilot:ceo-agent` Delegation of Authority (DOA)
> For session-level context health: `autopilot:dev-flow` Context Health Check

---

## 1. Role Prompt Template

Every agent dispatch must use this 6-section structure. All sections are mandatory.

```markdown
## Identity
You are {role_name}, a {specialization}. {One sentence on method/approach.}

## Task
{What to do. Include measurable completion criteria.}

## Context Files
- {path/to/file1} — {why this file matters}
- {path/to/file2} — {why this file matters}
- {path/to/file3} — {why this file matters}

## Boundaries
Do NOT:
- {boundary 1 — e.g., modify files outside assigned scope}
- {boundary 2 — e.g., change public interfaces without coordinator approval}
- {boundary 3 — e.g., commit directly}

## Rules
{Copy applicable project rules here. Subagents do not read CLAUDE.md or
.claude/rules/ automatically — critical constraints must be inline.}

## When Stuck
Report BLOCKED or NEEDS_CONTEXT with:
- What you tried (max 3 attempts)
- What failed and why
- What specific information or action you need
Do NOT stub, mock, or work around blockers.
```

### Template Rules

- **Boundaries**: minimum 3 items. Include file scope exclusions and decision authority limits.
- **Context Files**: 3-6 paths. Prefer specific files over directories. Never paste file content into prompt — pass paths only.
- **Rules Injection**: Read `.claude/rules/` files matching the agent's file scope. Copy applicable rules verbatim into the Rules section. If no rules apply, write "No project-specific rules apply."

---

## 2. Model Selection

| Task Type | Model | Examples |
|-----------|-------|---------|
| Mechanical | haiku | test runner, lint, file search, grep-and-replace |
| Balanced execution | sonnet | single-module implementation, CRUD, refactoring |
| Deep reasoning | opus | architecture design, cross-module coordination, audits |

Default: **sonnet**. Override via `agent-protocol-config.md` or `team-config.md` role table.

---

## 3. Dispatch Format

Every agent dispatch via the Agent tool must provide these 4 fields in the prompt:

| Field | Content | Example |
|-------|---------|---------|
| task_scope | One-sentence boundary of the work | "Implement POST /admin/settle-monthly in allowance_engine" |
| context_files | File paths the agent should read first | 3-6 paths from Context Files section |
| completion_criteria | Measurable definition of done | "Endpoint returns 200, test passes, no 500 errors" |
| return_format | Reference to §4 | "Return using 4-status protocol" |

### Separating Instructions from Data

When including variable data (user requirements, upstream decisions, small inline context), use XML tags to prevent Claude from confusing data with instructions:

```
<task_scope>Implement monthly settlement endpoint.</task_scope>
<upstream_decisions>Phase 1 decided: Decimal precision, no f64.</upstream_decisions>
<context_files>
- backend/src/allowance_engine/service.rs
- backend/src/accounting/domain.rs
</context_files>
```

Instructions remain outside tags. Data goes inside.

---

## 4. Return Protocol

Agents return using 4 statuses (aligned with Superpowers convention):

| Status | Meaning | Coordinator Action |
|--------|---------|-------------------|
| **DONE** | All criteria met | Verify artifacts, proceed to next task |
| **DONE_WITH_CONCERNS** | Complete but flagged issues | Evaluate concerns — fix now or backlog |
| **BLOCKED** | Cannot proceed after 3 attempts | Resolve blocker, re-dispatch or reassign |
| **NEEDS_CONTEXT** | Missing information to continue | Provide requested context, re-dispatch |

### Structured Return Format

```markdown
## Status: {DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT}

### Key Outcomes
- {outcome 1}
- {outcome 2}
- {outcome 3}

### Artifacts
- {file path}: {one-line description}

### Issues (if any)
- {issue + suggested resolution}
```

Keep returns under 500 words. If detail exceeds this, write to a file and return summary + path.

---

## 5. Per-Agent Context Rules

These govern context flow between coordinator and agents. Session-level context management (token budget, health checks) belongs to `dev-flow`.

### Output Threshold

| Condition | Action |
|-----------|--------|
| Agent return > 500 words | Write detail to file, return summary + file path |
| Coordinator dispatch includes file content | **Violation** — pass paths, not content |

### Checkpoint Protocol

| Condition | Action |
|-----------|--------|
| 5+ sequential task dispatches | Coordinator writes checkpoint summary to project docs |
| Phase ends (L-size multi-phase) | Write phase checkpoint to `docs/projects/`, release phase context |

Checkpoints enable context recovery: any agent (or new session) can resume from the last checkpoint without the original context.

---

## 6. Adversarial Check

When dispatching **2+ implementation agents** in parallel, add a lightweight reviewer:

```
Agent tool:
  subagent_type: "Explore"
  model: "sonnet"
  name: "team-reviewer"
  prompt: "Review the outputs of {agent-1} and {agent-2} for:
    - Scope violations (modified files outside assigned boundaries)
    - Interface mismatches (incompatible types, API contracts)
    - Completeness (claimed DONE but left TODOs or stubs)
    Return: PASS or list of issues with file:line references."
```

**Skip when**: only 1 implementation agent, or agents work on completely disjoint codebases with no shared interfaces.

---

## Anti-patterns

| Wrong | Correct |
|-------|---------|
| Dispatch without Boundaries section | Every role needs ≥3 explicit "Do NOT" items |
| Ignore DONE_WITH_CONCERNS | Evaluate every concern before proceeding |
| Retry BLOCKED agent with same context | Resolve the blocker first, then re-dispatch |
