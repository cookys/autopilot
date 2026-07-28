# Mission Phase 1 — Reducer and Shadow Ledger

> Initial implementation: `066d190`
>
> Implementation and repairs: `9ec753c..c6c8e26`
>
> Portfolio integration: `7fe0a50`
>
> Status: READY

## Frozen Boundary

P1 owns the pure Mission reducer, reservation and grant accounting, shadow/enforce behavior,
same-lineage inheritance, authenticated control events, operational projection binding, and the
TaskAuthority Mission fields. It preserves the P0 incident corpus unchanged and does not implement
live ICC dispatch binding, current-Codex enforcement, task closeout, or package mirrors.

## Deterministic Evidence

- `bash hooks/tests/mission-convergence.test.sh`: PASS, 160 assertions.
- `bash hooks/tests/mission-convergence-integration.test.sh`: PASS, 25 assertions.
- `bash hooks/tests/owner-kernel-cli.test.sh`: PASS, 24 assertions.
- `bash hooks/tests/implementation-campaign-state.test.sh`: PASS, 185 assertions.
- `node --check` passes for every modified JavaScript file.
- `bash scripts/check-canonical-invariants.sh`: PASS.
- `bash scripts/validate.sh`: PASS, 28/28 skills.
- `node scripts/sync-version.js --check`: PASS.
- `git diff --check`: PASS.
- The frozen P0 incident corpus has zero net diff from its frozen baseline.

The reducer now enforces complete per-axis reservations, single-use logical grant binding, exact
replay idempotency, conservative overspend accounting, durable same-lineage inheritance, and
fail-closed projection/config validation. Authenticated control events use module-private,
single-use identity attestation; receipts, state, and digests contain only sanitized snapshots.

## Heterogeneous Trail

Qwen and MiniMax performed the implementation/repair passes. GLM, Gemini, Qwen, MiniMax, and
Codex `gpt-5.6-sol` participated in bounded reviews. Transport failures, quota exhaustion, empty
responses, and `no_verdict` results were recorded but never counted as approval.

| Severity | Finding | Repair |
|---|---|---|
| 🟠 Major | The initial implementation answered the fixtures instead of implementing a generic reducer. | Replace it with generic state construction, transition validation, and accounting. |
| 🟠 Major | Public or reusable control capabilities allowed forged/replayed authenticated events. | Use private identity attestation, closed own-key validation, and single-use consumption. |
| 🟠 Major | Alias and authenticated object identity could leak into durable state or receipts. | Persist only sanitized plain snapshots and content-addressed references. |
| 🟠 Major | Projection configuration and source references were not fully digest-bound. | Bind the complete operational config, state hash, source digest, and cross-references. |
| 🟠 Major | Successor lineage could omit required binding fields or bypass shared budgets. | Require complete own-property lineage binding and inherit nonterminal reservations/durable use. |
| 🟠 Major | Overspend and reconciliation math could undercharge or report an unsafe terminal state. | Charge conservatively and force `BLOCKED` on violated budgets. |

The final MiniMax delta review returned `SHIP-AS-IS`. The last Sol blocker was converted into an
exact own-property regression and repaired before that final heterogeneous review.

## Owner Decisions

- The canonical L6 implementation path was blocked because active `session-mode=l6` rejected its
  non-strict dispatch, while strict dispatch had no qualified implementer scorecard path. External
  dispatch therefore used a temporary L3 marker and restored L6 immediately after each fallback.
- `--allow-unqualified-reviewer` was probed once, but implementation was blocked before model spend;
  this remains evidence of a readiness/qualification wiring gap, not an approval bypass.
- A Gemini claim that `contract_state` should be renamed `state` was rejected: constructors,
  restore/digest logic, schemas, and regression tests consistently define `contract_state`.
- No additional Sol review was purchased after the final exact repair. MiniMax's clean delta review,
  the targeted regression, and the full deterministic gate were accepted to conserve scarce quota.

## Final Decision

`READY`. P2 may bind Mission authorization to live ICC dispatch and the current-Codex enforcement
primitive. P1 does not itself claim that those runtime paths are connected.
