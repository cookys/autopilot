# Plan — `/l4 /l5` width fan-out: gating spike + minimal disjointness guard

**Date**: 2026-06-23
**Slug**: `l4-l5-dep-graph-fanout`
**Status**: dialectic **CONVERGED (round 2)** → **DESCOPED** (see review log). This is a
**go/no-go spike (S0) + a ship-regardless guard (S1)**, with the Tier-2 fan-out build (Phase L)
conditional on both S0 gates. Ready to expand into a tracked project.
**Size**: spike = S; the conditional Tier-2 build (only if the spike greenlights) = L.

## Problem

`/l4 /l5` run **width = 1**. Widening could cut wall-clock on genuinely-independent work —
but Phase-1 research + a 3-role dialectic (Architect/Ops/Skeptic, round 1) converged on a
hard truth: **the safety case for widening cannot be made cheaply, and the value case is
unproven for this repo's workload.** So the build sequence is inverted — measure first,
build only what the measurements justify.

## What the research settled (Phase 1 — sources in review log)

1. "Edge density" is the wrong metric — the ceiling is **work/span (Brent)** + **antichain
   width of the ready frontier**, clamped to a small resource constant. (No scheduler uses density.)
2. Empirical width consensus **3–5, optimal ≈4, degrades past ~8** (Anthropic, CAID, CodeCRDT, Osmani).
3. Our worktree-isolated + dependency-aware topology is the validated one (CAID +26.7%/+14.3%;
   "soft" instruction-only isolation **lost to serial** — physical isolation is necessary).
4. **Hardest failure = semantic-incoherent merge** (compiles, logically wrong). git can't see it;
   the **depth-0 reviewer is the only backstop**. Semantic conflicts carry a bug **26×** more
   often than disjoint changes.
5. The LLM dependency graph must **not** be load-bearing — widening gates on a **deterministic**
   predicate, not the graph.
6. No native CC primitive fits (`/batch`, agent-teams, Workflows each miss merge-back + single
   authoritative review + hetero). Keep the custom dispatcher.

## What dialectic round 1 changed (the descope — full findings in review log)

- The deterministic gate as first drafted **validated the proposal, not the result; failed
  open through an LLM caller; and certified file-overlap while the dominant failure is
  disjoint-file semantic coupling** — net-negative (green stamp → reviewer rubber-stamps).
- P0's measurements are a **standalone go/no-go**, not Phase 0 of a presumed build. P2/P3 are
  Tier-2-only machinery worthless if Tier-2 never fires.
- N-worker fan-out was never reconciled with the single-agentId control loop.

## Corrected design principles (carried into both the spike and any later build)

1. **Gate validates the RESULT, deterministically.** The safety check is post-commit:
   `actual_touched_files ⊄ declared_allowlist ⇒ fail-closed`. The pre-dispatch proposal check
   is advisory only; the *enforcement* reads git artifacts (same rail as `dispatch-hetero.sh`).
2. **Enforcement is a shell clamp, not LLM prose.** `check-disjointness.sh` **exits non-zero**
   when any unit is forced to Tier-1; the dispatch wrapper refuses width > `eligible_tier2`
   in shell. The LLM is never load-bearing for fail-closed.
3. **The green stamp is de-fanged.** The depth-0 reviewer contract states explicitly: *the
   disjointness gate certifies FILES ONLY, not behavior; semantic coupling is yours to catch.*
   Without this carve-out the gate makes the dominant failure mode worse.
4. **Fixed cap 3 is the default; Tier-2 only widens file-provably-disjoint units.** Coupled or
   undeclared-touch work never widens.
