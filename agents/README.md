# Autopilot Methodology Agents

This directory ships **three methodology agents** bundled with autopilot. They carry autopilot's discipline axis into agent-level execution so dispatched reviews, debugs, and plans follow the same Three Red Lines as the skill layer.

| Agent | Purpose | Model | Read-only |
|-------|---------|-------|-----------|
| **`reviewer`** | Pre-commit / pre-merge code review, security audit, plan critique | opus | ✅ |
| **`debugger`** | Evidence-first root-cause analysis, test failure investigation | opus | ✅ |
| **`planner`** | Six-element Task Prompt decomposition for L-size work | sonnet | ✅ |

All three are **read-only** — they produce findings, proposed fixes, or task breakdowns, and hand off to the calling skill via a `### Handoff` section with an enum-based `Next consumer` field. None of them patch code directly.

## Three Red Lines — baked into every agent

Each agent's system prompt enforces the autopilot methodology:

1. **Closure** — every finding / hypothesis / task has impact + fix direction + acceptance criteria; nothing open-ended
2. **Fact-driven** — every claim cites `file_path:line_number`; "probably" / "likely" / "I think" are violations
3. **Exhaustiveness** — full checklists run; clean items explicitly listed under `✅ Verified Clean`; silent omission is a violation

## Dispatch boundary — who calls which agent

Autopilot methodology agents and voltagent role agents **coexist without conflict** because they have different dispatch entry points:

- **Autopilot skills** (`quality-pipeline`, `dev-flow`, `ceo-agent`, `finish-flow`, ...) dispatch autopilot methodology agents to carry Three Red Lines discipline into skill invocations — `:debugger` and `:planner` are named directly by their consumer skills; the reviewer is selected via the `.claude/dispatch-config.md` `## Code Review` chain with `autopilot:reviewer` as the default fallback when the chain is unset or no chain entry is dispatchable.
- **Direct user invocation** — when you reach for a reviewer or debugger yourself via the `Agent` tool, voltagent's role agents (`voltagent-qa-sec:code-reviewer`, `voltagent-qa-sec:debugger`, etc.) are usually the better primary choice because they have broader domain coverage (Go / Rust / PostgreSQL / Kubernetes specialization).

Two different workflows, two different dispatch paths, zero overlap in practice.

### Layer cake

| Layer | Ownership | When it runs |
|-------|-----------|--------------|
| **Methodology** | autopilot (this plugin) | Dispatched automatically by autopilot skills to enforce Three Red Lines |
| **Role** | voltagent (companion plugin) | Invoked directly by user when domain expertise matters more than discipline uniformity |
| **Project** | `<project>/.claude/agents/` | Project-specific agents (e.g., `twgs-reviewer` with TWGameServer active constraints) extend or replace the layers above |

Autopilot does **not** runtime-detect voltagent. `:debugger` and `:planner` are named directly by their consumer skills; the reviewer is selected via the `.claude/dispatch-config.md` `## Code Review` chain with `autopilot:reviewer` as the default fallback when the chain is unset or no chain entry is dispatchable. If you want a reviewer not in the chain for a one-off task, invoke it explicitly via the `Agent` tool — that is a user-layer choice on top of the chain mechanism.

## Unified Output Contract

All three agents produce output in the same shape:

```
## <Agent> Report
<agent-specific body>
...
### Handoff
Next consumer: <ENUM>
Routing rationale: <one sentence; omitted in trivial cases>
Remaining risks: <list or "none">
```

The `Next consumer` field uses a **fixed enum** so calling skills can pattern-match the handoff deterministically without interpreting free text:

| Enum | Meaning |
|------|---------|
| `MAIN_CLAUDE` | Main Claude executes the next step (trivial patch, small fix, simple continuation) |
| `AUTOPILOT_DEBUGGER` | Calling skill should re-dispatch `autopilot:debugger` for root-cause analysis |
| `AUTOPILOT_PLANNER` | Calling skill should re-dispatch `autopilot:planner` for structural decomposition |
| `NEEDS_DOMAIN_EXPERT` | Requires language / stack domain specialist — calling skill decides which voltagent role maps (e.g., `voltagent-lang:rust-engineer` for Rust memory safety) |
| `PARALLEL_DISPATCH` | Multiple independent subtasks — calling skill picks its preferred parallel dispatcher |
| `SEQUENTIAL_DISPATCH` | Subtasks with dependencies — calling skill picks its preferred sequential runner |
| `DOCUMENT_ONLY` | Record the finding, no action required (typical for 🟡 Minor / 🔵 Suggestion) |

### Why an enum and not free text

- **Calling skills can pattern-match.** Quality-pipeline reads the Handoff and knows exactly what to do next without needing an LLM round-trip to interpret routing language.
- **Agents do not need voltagent catalog awareness.** A methodology agent says "needs domain expert" — it is the calling skill's job to know which voltagent role to invoke.
- **No hard dependencies on third-party plugins.** `PARALLEL_DISPATCH` does not hardcode `superpowers:dispatching-parallel-agents` or any other dispatcher; autopilot remains self-sufficient.

