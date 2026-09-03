# Foreman cost discipline (v2.35.15)

**Branch**: `feat/v2.35.15-foreman-cost-discipline` · **Plan**: [`docs/plans/2026-09-04-foreman-cost-discipline.md`](../../../plans/2026-09-04-foreman-cost-discipline.md) · **Status**: ✅ Shipped in v2.35.15 — merged as `72dfa052`

## Project Goal

> **Final goal**: the foreman ironlaws (no polling, Bash ≤40, no Monitor, one deliverable per life) are enforced at PreToolUse time for l4/l5/l6 subagents, and the three cost hooks are on by default with documented opt-outs.
> **Success criteria**: (1) `hooks/tests/foreman-guard.test.sh` covers allow/deny/mode paths and the full suite is green; (2) `check-hook-inventory.js` reports 14 default-on / 13 opt-in and the README/plugin.json/badges agree; (3) l4/l5/l6 + front-door carry the lifecycle + read-list rule and the profiles hash chain is re-pinned (preflight 8/8); (4) cuda receives the report with version + opt-out knobs.
> **Scope boundary**: IN — D1–D5 of the plan. OUT — subagent context measurement, users' `[1m]` settings, fleet-wide broadcast (operator: no).

## Scope completeness audit (L-1.5)

| Dimension | Coverage |
|---|---|
| Source + tests | P0: new hook + 3 hooks default-on + hooks.json/manifest/multiplexer + tests (new + updated) |
| User-facing docs | P2: hooks/README tiers, settings.example, ironlaw-to-gate-map, CHANGELOG (behaviour change named) |
| Skill prose | P1: l4/l5/l6 SKILL.md + level-front-door.md lifecycle + read-list rule; profiles hash repin |
| Version | 2.35.15, hook-count 27 / opt-in 13 |
| Migration | opt-outs documented; no data migration |
| Dependents | codex mirror sync; check-hook-inventory test counts |
| Dogfood | real hook with marker + agent_id payload on this box |

**User-stated requirements**: 六項全做（1+2, 3, 4, 5+6）; 不廣播只回 cuda.

## Skill routing (L-1.6)
No `.claude/skill-routing.md`; dev-flow invoked; `profiles-hash-repin` (personal skill) applies to P1.

## Progress

| Phase | Status | Commit |
|---|---|---|
| P0 foreman-guard hook + three hooks default-on + tests | done | `6d69ef24` + review rounds `f202bc91` `9e408d48` `32dcb36b` |
| P1 lifecycle + read-list prose (l4/l5/l6, front-door); no hash repin needed (inventory pins only ceo-agent/dev-flow) | done | `5351f1c1` |
| P2 docs, CHANGELOG, version 2.35.15, cuda report | done | `17712304`, report after push |
| L-5 finish-flow | done (MiniMax SHIP; sol 3 rounds; suite 311 green) | `72dfa052` |
