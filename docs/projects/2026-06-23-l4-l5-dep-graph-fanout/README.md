# Project — `/l4 /l5` width fan-out: gating spike + disjointness guard

**Created**: 2026-06-23
**Branch**: `feat/l4-l5-dep-graph-fanout`
**Plan**: [`docs/plans/2026-06-23-l4-l5-dep-graph-fanout.md`](../../plans/2026-06-23-l4-l5-dep-graph-fanout.md)
**Origin**: `research-to-ship l4` — Phase 1 research (3 agents) + baseRef spike (v2.21.1, shipped)
+ 2-round Architect/Ops/Skeptic dialectic (**CONVERGED → DESCOPED**).
**Status**: **S0.a REOPENED 2026-06-23.** Autopilot-only read was 9–13% (→ would FAIL the gate),
but autopilot is a biased sample (single-threaded plugin/docs repo). A portable fleet probe was
built (`scripts/measure-task-width.sh` + `task-width-fleet.sh` + `task-width-ingest.py`); first
cross-repo run shows **measurable repos (real feature-merge history) mostly CLEAR the gate at
depth-2 (autopilot 42%, cado-nfs 46%, codeforge 75%)** — descope no longer safe to assume. n is
still tiny (2–3 measurable) + numbers are an upper bound. **Collecting more measurable repos
across the fleet before the Tier-2 go/no-go.** S1 guard still ship-regardless.

## OKR

**Objective**: decide — cheaply and falsifiably — whether `/l4 /l5` should ever widen past
width-1, and ship the safety guard that's valuable regardless of that answer.

**Key results**
- KR1 — S0.a (task-supply) measured: fraction of recent L-tasks that split into ≥4
  file-disjoint units with non-trivial per-unit wall-clock. Gate: <~15–20% ⇒ Tier-2 is dead
  weight, stop after S1. **RESULT 2026-06-23: 13.0% → FAIL the gate.** See Decision log.
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
- **S0.a measured (2026-06-23) → FAIL.** Method: sampled the **last 54 first-parent merges to
  `origin/develop`** (the auditable proxy for L-size tasks — the ~50 the gate asked for). Per
  merge, grouped changed files into components (`skill:<name>` / `scripts` / `hooks` / `agents`
  / `references`, **excluding** version-mirror boilerplate + `docs/`), counted a component as a
  *substantive independent unit* only if its churn ≥ 25 lines (the fixed cost of a parallel
  agent — worktree setup + dispatch + merge-back — dwarfs a sub-25-line edit). A merge is
  "≥4-wide" iff it has ≥4 such units. Sensitivity sweep over the threshold:
  - churn≥0 (any touch) → 53.7% — this is the **file-count fallacy the research already killed**.
  - churn≥10 → 18.5%  |  **churn≥25 → 13.0%**  |  churn≥50 → 7.4%  |  churn≥100 → 1.9%.
  Every defensible "worth-a-separate-agent" threshold lands **at or below 13%**, under the gate.
  Worse, 13% still *over*-counts: of the 7 wide merges, ≥2 (`ceo-fleet-autonomy` l3/l4/l5/
  ceo-agent shared front-door; `pua-inspired` single-theme cascade) are exactly the
  **disjoint-file-but-semantically-coupled** case the dialectic flagged → genuine ≈ 9% (5/54).
  The real wide cases are all *batch* work (doc-rot batch, the 13-skill session-lifecycle batch,
  SP-trio internalization) — not dependency-graph fan-out. **Conclusion: the wide regime is too
  rare to justify Tier-2; the descope holds — ship S1 guard only.** Raw data:
  `/tmp/.../scratchpad/s0a-substantive.txt` (regenerable from the merge log).
- **Cross-repo reopen (2026-06-23)** — the autopilot-only S0.a was rejected as a biased sample
  (a plugin/docs repo is single-threaded by nature). Built a portable fleet probe and ran it on
  the local repo set: of 9 distinct repos only 2–3 are *measurable* (real feature-merge history;
  the rest are solo direct-to-main / vendored shallow clones / non-software — itself a finding:
  the population where width fan-out applies is thin), and the measurable ones mostly clear the
  20% gate at depth-2 (autopilot 42 / cado-nfs 46 / codeforge 75% d2c25; conservative d1 sits
  18–22%, right at the gate). So the cheap "descope" conclusion does **not** survive contact with
  real repos — but n is tiny and depth-2 is an upper bound. Next: collect more measurable repos
  fleet-wide (endpoint flow in `HANDOFF-collect-task-width.md`), then `--show-wide` semantic check
  before the Tier-2 go/no-go.
- **baseRef spike (v2.21.1, `5becac4`)** — worktree-base precondition resolved ahead of this
  project (`worktree.baseRef:"head"` + hetero `--base`).
