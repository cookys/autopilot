# Nested-dispatch integration (capability-gated)

> **Status**: In progress
> **Branch**: `feat/nested-dispatch-integration` (off develop, carries cherry-picked `dd1676b` BACKLOG entry)
> **Origin**: docs/BACKLOG.md "Nested subagent (depth=5) integration" — both triggers fired 2026-06-11 (CC v2.1.172 changelog entry + nest-probe green). Escalated S→L by the S-scope-gate (4 modules touched: references/, agents/, skills/quality-pipeline/, docs/).
> **Mode**: CEO (involvement: results; scope: Hold; no-go: main branch, fix/scope-creep-gate-forcing-function work)

## OKR

Land Claude Code nested-subagent (v2.1.172, depth ≤ 5) support in autopilot **without breaking multi-agent portability**:

- KR1: Handoff ENUMs remain the canonical cross-platform dispatch path; nested self-dispatch documented as optional CC-only optimization. Non-CC platforms require zero changes.
- KR2: Blind-dispatch integrity holds at every nesting depth — context-based invariant ("verdict dispatch originates only from depth 0"), not round-based.
- KR3: Planner gains read-only research children (frontmatter + body contract + synced bodies) with no self-contradiction in its prompt.
- KR4: depth ≤ 2 policy stated once (agents/README.md Orchestration) and referenced elsewhere.
- KR5: validate.sh green, agent-body sync clean, CHANGELOG + version mirrors + INDEX consistent (preflight-release green).

## Evidence base

- CC v2.1.172 changelog: "Sub-agents can now spawn their own sub-agents (up to 5 levels deep)".
- Spikes (2026-06-11, binary 2.1.172): explicit-grant probe (`.claude/agents/nest-probe.md`, `tools: Read, Agent, Task`) → parent got `Agent`, child spawned OK, child had `Agent` not `Task`; default-grant probe (general-purpose, no frontmatter) → `AGENT:yes TASK:no`. Negative on v2.1.170 (grants stripped).
- 3-lens validation team (2026-06-11): A portability/architecture, B blind-dispatch safety, C planner feasibility. Verdict: PROCEED MODIFIED, no 🔴. Full findings in session transcript; key deltas folded into phases below.

## Phases

- **P1 — Project setup**: branch, project dir, INDEX, tasks. ✅
- **P2 — Cross-platform docs**:
  - `references/multi-agent-portability.md` §7: extend intro enumeration (+nested dispatch), add table row (CC v2.1.172+, spike evidence, others ❌ unverified-by-absence).
  - `agents/README.md` "Orchestration" section: scoped exception paragraph (nested self-dispatch when `tools:` includes `Agent`; none shipped today except planner after P3) + **depth ≤ 2 policy (canonical home)**.
- **P3 — Blind-dispatch hardening**:
  - `references/blind-dispatch.md`: new "Nested dispatch" section — context-based invariant, allowed/forbidden table (cross-round reviewer self-re-dispatch ❌; fixer→verdict-child ❌; fixer→fix-children ✅ with risk-counter report-up; reviewer evidence-gatherers ⚠ future-only with non-delegable Verified Clean), three all-depth clauses (verdict-from-depth-0, no round meta-signal, round-delta stays at depth 0).
  - `agents/reviewer.md`: extend "Never call another agent" red line with nested-dispatch sentence.
  - `skills/quality-pipeline/references/code-review.md`: one-sentence depth clause in "Re-review dispatch is blind" paragraph.
- **P4 — Planner research children**:
  - `agents/planner.md` frontmatter: `tools: …, Agent`.
  - Body: narrow "do not dispatch" bullets to executor/fixer/reviewer; add "Research Children" section (Explore-type read-only children, no grandchildren, fact re-verification, conditional "if Agent tool available" wording for OpenCode shared body).
  - `agents/README.md` tool-permissions block: planner exception + child-hop guarantee is conventional not mechanical.
  - `./scripts/sync-agent-bodies.sh` ripple (pre-commit enforces).
- **P5 — Bookkeeping**: BACKLOG entry → resolved (triggers MET), CHANGELOG v2.14.0, `scripts/sync-version.js`, memory refresh.
- **L-5 — finish-flow**: quality gate (independent review), merge develop --no-ff, preflight-release, learn, archive.

## Scope boundary (L-1.5 audit)

| Dimension | In scope? | Where |
|-----------|-----------|-------|
| Source (scripts/hooks) | ❌ none — docs + agent prompts only | — |
| Tests | ✅ `scripts/validate.sh` + `sync-agent-bodies.sh --check` | L-5 |
| Docs | ✅ portability §7, agents/README, blind-dispatch, code-review | P2/P3 |
| Agent contracts | ✅ planner.md (frontmatter+body), reviewer.md (1 line) | P3/P4 |
| CHANGELOG / version mirrors | ✅ v2.14.0 via sync-version.js | P5 |
| Consumers (OpenCode/agy) | ✅ body sync; agy frontmatter-import spike noted in BACKLOG | P4/P5 |
| Migration | ❌ none (additive docs/contract) | — |
| Dogfood | ✅ spikes already run; reviewer dispatch in L-5 exercises contracts | L-5 |
| Credit / attribution | ❌ no external design absorbed (CC official feature) | — |

**Explicitly out of scope**: reviewer/debugger Agent opt-in (deferred — blind-dispatch coupling); team SKILL edits (mirror-drift hazard, depth policy lives in agents/README); any hook/runtime enforcement of nesting rules (contract-only today); `_bodies/*.body.md` surfacing as dispatchable agents with "All tools" (pre-existing; new BACKLOG line in P5).

## Decision log (CEO)

- Branch off develop + cherry-pick dd1676b (BACKLOG entry is part of this work; fix branch stays untangled).
- S→L escalation per S-scope-gate indicator 2 (4 modules).
- Adopted validator B's context-based invariant over the original round-based rule (closes fixer→verdict-child hole).
- Adopted validator A's single-canonical-home ruling for depth ≤ 2 (agents/README.md Orchestration).
- Adopted validator C's 4-part planner change; gate 0 (explicit grant works on 2.1.172) already satisfied by the morning nest-probe run.
- Version: minor bump v2.14.0 (planner capability change, not a pure docs patch).
