# Engine-Lifecycle Methodology — implementation

> Plan: [`docs/plans/2026-06-30-hetero-engine-lifecycle-methodology.md`](../../../plans/2026-06-30-hetero-engine-lifecycle-methodology.md) (CONVERGED v8)
> Branch: `feat/engine-lifecycle-methodology`
> Process: `/l5` — hetero implementer (gpt-5.3-codex-spark via codex) + decorrelated gpt-5.5 xhigh review loop + depth-0 independent harness.

## v1 slice (§5 steps 1–2 of the plan)

| Unit | Component | Status |
|------|-----------|--------|
| A | `scripts/engine-scorecard.js` — store + current/report/ladder | ✅ done (13/13 harness) |
| B | `scripts/engine-qualify.sh reviewer` | ✅ done (14/14, R2 SHIP) |
| C | `resolve-review-loop.sh` --check-scorecard + ladder | ✅ done (93/93, invariant held) |
| D | `evals/known-bad/` injection cases (11,12) | ✅ done (apply-clean, 12/12 false-pass) |

Follow-up extension: `engine-scorecard.js` now accepts all governed role
evidence rows (`reviewer`, `implementer`, `planner`, `verifier`,
`orchestrator`) for `current`/`report` evidence queries so future role evals
have one durable store. Reviewer remains the only shipped qualifier/resolver
gate in this implementation line; verifier/orchestrator rows are R2 evidence,
not fallback-ladder routing, automatic routing, or blocking authority.

Deferred to follow-ups: implementer corpus (Unit, §5 step 3), planner path,
verifier/orchestrator eval harnesses and resolver consumers, quota-signal +
cooldown, cost-token-capture spikes.

## OKR
- **O**: turn the methodology's v1 (reviewer-role lifecycle) into working, wired autopilot code.
- **KR1**: `engine-scorecard.js` passes an independent depth-0 adversarial harness (effective-status latest-wins, identity filtering, ladder decorrelation penalty, flock concurrency).
- **KR2**: reviewer qualification (`engine-qualify.sh`) reproduces M3's 10/10 known-bad result and writes a scorecard row.
- **KR3**: resolver fails closed on an unqualified/expired pinned reviewer and emits the fallback ladder.
