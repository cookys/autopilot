# Autopilot — Architecture & Design

> Part of [Autopilot](../README.md). Detail docs: [Skills](skills.md) · [Coexistence](coexistence.md) · [Configuration](configuration.md) · [Installation](installation.md) · [Architecture](architecture.md) · [Hooks](../hooks/README.md)

This page covers *why* Autopilot is built the way it is: the problem it solves, its design philosophy, the read-only methodology agents, recommended companions, and prior-art credits.

---

## The Problem

Claude Code on its own — even with `superpowers` if you've installed it — leaves several layers unaddressed:

- **Lifecycle management** — no task sizing, no project tracking, no session start/end discipline
- **Strategic decisions** — no multi-perspective debate, no dual-agent research
- **Quality gates** — no unified pipeline enforcing test → scan → completeness → review
- **Methodology discipline** — evidence-first debugging, test pyramid baselines, team allocation, performance profiling all need explicit frames
- **Self-improvement** — no knowledge capture, no retrospectives, no "what's next?" recommendations
- **Project-specific context** — no mechanism to inject your project's tools, conventions, and known gotchas

---

## Design Philosophy

**Why a plugin, not copy-paste skills?**
Copy-pasted skills drift within weeks. A plugin gives you a single source of truth — update once, everyone gets it via `/plugin update`.

**Why 27 skills + 22 hooks?**
v2.0 removed 4 skills (debug, test-strategy, team, profiling) that overlapped with `superpowers` skills, on the assumption that `superpowers` was always installed. v2.7.0 restores them as standalone fallbacks (with explicit `## Coexistence with Superpowers` sections in their bodies explaining the relationship) so autopilot works without `superpowers`. When `superpowers` IS installed, `.claude/dispatch-config.md` chains let orchestrators prefer the superpowers equivalent for runtime delegation; the autopilot skill stays in the catalog as the standalone fallback. v2.2 added `think-tank-dialectic` as a different tool (not an upgrade) for irreversible decisions. v2.5 added 14 hooks for runtime enforcement — discipline that was previously only in markdown rules. Hooks and skills serve different layers: skills set rules at conversation time; hooks enforce them at tool-call time.

**Why `!`command`` injection, not config files?**
In the Claude Code world, "configuration" is natural language. A markdown file read at invocation time is more expressive than YAML, requires no schema, and degrades gracefully when absent.

**How does it work with Superpowers?**

Autopilot is standalone-capable and coexists with Superpowers when it's installed: autopilot's orchestrators delegate tactical execution to Superpowers via `.claude/dispatch-config.md` chains, and fall through to autopilot's own fallback skills when it isn't. (Historically — v2.0–v2.6 — this was「rule-setter / executor」; since v2.7.0 autopilot runs fully standalone too.) They coexist through a layered triggering design:

```
Layer 1 — CLAUDE.md routing table (project-level)
  "新功能規劃 → autopilot:dev-flow"
  "技術調研 → autopilot:survey"
  Maps project context to skills. Written by the user.

Layer 2 — using-superpowers skill (session-level)
  "Check skills BEFORE any response. Even 1% chance = invoke."
  This is what makes skill triggering work. Without it,
  the model answers directly and never checks skills.

Layer 3 — Skill description (skill-level)
  "Use when: 'compare X with Y', 'check X against Y'..."
  User-intent trigger phrases help the model match
  the user's words to the right skill.
```