## Orchestration — agents do not call each other (one scoped exception)

**Methodology agents never dispatch other methodology agents, and verdict-producing agents (reviewer, debugger) never dispatch at all.** All chaining happens at the skill layer. (Sole exception: the planner's read-only research children — see the nested self-dispatch paragraph below.)

| Consumer skill | When it re-dispatches |
|----------------|----------------------|
| `quality-pipeline` | Reviewer emits `AUTOPILOT_DEBUGGER` → quality-pipeline re-dispatches debugger as a separate session, then loops back |
| `dev-flow` | Planner emits `PARALLEL_DISPATCH` → dev-flow TaskCreates the subtasks with `blockedBy` chains |
| `ceo-agent` | Debugger emits `NEEDS_DOMAIN_EXPERT` → CEO maps the rationale to the appropriate voltagent role and dispatches |

The round-trip happens **in the skill**, never inside the agent's own session. This keeps each agent session bounded, its output contract deterministic, and the orchestration topology legible in the skill trace.

**Nested self-dispatch (Claude Code v2.1.172+) — scoped exception, never required.** The Handoff ENUMs (`PARALLEL_DISPATCH` / `SEQUENTIAL_DISPATCH`) remain the canonical cross-platform path: the agent reports, the calling skill dispatches. On Claude Code v2.1.172+, a subagent whose own `tools:` frontmatter includes `Agent` can spawn nested subagents (harness max depth 5) and MAY consume its own `PARALLEL_DISPATCH` / `SEQUENTIAL_DISPATCH` handoff in-session as an optimization — a general architectural pattern for a hypothetical executor-capable agent, NOT a grant to the planner, whose contract permanently forbids dispatching executors (research children only). Because this is never required, non-CC platforms need zero changes — they degrade to the skill-layer round-trip above. Today only the **planner** carries `Agent` in its allowlist, and only for read-only research children (see `planner.md` § Research Children); the reviewer and debugger remain terminal, so the invariant above holds for every verdict-producing agent. Review-integrity rules for any nested dispatch live in [`references/blind-dispatch.md`](../references/blind-dispatch.md) § Nested dispatch.

**autopilot nesting policy: depth ≤ 2** (main session → orchestrating agent → leaf). Same coordination-cost philosophy as the team skill's cap-3 — the harness's depth-5 ceiling is a limit, not a target. The context-offload motivation for nesting is fully served at depth 2; a leaf that needs to orchestrate further is a sign the skill-layer decomposition should be redone at depth 0, not deepened. Like cap-3, this is documentation policy, not a runtime gate.

> When the re-dispatch is reviewer- or auditor-role on the same target after a fix, the prompt MUST follow [`references/blind-dispatch.md`](../references/blind-dispatch.md) (outcome-blinding to prevent quality-gate self-bypass). First-pass / fixer / domain-expert handoff are explicitly out of scope.

## Tool permissions — no direct file patching

All three agents have `tools` frontmatter that excludes `Edit` and `Write`:

```yaml
tools: Read, Grep, Glob, Bash, WebSearch, WebFetch          # reviewer, debugger
tools: Read, Grep, Glob, Bash, WebSearch, WebFetch, Agent   # planner (research children only)
```

Claude Code enforces this allowlist. The agents **cannot patch source files via `Edit` / `Write`** even if something in their prompt tried to — this turns "methodology agents diagnose, caller skills orchestrate fixes" from a convention into a mechanical guarantee for the file-patching channel.

**Scope of the guarantee**: The allowlist prevents `Edit` / `Write` use. It does **not** sandbox `Bash`, which the agents retain for read-only diagnostics (`git log`, `docker logs`, `grep`, running test commands). Each agent's system prompt explicitly forbids Bash-side mutations (`rm`, `git commit`, `curl -X POST`, destructive DB commands, etc.). The prompt-level discipline plus `Edit` / `Write` mechanical denial together give you: methodology agents **read and reason**, caller skills **decide and apply**.

**Child-hop caveat (planner)**: a nested child's toolset comes from the *child's* agent type, not the parent's allowlist — a planner child dispatched as `general-purpose` would have Edit/Write. The planner contract therefore mandates `subagent_type: Explore` (read-only by construction) or an explicit read-only prompt preamble (`planner.md` § Research Children). For the child hop the guarantee is **convention-enforced, not mechanical**.

## Further reading

- Plan doc: `docs/plans/2026-04-12-methodology-agents-and-hooks.md` — full design, review loop history, rationale
- Individual agent spec: `reviewer.md` / `debugger.md` / `planner.md`
- Companion plugins: see `../README.md` § Recommended Companions
