# HANDOFF — `/l4 /l5` width fan-out (resume Phase 5)

**Written**: 2026-06-23 (for a post-context-clear resume)
**Branch**: `feat/l4-l5-dep-graph-fanout` @ `6d4ee29` (1 ahead of develop, **5 behind** — sync first)
**Project**: [`README.md`](README.md) · **Plan**: [`../../plans/2026-06-23-l4-l5-dep-graph-fanout.md`](../../../plans/2026-06-23-l4-l5-dep-graph-fanout.md)

## TL;DR — what to do next

1. `git checkout feat/l4-l5-dep-graph-fanout && git rebase develop` (pick up v2.21.1 baseRef fix,
   the dispatch-visibility matrix, and the **v2.22.0 qc-gate** — the pre-push gate is now LIVE, so
   this project's eventual merge will need a `QC-Verdict: PASS` trailer; see CLAUDE.md / finish-flow).
2. Run **Phase S0.a** — the cheapest go/no-go. It decides whether the rest of the project exists.

## Where this came from (don't re-litigate — it's settled)

`research-to-ship l4` → Phase 1 research (3 agents) + baseRef spike (shipped v2.21.1) + **2-round
Architect/Ops/Skeptic dialectic that CONVERGED → DESCOPED**. Settled decisions:

- **Edge-density width function is DEAD** (research killed it; the metric is span/antichain, not density).
- **Deterministic file-disjointness gate, NOT the LLM graph**, is the widen authorizer — but the
  dialectic found the naive form net-NEGATIVE (it certifies file-overlap while the dominant failure
  is *disjoint-file semantic coupling* → green stamp induces reviewer rubber-stamping). So:
  result-validating (post-commit actual-touched ⊄ declared) + shell-clamped (exit non-zero, not LLM
  prose) + **de-fanged** (reviewer contract must say "gate = files only, not behavior").
- **Fixed cap 3 default**; Tier-2 widens only file-provably-disjoint units.
- **The whole Tier-2 build is CONDITIONAL** on the S0 spike. Don't build P1–P3 speculatively.

## Phase 5 execution (per the plan's S0/S1/Phase-L)

| Step | Size | Gate | Action |
|------|------|------|--------|
| **S0.a** | S | **run FIRST (~1h)** | Sample the last ~50 L-size tasks (git log + `docs/projects/`). What fraction split into **≥4 file-disjoint units with non-trivial per-unit wall-clock**? **<~15–20% ⇒ Tier-2 is dead weight → skip to S1 and STOP.** Record the fraction + method. |
| **S0.b** | S | only if S0.a passes | Build `scripts/check-disjointness.sh` in **result-validating** form (post-commit: actual-touched ⊄ declared `Scope:` allowlist ⇒ exit non-zero). Measure its miss-rate on a **semantic-inclusive** sample (disjoint-file-but-coupled pairs, not just `git log --name-only`). If it certifies coupled pairs as "disjoint" at a rate that reaches depth-0 pre-stamped, or the sample is infeasible to label → **no-go on widening**, ship S1 only. |
| **S1** | S | ship-regardless | `check-disjointness.sh` as a file-hygiene guard + fixed-cap-3 docs + the **depth-0 reviewer carve-out** ("gate certifies files only, not behavior"). Valuable even at width-1. Denylist scoped to lockfiles + named build/config globs ONLY (regex can't own "generated"/"shared-type"). |
| **Phase L** | L | conditional on S0.a ∧ S0.b | Tier-2 dispatch + the round-1 structural debts: per-unit outcome table, **all-or-nothing merge-back**, N-agentId control-loop fan-out (branch namespace `unit-<id>-<run-id>`, parallel-kill trap — verify via setsid per memory `bash-int-pgroup-trap`), single-base-per-batch, merge-conflict→serial-collapse, Amdahl-as-cross-run-telemetry. |

## Preconditions already resolved (don't redo)

- **Planner allowlist source**: `autopilot:planner`'s six-element Task Prompt already emits **Scope**
  (exact file paths) + **Boundaries** (what NOT to touch). The checker consumes `Scope:`. No planner
  contract change needed.
- **Worktree base knobs** (v2.21.1, shipped): native foreman → `worktree.baseRef:"head"` setting
  (NOT a STEP-0 reset; that's now the portable fallback); `/l5` hetero impl → `dispatch-hetero.sh
  --base "$(git rev-parse HEAD)"` (separate mechanism). See `level-front-door.md`.
- **`/l5` hetero PARALLEL is CUT to BACKLOG** (weakest leg: base-correctness × engine-variance ×
  rarest task-supply). If anything ships, `/l4` homogeneous-only widen.

## Cross-cutting context (shipped this session, now on develop @ origin)

- **v2.21.1**: `worktree.baseRef` correction + dispatch-visibility matrix in `level-front-door.md`.
- **v2.22.0**: the **anti-skip qc-gate** (`.githooks/pre-push` + `resolve-qc-gate.sh` +
  `qc-gate-config.md`). **It is active** — any merge of THIS project to develop needs the reviewer
  to run and the merge commit to carry `QC-Verdict: PASS (reviewer <id>, <date>)`.

## Open questions for the user (surface, don't decide solo)

1. After S0.a returns: if the wide regime rarely fires, confirm "ship S1 guard only, stop" vs push on.
2. Is `/l5` parallel hetero worth ever building, or leave it in BACKLOG permanently?
