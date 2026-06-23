# Project — `/l4 /l5` width fan-out: gating spike + disjointness guard

**Created**: 2026-06-23
**Branch**: `feat/l4-l5-dep-graph-fanout`
**Plan**: [`docs/plans/2026-06-23-l4-l5-dep-graph-fanout.md`](../../plans/2026-06-23-l4-l5-dep-graph-fanout.md)
**Origin**: `research-to-ship l4` — Phase 1 research (3 agents) + baseRef spike (v2.21.1, shipped)
+ 2-round Architect/Ops/Skeptic dialectic (**CONVERGED → DESCOPED**).
**Status**: bootstrapped; S0.a (task-supply cut) is the next action and gates everything below.

## OKR

**Objective**: decide — cheaply and falsifiably — whether `/l4 /l5` should ever widen past
width-1, and ship the safety guard that's valuable regardless of that answer.

**Key results**
- KR1 — S0.a (task-supply) measured: fraction of recent L-tasks that split into ≥4
  file-disjoint units with non-trivial per-unit wall-clock. Gate: <~15–20% ⇒ Tier-2 is dead
  weight, stop after S1.
- KR2 — S0.b (semantic-miss) measured: does the file-set checker certify "disjoint" for
  semantically-coupled disjoint-file pairs at a rate that would reach depth-0 pre-stamped?
  (Or: is the labelled sample infeasible to build cheaply — itself a no-go.)
- KR3 — S1 guard shipped: `check-disjointness.sh` as a **result-validating** allowlist
  enforcer (post-commit, exit non-zero, artifact-verified) + fixed-cap-3 docs + the depth-0
  reviewer **carve-out** ("gate certifies files only, not behavior"). Improves the existing
  width-1 path independent of S0.
- KR4 (conditional on KR1 ∧ KR2) — Phase L: Tier-2 fan-out with per-unit outcome table,
  all-or-nothing merge-back, control-loop fan-out (N agentIds, branch namespace, parallel-kill
  trap), single-base-per-batch, merge-conflict→serial-collapse, Amdahl-as-cross-run-telemetry.

## Phases (mirror the plan)

| Phase | Size | Gate | What |
|-------|------|------|------|
| **S0.a** | S | **run FIRST (~1h)** | Task-supply existence cut. Fail ⇒ skip to S1 and stop. |
| **S0.b** | S | only if S0.a passes | Build result-validating `check-disjointness.sh`; measure semantic-inclusive miss-rate. |
| **S1** | S | ship-regardless | The guard + cap-3 docs + reviewer carve-out. Width-1 path unchanged. |
| **Phase L** | L | **conditional** on S0.a ∧ S0.b | Tier-2 dispatch (the round-1 structural debts, itemized in the plan). |

## Success criteria

1. S0.a fraction recorded with the sampling method (auditable, not vibes).
2. S0.b returns a measured miss-rate **or** an explicit "semantic sample infeasible ⇒ no-go".
3. S1 guard: a unit whose actual commit touches a file outside its declared `Scope:` allowlist
   → checker exits non-zero (verified from git artifacts, not agent self-report).
4. No Tier-2 dispatch code authored before S0.a ∧ S0.b both pass (the descope held).
5. Depth-0 reviewer contract carries the files-only carve-out wherever the gate is referenced.

## Precondition (resolved)

`autopilot:planner` already emits the per-unit allowlist via its six-element Task Prompt —
**Scope** (element 2, exact file paths) + **Boundaries** (element 6). The checker consumes
`Scope:`; no planner contract change needed.

## Decision log

- **DESCOPE (dialectic, 2026-06-23)** — the original "fix cap = f(edge-density)" hypothesis was
  killed by research; the first redesign (deterministic file-disjointness gate) was then found
  net-negative on the dominant failure mode (disjoint-file semantic coupling the file-checker
  can't see → green stamp induces reviewer rubber-stamping). Converged: measure existence +
  safety first; ship only the artifact-verified guard unconditionally; gate the fan-out build.
- **baseRef spike (v2.21.1, `5becac4`)** — worktree-base precondition resolved ahead of this
  project (`worktree.baseRef:"head"` + hetero `--base`).
