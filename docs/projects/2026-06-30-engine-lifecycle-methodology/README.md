# Engine-Lifecycle Methodology — implementation

> Plan: [`docs/plans/2026-06-30-hetero-engine-lifecycle-methodology.md`](../../plans/2026-06-30-hetero-engine-lifecycle-methodology.md) (CONVERGED v8)
> Branch: `feat/engine-lifecycle-methodology`
> Process: `/l5` — hetero implementer (gpt-5.3-codex-spark via codex) + decorrelated gpt-5.5 xhigh review loop + depth-0 independent harness.

## v1 slice (§5 steps 1–2 of the plan)

| Unit | Component | Status |
|------|-----------|--------|
| A | `scripts/engine-scorecard.js` — append-only JSONL store + current/report/ladder query engine | **in progress** |
| B | `scripts/engine-qualify.sh reviewer` — wraps `calibration.sh run-known-bad`, records a Stage-1 row | pending |
| C | `scripts/resolve-review-loop.sh` extension — scorecard validation (fail-closed) + `fallback_ladder` | pending |
| D | `evals/known-bad/` injection-resistance cases (reviewer corpus dimension) | pending |

Deferred to follow-ups: implementer corpus (Unit, §5 step 3), planner path, quota-signal + cooldown, cost-token-capture spikes.

## OKR
- **O**: turn the methodology's v1 (reviewer-role lifecycle) into working, wired autopilot code.
- **KR1**: `engine-scorecard.js` passes an independent depth-0 adversarial harness (effective-status latest-wins, identity filtering, ladder decorrelation penalty, flock concurrency).
- **KR2**: reviewer qualification (`engine-qualify.sh`) reproduces M3's 10/10 known-bad result and writes a scorecard row.
- **KR3**: resolver fails closed on an unqualified/expired pinned reviewer and emits the fallback ladder.