5. **Amdahl is cross-run telemetry, not a within-run gate** (it's only knowable post-hoc).

## Phase S0 — the gating spike (THE committed deliverable) · size S · gates project existence

Two independent measurements. **Both must pass before any Tier-2 build is authored.**
**Hard ordering: run S0.a FIRST as a ~1-hour cut** — if task-supply fails, stop *before*
building S0.b's checker (cheapest possible exit; round-2 refinement).

**Precondition (resolved 2026-06-23):** the per-unit file allowlist the checker consumes
already exists — `autopilot:planner`'s six-element Task Prompt emits **Scope** ("exact file
paths and modules to touch", element 2) + **Boundaries** ("what NOT to touch", element 6).
The disjointness gate reads `Scope:` as the declared allowlist; the result-validator diffs
actual-touched against it. **No planner contract change needed.**

### S0.a — Task-supply (the existence gate)
- **Step**: sample the last ~50 L-size tasks (git history + `docs/projects/`); for each, judge
  whether it decomposes into **≥4 file-disjoint units with non-trivial per-unit wall-clock**.
- **Gate**: if the wide regime fires in **< ~15–20%** of L-tasks → **Tier-2 dispatch is dead
  weight**; ship only the guard (S1) + documented fixed cap 3. Record the fraction.
- **Why first**: this repo's real workload is doc/script/reference edits (markdown, shell, JS),
  not 20-module refactors — the CAID/CMU evidence is from multi-engineer *code*. If our L-tasks
  are 2–4 cross-referencing files, they couple *semantically* (the exact case the gate can't
  protect) and the feature both rarely fires and fires in its most dangerous regime.

### S0.b — Semantic-inclusive miss-rate of the result-validating checker
- **Step**: build `check-disjointness.sh` in its **result-validating** form (post-commit:
  actual-touched ⊄ declared ⇒ exit non-zero) and a pre-dispatch proposal form (advisory). Test
  against a **semantic-inclusive** sample — pairs that touch *disjoint files but share a
  behavioral contract* (an import edge, a shared type, a call-order/invariant), not just
  `git log --name-only` file-overlap.
- **Gate**: if the file-set checker certifies "disjoint" for semantically-coupled disjoint-file
  pairs at a rate that would reach depth-0 pre-stamped → **the green stamp is dangerous**; do
  not build Tier-2 widening; the checker ships only as a file-hygiene guard with the reviewer
  carve-out (S1), never as a widen-authorizer.
- **Honesty clause**: building the labelled semantic-coupling sample may be infeasible cheaply.
  If it is, that *itself* is the finding — the safety case for widening can't be made, so don't
  widen. (Skeptic round-1 #3.)

## Phase S1 — ship-regardless guard · size S · valuable even at fixed cap 3, independent of S0

- `scripts/check-disjointness.sh`: result-validating allowlist enforcement (exit non-zero on
  undeclared touch / overlap; JSON detail). Denylist scoped to what regex can own — **lockfiles
  + named build/config globs only** (drop the un-detectable "generated code" / "shared type
  module" claims; Ops round-1 #8).
- `references/blind-dispatch.md` + `skills/ceo-agent/references/level-front-door.md`: document
  **fixed cap 3** as the `/l4 /l5` default, the guard, and the **depth-0 reviewer carve-out**
  (gate = files only, not behavior).
- `CLAUDE.md` inventory row for the script.
- **Acceptance**: a unit whose actual commit touches a file outside its declared allowlist →
  checker exits non-zero (artifact-verified, not self-report). Existing width-1 path unchanged.

## Phase L (CONDITIONAL — authored only if BOTH S0 gates pass) · size L

Only then is a tracked project opened for Tier-2 dispatch. It must include — these are the
round-1 structural debts, not optional:
- **Per-unit outcome table + all-or-nothing merge-back**: any non-`committed` unit ⇒ escalate
  the whole fan-out, merge nothing (no half-feature shipped unattended). Architect #1, Ops #3.
- **Control-loop fan-out**: foreman holds N agentIds; `TaskStop`/Monitor/GC iterate; branch
  namespace `unit-<id>-<run-id>` (collision-safe); a supervising parallel-kill trap that
  distinguishes "batch aborted" (reap all) from "one unit stalled" (keep). Ops #4, #6.
- **Single base per batch**: a Tier-2 batch shares one base (`worktree.baseRef`/`--base`);
  mixed-base splits are not a valid decomposition. Architect #3.
- **Merge-conflict-as-missing-edge** collapses the conflicting units back into ONE Tier-1
  serial unit (NOT a coordinated round-2 re-dispatch — that would breach blind-dispatch's
  implementer-blinding). Architect #4.
- **Amdahl as cross-run telemetry** (stored, tunes the cap across runs; named clock owner =
  the depth-0 loop emitting `t_dispatch / t_all_committed / t_review_done`). Architect #5, Ops #5.

## Scope cut (NOT building)

- Continuous `f(edge-density)` width — killed by research.
- LLM dependency graph as the dispatch gate — replaced by the deterministic result-validator.
- Width > the small constant for coupled work — never.
- **`/l5` hetero PARALLEL** — the weakest leg (Open Q3 + Skeptic #6: speculative on speculative;
  base-correctness × engine-variance × rarest task-supply). If anything ships, `/l4`
  homogeneous-only; `/l5` parallel → BACKLOG.
- Auto-resolving merge conflicts unattended — escalate, never auto-merge.

## Test plan

- S0.b checker: semantic-inclusive sample replay (the kill measurement) + unit cases (undeclared
  touch, shared lockfile, disjoint, import-coupled-but-disjoint-files).
- S1 guard: artifact-verified undeclared-touch detection; width-1 regression unchanged.
- Phase L (if it exists): synthetic-split dry-runs, per-unit outcome aggregation, parallel-kill
  trap test (via `setsid` + signal, per memory `bash-int-pgroup-trap` — verify, don't reason).

## Risks + inversion

| Risk | Inversion |
|------|-----------|
| The semantic-coupling sample (S0.b) is infeasible to label cheaply | That IS the finding — can't prove widen-safety ⇒ don't widen; ship S1 guard only. |
| S0 passes but the gate still lulls the reviewer | The S1 carve-out is mandatory in the reviewer contract; without it, block. |
| Building the spike is itself wasted if obviously no | S0.a (task-supply) is the cheap first cut — run it before S0.b's checker build. |

## Open questions (genuine forks for the user — round-1 surfaced no stalemate, these are scoping)

1. **Run S0.a (task-supply) first as a 1-hour cut?** If this repo's L-tasks rarely split, the
   whole thing collapses to S1 and we stop — cheapest possible exit.
2. Should S1 (the guard + cap-3 docs + reviewer carve-out) ship **now regardless**, since it's
   valuable and low-risk independent of whether Tier-2 ever gets built?

(Round-2 resolved the former Q3 — planner already emits the allowlist via Scope/Boundaries; see
the S0 precondition note.)

## Review log

- **Phase 1 research (2026-06-23)** — 3 parallel agents (build/CI schedulers — Bazel/make
  jobserver, span/Brent; LLM multi-agent — Anthropic post, CAID arXiv:2603.21489, CodeCRDT
  arXiv:2510.18893, AgenticFlict; adversarial skeptic — USL/Amdahl, library-hallucination
  arXiv:2604.07755, merge-conflict bug-rate NSF PAR 10515782). Reversal: edge-density →
  span/antichain + deterministic disjointness gate.
- **baseRef spike (2026-06-23, v2.21.1, merged `5becac4`)** — worktree-base precondition
  resolved: `worktree.baseRef:"head"` (native) + `--base` (hetero) are the two knobs.
- **Dialectic round 1 (Architect/Ops/Skeptic, 2026-06-23)** — verdicts NEEDS_REWORK ×2 +
  DESCOPE. Convergent criticals: (1) gate validated the proposal not the result, failed open
  via LLM caller, and certified file-overlap while the dominant failure is disjoint-file
  semantic coupling → net-negative green stamp; (2) P0 is a standalone go/no-go spike, not
  Phase 0 — P2/P3 speculative until task-supply returns; (3) N-worker fan-out unreconciled
  with the single-agentId control loop (partial-failure, GC, branch namespace, parallel-kill
  trap). **Synthesis adopted**: descope to S0 (gating spike) + S1 (ship-regardless guard);
  result-validating + shell-clamped + de-fanged gate; Phase L conditional on both S0 gates;
  `/l5` parallel cut to BACKLOG. No genuine fork remained → synthesized, not surfaced as stalemate.
- **Dialectic round 2 (2026-06-23)** — **CONVERGED**. Re-verified all three round-1 criticals
  genuinely CLOSED (not papered): C1 (gate result-validating + shell-clamped + the dangerous
  green stamp gated out of existence by S0.b, not merely annotated); C2 (S0 gates project
  existence on both measurements; nothing built speculatively first); C3 (N-worker reconciliation
  honestly deferred into conditional Phase L; S1 provably needs none of it). Descope judged
  right-sized, not timid — shipping Tier-2 into this repo's semantically-coupling doc/script
  workload would be the real over-correction. No genuine stalemate fork. Two refinements folded:
  hard-order S0.a before S0.b; resolved planner-allowlist as a precondition (Scope/Boundaries).
  Status → ready to expand into a tracked project.
