# Trust-tiered review policy — implementation (v2.25.11)

> Branch `feat/v2.25.11-trust-tiered-review-policy` · Design (gpt-5.5-converged): [`../../plans/2026-06-26-trust-tiered-review-policy.md`](../../plans/2026-06-26-trust-tiered-review-policy.md)
> Dogfood: built via `/l5` (codex `gpt-5.3-codex-spark` impl + gpt-5.5 xhigh decorrelated review + depth-0 independent harness).

## Project Goal

> **Final goal**: implement the buildable-now core of the trust-tiered review policy — review depth
> keyed on a deterministic `implementation_review_risk` (NOT source-trust alone), cross-family
> hard-required whenever L2 runs (with `family_id` canonicalization + fail-closed-on-unknown), and
> the terminal-verdict-state honesty split — in `resolve-review-loop.sh` + contracts + tests.
>
> **Success criteria**:
> 1. `resolve-review-loop.sh` computes deterministic `review_risk` (low|high) from {source-trust,
>    diff-lines, protected-path, oracle-available, security-surface} and emits `review_risk`,
>    `cross_family_required`, `cross_family_satisfied`, `required_review_families`, `l1_required` +
>    `--field` accessors. (resolver test green.)
> 2. `family_id` canonicalized + **unknown ⇒ fail-closed (NOT counted as cross-family)**; the
>    family-overlap signal escalates WARNING(low)→ERROR(high) but the resolver stays exit-0 (callers
>    enforce). (test asserts fail-closed + escalation.)
> 3. Contracts updated: terminal verdict states (`verified`/`unverified-nonblocking`/
>    `unverified-blocking`) + `independent_harness` split (decorrelated-verification-required vs
>    oracle-strength; no-oracle→human-escalation) + dispatch-manifest provenance precondition.
> 4. All tests green; validate/canonical clean; version 2.25.11; CHANGELOG+INDEX; preflight-release.
>
> **Scope boundary**:
> - IN: resolver risk-scoring + cross-family-hard + family canonicalization + verdict-state contract
>   + provenance precondition doc + tests + release.
> - OUT (future-gated / needs infra, per design §3.3/§4/§6): shadow/promotion-metrics calibration
>   infra; flipping the qc_panel default (stays 3 until calibrated); local-runner enforcement (no
>   local runner exists); actual mutation/differential oracle machinery (contract only). NOT
>   malicious-proof.

## Phases

| Phase | Scope | Engine |
|-------|-------|--------|
| P0 | `resolve-review-loop.sh`: deterministic risk scoring + new emitted fields + family canonicalization/fail-closed + `--field` + resolver test | codex spark (hetero) → depth-0 qc |
| P1 | Contracts: verdict states + independent_harness split + provenance precondition (code-review.md / review-loop-config.md / level-front-door.md) | depth-0 (convention-heavy) |
| P2 | Wire-in (CLAUDE.md inventory) + release (CHANGELOG v2.25.11 + INDEX + version sync) | depth-0 → finish-flow |

## Progress

| Phase | Status | Commit |
|-------|--------|--------|
| P0 | in_progress | |
| P1 | pending | |
| P2 | pending | |

## Notes

- Built ON the design this implements (review-policy implemented via the hetero+decorrelated-review pipeline).
- §6 design TODOs (terminal states, deterministic risk table, family_id fixture) are folded into P0/P1.
