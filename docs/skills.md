# Autopilot — Skills Catalog

> Part of [Autopilot](../README.md). Detail docs: [Skills](skills.md) · [Coexistence](coexistence.md) · [Configuration](configuration.md) · [Installation](installation.md) · [Architecture](architecture.md) · [Hooks](../hooks/README.md)

The full catalog of all 24 skills, the three primary cognitive modes, how skills compose, and the decision table for which to reach for.

---

## The Solution

Autopilot ships **24 skills** covering lifecycle orchestration, strategic intelligence, methodology, and quality gates. Works standalone; coexists with the optional `superpowers` plugin (see [Superpowers Coexistence](coexistence.md)).

| Skill | What It Does | Coexists with |
|-------|-------------|---------------|
| **dev-flow** | Sizes tasks (S/L/H), sets session rules for config injection and quality gates, manages project tracking | `superpowers:writing-plans` (planning) |
| **survey** | Dual-agent research (researcher + skeptic) | — (no equivalent) |
| **brainstorm** | Pre-code Socratic design exploration — discovers options when none exist yet, surfaces 2-3 approaches, gates implementation until a design is approved | `superpowers:brainstorming` (internalized) |
| **think-tank** | 6-role debate for strategic decisions | `superpowers:brainstorming` (different level — requirements exploration) |
| **think-tank-dialectic** | Hegelian dialectic for irreversible / high-stakes decisions with LOW consensus. 4 职能 + 2 adversarial roles (Popper falsifier + Munger inverter). NOT a "better think-tank" — a different tool for a different situation | — (no equivalent) |
| **ceo-agent** | Autonomous execution with CEO-level judgment | — (no equivalent) |
| **l3 / l4 / l5** | Terse CEO front-doors that pre-fill the four startup questions and set execution posture: `/l3` runs inline, `/l4` dispatches one background worktree-isolated `sub-orchestrator` foreman with a depth-0 control loop + authoritative qc, `/l5` adds a heterogeneous (agy/Gemini) implementer | — (no equivalent) |
| **research-to-ship** | Pinned participatory pipeline: research best-practice → plan → dialectic loop review → project → dev-flow, with a human gate between each phase. Delegates to survey/think-tank-dialectic/project-lifecycle/dev-flow | — (no equivalent) |
| **quality-pipeline** | Unified quality gate: test → scan → completeness → review | `superpowers:verification-before-completion` (partial) |
| **finish-flow** | Size-aware closing forcing function — TaskCreates discrete L-5 / H-9 / Fix / S-Lite sub-tasks so nothing gets silently compressed | — (no equivalent) |
| **doc-sync** | Doc↔code drift detection, two layers: a **deterministic gate** (reliable, gate-able in CI — baseline `scripts/doc-drift-gate.py` does links + code-fences; projects extend with version/CLI-surface/roadmap checks) + an **LLM sweep** for discovery (scoped per-diff / full whole-repo; non-deterministic, never loop-to-zero). Mechanizable findings demote into the gate. Wired into finish-flow L-5.4 | — (no equivalent) |
| **project-lifecycle** | Plan → bootstrap → structure → archive | `superpowers:finishing-a-development-branch` (partial) |
| **onboard** | Scaffold a consuming repo's `.claude/*-config.md` DI from detected reality — `scripts/project-detect.js` (mechanical facts) + `scripts/scaffold-config.js` (fills the config set, autopilot-only chains) then the skill enriches the judgment configs (skill-routing, doc-drift domains, security surfaces). The "fresh repo → autopilot-calibrated" bridge | — (no equivalent) |
| **learn** | Auto-records knowledge from failures; knowledge health audit | — (no equivalent) |
| **retro** | Engineering retrospective from git history | — (no equivalent) |
| **distill** | Distills recurring procedures/corrections from your conversation history into *your own* personal skills (routed to a private `@skills-dir` pack / project dirs, never into autopilot) | — (no equivalent) |
| **next** | Scan all work sources, recommend highest-priority task | — (no equivalent) |
| **audit** | Systematic comparison between implementations | — (no equivalent) |
| **debug** | Evidence-first debugging methodology (tool → log → code) with Three Red Lines | `superpowers:systematic-debugging` (broader hypothesis-driven framing) |
| **test-strategy** | Test pyramid, baseline 守則, failure investigation funnel — **not** TDD (orthogonal scope) | `superpowers:test-driven-development` (coding loop, complementary not equivalent) |
| **team** | Team allocation decisions: when to組隊, role selection, dependency analysis | `superpowers:dispatching-parallel-agents` (dispatch mechanism — the verb to autopilot:team's noun) |
| **profiling** | Evidence-first performance profiling (only methodology entry point in the ecosystem) | — (no superpowers equivalent) |

---

### Three Modes of Operation

Autopilot provides three distinct cognitive modes for different situations:

**`dev-flow` — Guided Development (default)**

The entry point for all development tasks. Evaluates task size and routes accordingly:

```
You: "Add WebSocket compression"

Claude (with dev-flow):
  1. Size assessment: L (crosses network + protocol + client modules)
  2. → Creates plan, project directory, feature branch
  3. → Implements phase by phase, quality gate each phase
  4. → Archives project on completion

Claude (without dev-flow):
  → Starts grep-ing the codebase immediately
  → No plan, no phases, no quality gates
```

dev-flow also handles the session lifecycle — health checks on startup, knowledge review, goal alignment on context continuation. You don't invoke these separately; dev-flow absorbs them.

**`ceo-agent` — Autonomous Execution**

When you want outcomes, not involvement. The agent becomes CEO; you become the Board.

```
You: "CEO mode. Handle the reconnect system. Level 3, you decide everything."

CEO startup:
  1. OKR — concrete success criteria (not vague "make it work")
  2. Involvement level — how often to report (every step / phase / just results)
  3. Scope mode — Expand / Selective / Hold / Reduce
  4. No-go zones — what's absolutely off-limits

Then: autonomous execution within DOA (Delegation of Authority)
```

The CEO agent applies 10 cognitive patterns from great CEOs (Bezos's two-way doors, Munger's inversion reflex, Jobs's focus as subtraction) and follows the Boil the Lake principle — AI makes completeness nearly free, so always choose the complete implementation over shortcuts.

CEO cannot self-audit. Like corporate governance, quality-pipeline and code-review run independently.

**`think-tank` — Multi-Perspective Debate**

For strategic decisions where a single perspective isn't enough. 6 roles debate in parallel:

```
You: "Should we rewrite the auth system or patch it?"

Think Tank assembles:
  - CTO (technical feasibility)
  - Product Director (user impact)
  - QA Lead (risk assessment)
  - Security Architect (threat model)
  - Customer Advocate (user experience)
  - Operations (deployment/maintenance)

Output: Decision Brief with consensus, dissenting views, and recommendation
```

### L3 / L4 / L5 — CEO Front-Door Ladder

`/l3`, `/l4`, `/l5` are **terse front-doors into `ceo-agent`**. Each pre-fills the four CEO startup questions — involvement = just-results (full autonomy, notify on done), scope = Hold, no-go = none — so a single line ships the goal without the startup Q&A. They differ only in **where the implementation runs**; the depth-0 control loop and every quality gate are identical, nothing is skipped.

| Level | Command | Where it runs | Reach for it when |
|-------|---------|---------------|-------------------|
| **L3** | `/l3 <goal>` | **Inline** on this thread. The CEO executes the goal itself, escalating only at the DOA boundary. | You want full autonomy but want to watch it happen on the current thread. (Also the `--solo` fallback engine for L4/L5.) |
| **L4** | `/l4 <goal>` | **One background, worktree-isolated foreman** (a sub-orchestrator at depth 1) runs dev-flow unattended and returns a verdict. The CEO keeps the depth-0 control loop and the **authoritative qc** — a fan-out of ≥3 adversarial reviewers over the branch diff, *not* a CEO self-read. | A long autonomous run you'd rather offload — your context stays clean; merge-back and worktree GC are owned at depth 0. |
| **L5** | `/l5 <goal>` | Identical to L4, but the **implementer is leaf-dispatched to a heterogeneous engine** (agy / Gemini via `dispatch-hetero.sh`), and review can run on a **decorrelated** engine (default `gpt-5.5`). The engine roster is **data** (`.claude/review-loop-config.md`), not a hand-typed prompt. | Cost-arbitrage, or you want a decorrelated second engine doing the mechanical coding and a different vendor family reviewing it. |

**Examples**

```
/l3 fix the flaky reconnect test, you decide          # inline, full autonomy
/l4 ship the WebSocket reconnect system                # offload to a background foreman
/l4 --expand harden the auth layer -x payments         # scope=Expand, payments off-limits
/l5 migrate the config loader to the new schema        # hetero implementer + decorrelated review
```

**Override flags** (all three levels):

- `--expand` → scope = Expand (default is Hold — touch only what the goal names).
- `-x <csv>` → no-go zones, e.g. `-x payments,auth` (default none).
- `--solo` (L4 / L5 only) → fall back to the L3 inline engine. This is also the automatic degradation when the foreman returns `precondition_failed`.

The escalation is **inline → offloaded → offloaded + decorrelated engine**. Start at L3; reach for L4 when you want it off your thread; reach for L5 when a second engine adds cost-arbitrage or decorrelation value. For the depth-0 control loop, outcome→action table, and run-summary ledger, see the [ceo-agent front-door semantics](../skills/ceo-agent/references/level-front-door.md). For the L5 roster/loop config, see [`review-loop-config.md`](../project-config-template/review-loop-config.md).

### How They Work Together

```
 user task
    │
    ▼
 dev-flow ──────────────────────────────────────────────┐
    │                                                    │
    ├─ S (small): implement → quality-pipeline → commit   │
    │                                                    │
    └─ L (large): project-lifecycle (bootstrap)          │
         │         → per-phase implement                 │
         │         → quality-pipeline per phase           │
         │         → project-lifecycle (archive)          │
         │                                               │
         ├─ needs research? ──→ survey                   │
         ├─ strategic decision? ──→ think-tank            │
         ├─ user says "handle it"? ──→ ceo-agent         │
         │                                               │
         └─ session end ──→ learn (capture knowledge)    │
                            retro (periodic review)      │
                                                         │
 what's next? ──→ next (scan → rank → recommend)         │
                                                         │
 ◄───────────────────────────────────────────────────────┘
```

### Skill Boundaries

| Decision Type | Use This |
|--------------|----------|
| Technical choice (X library vs Y) | `survey` — external research with dual perspective |
| Strategic choice (should we? how big? what first?) | `think-tank` — internal multi-role debate |
| User wants outcome, not involvement | `ceo-agent` — autonomous execution |
| User wants to participate | `dev-flow` — guided workflow with checkpoints |
