# Retire manifest — owner-kernel retirement (plan P1 step 3)

Quarry anchor (resurrect any file from this commit): `3fd980b6f59a9b6776a3800e43966b944970284a`

| File | LOC | Policy-value disposition |
|---|---|---|
| src/engine/owner-kernel/kernel.js | 4357 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |
| src/engine/owner-kernel/state.js | 2881 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |
| src/engine/owner-kernel/events.js | 353 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |
| src/engine/owner-kernel/ledger.js | 758 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |
| src/engine/owner-kernel/witness.js | 291 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |
| src/engine/owner-kernel/acceptance.js | 549 | QUARRIED -> references/evidence-contract.md (acceptance predicate: green per leg, non-self non-same-family challenger clear, zero blocking, contract frozen at intake, evidence bound to artifact) |
| src/engine/owner-kernel/shadow-translation.js | 503 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |
| src/engine/owner-kernel/semantic-authority.js | 294 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |
| src/engine/owner-kernel/compatibility.js | 395 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |
| src/engine/owner-kernel/terminal.js | 233 | QUARRIED -> references/evidence-contract.md (terminal-issuer invariants: freeze-before-execute, empty-set refusal, silence-is-not-consent, no third outcome) |
| src/engine/supervised-authenticated-intake.js | 914 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-engine-bridge-contract.js | 1258 | none beyond AUTOPILOT_ENGINE_CONTROL_SINKS, inlined into autopilot-engine.js in P2 |
| src/engine/supervised-host-preflight.js | 537 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-intake-verifier.js | 686 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-owner-kernel-engine-acceptance.js | 565 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-owner-kernel-installed-contract.js | 580 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-owner-kernel-installed-engine.js | 2584 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-owner-kernel-installed-ipc.js | 254 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-owner-kernel-installed-runner.js | 141 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-owner-kernel-probe-effect.js | 501 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-owner-kernel-semantic-witness.js | 985 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-production-substrate-contract.js | 1160 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-production-substrate-durable-contract.js | 935 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| src/engine/supervised-shadow-engine-consumer.js | 928 | none-found (isolation machinery for an inapplicable threat model; recoverable-via-anchor) |
| scripts/owner-kernel.js | 253 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |
| scripts/check-owner-kernel-release-gates.js | 2860 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |
| scripts/divergence-monitor.js | 262 | idea already recorded in references/evidence-discipline.md (an unexercised path must never read as agreement) |
| scripts/check-retirement-receipts.js | 248 | idea honored by this plan itself (deletions carry receipts: plan + CHANGELOG); recorded in evidence-discipline addendum (P6) |
| src/status/shadow-terminal-observer.js | 116 | idea already recorded in references/evidence-discipline.md (obligations from raw evidence, never from the judged predicate) |
| src/host-adapters/witness-adapter.js | 570 | none-found (integrity/bookkeeping machinery; recoverable-via-anchor) |

## Phase commits
(appended after each phase lands; same-commit self-reference is impossible — plan §2.5)

| Phase | Commit |
|---|---|
| plan + review chain (docs) | 3fd980b6 |
| P1 evidence freeze | 1c0878cf |
| mirror catch-up (chore) | d097c77c |
| P4 strict /l5 advisory | e6f99afd |
| inventory fix (chore) | 9baf9499 |
| P2 core + supervised retirement | b2d7eede |
| P3 unwire + archive | (appended in P6 — same-commit self-reference impossible) |
| P3 unwire + archive | 3c39fc21 |
| P6 knowledge closeout + v2.34.10 | 7ef66453 |