All three layers must work together. Layer 2 (Superpowers' `using-superpowers`) creates the *habit* of checking skills; Layer 1 (CLAUDE.md) provides project-specific routing; Layer 3 (descriptions) provides the semantic match. Autopilot never dispatches to or wraps Superpowers skills — they share the session, not a call chain.

**Why do descriptions use quoted trigger phrases?**

Skill descriptions serve Layer 3 — they're the last-mile match between user intent and skill selection. We write them in user-intent language (`"what should I work on"`, `"get it done"`, `"let's debate this"`) rather than internal mechanics (`"global work recommender"`, `"autonomous execution mode"`) because the model matches user messages against descriptions. The closer the description mirrors what users actually say, the more reliable the trigger.

---

## Methodology Agents

Autopilot ships **three read-only methodology agents** (v2.4.0) that carry Three Red Lines discipline into agent-level execution. Autopilot skills dispatch them automatically; you rarely invoke them directly.

| Agent | Purpose | Model | Dispatched by |
|-------|---------|-------|---------------|
| **`autopilot:reviewer`** | Pre-commit / pre-merge review, security audit, plan critique. Severity-tiered findings with `file:line` citations and `✅ Verified Clean` section | opus | `quality-pipeline`, `ceo-agent`, `finish-flow` |
| **`autopilot:debugger`** | Evidence-first root-cause analysis. 5-phase methodology with PUA trigger on 2+ failures. Produces `Proposed Fix` as diff, never applies patches | opus | `quality-pipeline` (round-trip), `ceo-agent`, `dev-flow` |
| **`autopilot:planner`** | Six-element Task Prompt decomposition for L-size work (goal / scope / input / output / acceptance / boundaries). Cannot write code | sonnet | `dev-flow`, `think-tank` |

All three are **physically read-only** — their `tools` frontmatter excludes `Edit` and `Write`, so Claude Code mechanically prevents them from patching files. They produce findings, proposals, or plans, and hand off to the calling skill via a unified `### Handoff` section with an enum-based `Next consumer` field.

The three agents carry autopilot's **Three Red Lines** into the agent layer:

1. **Closure** — every finding has impact + fix direction, no open-ended output
2. **Fact-driven** — every claim cites `file_path:line_number`; "probably" / "likely" are violations
3. **Exhaustiveness** — full checklists run; clean items explicitly listed; silent omission is a violation

See [`agents/README.md`](../agents/README.md) for dispatch boundary, unified Output Contract, enum grammar, and the "autopilot methodology / role / project-specific" layer cake.

---

## Engine Layer

Autopilot's engine layer is the host-neutral execution core underneath the prose skills. Skills still define the methodology and decision rules; the engine layer makes the repeatable dispatch/review/harness mechanics executable and testable.

| Module | Responsibility |
|--------|----------------|
| [`bin/autopilot.js`](../bin/autopilot.js) | Public CLI front door: `dispatch review`, `engine review-loop`, `engine implement-review`, and `harness report`. |
| [`src/engine/`](../src/engine/) | `AutopilotEngine` orchestration for roster resolution, read-only review dispatch, heterogeneous implementation dispatch, repair-loop prompting, and immutable-base verification. |
| [`src/runners/`](../src/runners/) | Thin JS wrappers around artifact-verified shell dispatchers (`dispatch-hetero.sh`, `dispatch-review.sh`, `resolve-review-loop.sh`) with schema validation and parse-fail visibility. |
| [`src/harness/`](../src/harness/) | Harness capability state, stale/attention reporting, and read-only capability CLI surfaces. |
| [`src/hooks/`](../src/hooks/) | Host-neutral hook normalizers and handlers used by Claude wrappers and Codex hook probes. |

The central DI contract is `new AutopilotEngine({ reviewLoopResolver, reviewDispatcher, implementationDispatcher, diffProvider, repairPromptWriter, clock, cwd })`. Production uses the shell-backed defaults; tests inject fakes at these seams so loop behavior can be verified without calling live engines.

`engine implement-review` is the canonical `/l5` implementation loop:

1. Resolve roster with scorecard-aware `resolve-review-loop.sh --check-scorecard`.
2. Enforce reviewer qualification by default at the CLI boundary.
3. Dispatch implementation through `dispatch-hetero.sh` with an immutable full-SHA `--base`.
4. Review the cumulative `<base>..<latest commit>` diff as text.
5. If the reviewer returns `FIX-THEN-SHIP`, write a repair prompt and repeat on a per-round branch named `<branch>-repair-rN-<sha7>`.
6. Return `converged`, `non_converged`, or `blocked`; CLI exit 0 is reserved for `converged`.

Layering rule: the engine wraps the artifact-verified shell dispatchers; it does not replace their git-artifact rails. Shell owns process isolation, worktree creation, wrapper commits, raw logs, and runner-specific invocation. JS owns orchestration, schema validation, immutable endpoint checks, and deterministic ledger shape.

---

## Recommended Companions

Autopilot is **self-sufficient for methodology and lifecycle** — you get all 27 skills + 3 methodology agents when you install autopilot alone. The assumed ecosystem baseline is cookys's own `autopilot` + `codeforge` + `mnemos` trio (standalone from third-party plugins), not a third-party stack. For **role specialization**, autopilot is out of scope and expects you to bring your own role-agent plugin if you want one (a voltagent-style catalog works if installed).

Autopilot and role-specialist plugins are **orthogonal by design**:

| Layer | What it does | Where to look |
|-------|-------------|---------------|
| **Methodology** | Three Red Lines discipline, evidence-first debugging, Seven-Element dispatch + six-element Planner decomposition contract, lifecycle orchestration | autopilot (this plugin) |
| **Role** | Language experts, infra specialists, domain experts (80+ agents) | a role-specialist plugin you bring (optional) |
| **Project** | Your tech stack's pitfalls, team conventions, domain-specific agents | `<project>/.claude/agents/` |

**Dispatch boundary:**

- Going through an **autopilot skill** (`quality-pipeline`, `dev-flow`, `ceo-agent`) auto-dispatches autopilot methodology agents — `:debugger` and `:planner` named directly by their consumer skills, reviewer selected via the `.claude/dispatch-config.md` `## Code Review` chain (defaults to `autopilot:reviewer` when chain unset or no entry dispatchable) — to carry methodology discipline into every invocation
- **Directly invoking an agent** via the `Agent` tool — a role-specialist agent you've installed may be the better primary choice when domain depth matters more than tooling uniformity

Two workflows, two dispatch paths, zero overlap in practice.

Autopilot does **not** runtime-detect role-specialist plugins. `:debugger` and `:planner` are named directly by their consumer skills; the reviewer is selected via the `.claude/dispatch-config.md` `## Code Review` chain with `autopilot:reviewer` as the default fallback when the chain is unset or no chain entry is dispatchable. If you want a reviewer not in the chain for a one-off task, invoke it explicitly via the `Agent` tool — that is a user-layer choice on top of the chain mechanism.

---

## Inspired By

- **Task-tree engine prior art (v2.16.0)** — the externalized-state substrate and its guardrails absorb published lessons rather than reinventing failures: append-only event log + derived index over read-modify-write node files (Steve Yegge's [Beads](https://github.com/steveyegge/beads) postmortem; TaskMaster schema/concurrency incident reports — community issue-tracker reports surveyed 2026-06-12; no single canonical URL recorded at survey time), per-event `schema_version` with lazy migrations ([LangGraph](https://github.com/langchain-ai/langgraph)'s versioned-state lesson; [Temporal](https://temporal.io)'s history-evolvability model), and cheap cross-family judge panels over a single large judge (the PoLL result — [Verga et al. 2024, "Replacing Judges with Juries"](https://arxiv.org/abs/2404.18796)). All quantitative thresholds from these sources are treated as factory defaults pending local calibration, never as justification.
- **[gstack](https://github.com/garrytan/gstack)** — Garry Tan's skill suite for Claude Code. The CEO agent's cognitive patterns (Bezos doors, Munger inversion, Jobs subtraction), Boil the Lake completeness principle, and scope mode system are adapted from gstack's `plan-ceo-review` skill.
- **[Council of High Intelligence](https://github.com/0xNyk/council-of-high-intelligence)** — 0xNyk's 18-thinker multi-persona deliberation skill. The `think-tank-dialectic` skill's enforcement mechanisms (Dissent Quota, Counterfactual Trigger at >70%, Problem Restate Gate, Minority Report as first-class verdict section, Epistemic Diversity Scorecard) are adapted from Council's 7-step protocol and agent frontmatter conventions. The key meta-insight — *every thinking style must carry its own fail-safe* — comes from observing that 100% of Council's 18 agents have a `Grounding Protocol` section with self-constraining hard rules.
- **[Agora](https://github.com/geekjourneyx/agora)** — Professor Li's 6-room, 31-thinker extension of Council. The `think-tank-dialectic` skill's Hegelian Arc structure (Thesis → Antithesis → Synthesis with forced non-compromise synthesis proposal), Adaptive Depth Gate, Tacit Knowledge Extraction protocol (Polanyi), and "different tool, not better tool" framing are adapted from Agora's 8-step deliberation protocol and the `/forge` engineering room's verdict template.
- **[my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam)** — NYCU-Chung's 12-agent + 15-hook engineering team plugin for Claude Code. The `v2.4.0` methodology agents (`reviewer` / `debugger` / `planner`) absorb the Three Red Lines discipline (closure / fact-driven / exhaustiveness), six-element Task Prompt contract, evidence-first debug methodology, PUA stress-mode trigger, and physical tool-restriction pattern (read-only methodology agents) from devteam's P7/P9/P10 framework. The `v2.5.0` hooks layer absorbs 14 of devteam's 15 hooks (8 default-on Tier A + 6 opt-in Tier B) with Ship A review adjustments: anchored branch-protection regex (C1 fix), unified secret-patterns module (mi1 fix), cost-tracker opt-out, and 8/8 Tier A testing coverage. The layered split — autopilot owns methodology, voltagent owns role specialization — is a deliberate divergence from devteam's all-in-one approach to stay orthogonal to the voltagent role-agent ecosystem.
- **[claude-powerloop-plugin](https://github.com/elct9620/claude-powerloop-plugin)** — Aotokitsuruya's cron-loop Plan/Execute/Review/Sample plugin for Claude Code (Apache-2.0). The `references/blind-dispatch.md` outcome-blinding principle (round-2+ reviewer re-dispatch must strip prior verdicts to prevent quality-gate self-bypass) and the leaky-vs-blind prompt example pair are adapted from powerloop's `skills/powerloop/examples/blind-dispatch.md`. powerloop applies the discipline in a multi-session cron loop; autopilot scopes it to session-driven re-dispatch under `quality-pipeline` Re-review Loop and `audit` Phase 4 verification.
- **[superpowers](https://github.com/obra/superpowers)** — obra's (Jesse Vincent) agentic-skills framework that autopilot coexists with. `scripts/check-dispatch-suppression.sh` (the anti-gaming dispatch-prompt linter — a dispatcher must not coach the reviewer to suppress or pre-rate a finding) and `references/plan-template.md`'s verbatim **Global Constraints** propagation are adapted from superpowers v6's `subagent-driven-development` anti-gaming reviewer contract and `writing-plans` global-constraint block (surveyed 2026-06-24 against v6.0.3).
