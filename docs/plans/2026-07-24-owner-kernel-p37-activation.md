# Owner Kernel P3.7 production activation

> **Status**: P3.7 installed-host U5/U6 activation implemented; release remains `HOLD` on
> production KR8/KR10 evidence and the 14-day alias-retirement window. P4 is ready, not started.
> **Parent plan**: [`2026-07-20-owner-kernel-evolution.md`](2026-07-20-owner-kernel-evolution.md)
> **Project**: [`../projects/2026-07-20-owner-kernel-governance/README.md`](../projects/2026-07-20-owner-kernel-governance/README.md)
> **Release target**: v2.32.59

## Background

P3.6c completed the installed, cross-UID, durable A0 substrate, but that substrate is intentionally
refusal-only. It proves peer identity, lifecycle supervision, durable role-private state, receipt anchoring,
restart behavior, and teardown auditing. It does not construct `OwnerKernel`, expose an action catalog,
enable the broker, call `AutopilotEngine`, or make acceptance available.

P3.7 activates those capabilities in three separately reviewable boundaries. Each boundary is a new,
versioned profile. v2.32.59 implements those boundaries as external-host contracts; it does not satisfy
this plan's later installed-host, dogfood, or KR gates. Existing P3.5d and P3.6 A0 evidence remains
interpretable and is never upgraded by relabeling old records.

## v2.32.59 bounded milestone

This release is accepted only as an external-host contract milestone:

- New sessions reject stale handoffs and bind the exact P3.5d handoff, exclusive P3.6 claim,
  five-service durable cohort, policy, contract, workspace, and immutable base. Resume revalidates
  the frozen route without requiring the short-lived intake handoff to remain fresh. The route's
  `substrate_plan_hash` preserves the P3.6c durable protocol's P3.5 bridge-plan binding; the separate
  `p36_contract_plan_hash` binds the exact P3.6a compiled substrate contract.
- The five installed P3.6 service bindings must exactly match the durable cohort. The external P3.7
  host supplies and freezes the Kernel binding; this release does not claim an installed Kernel
  peer/cgroup attestation.
- Semantic receipts compare-and-append, read back, verify an independent anchor, reject a stale head
  or non-next durable sequence before append, reject non-contiguous batches, and become locally
  unusable even when remote teardown fails.
- Semantic delegation requires the trusted host verifier to attest the full frozen worker binding,
  not only its identity string.
- The only effects are one fixed reversible probe and one fixed implementation-dispatch sink.
  Acceptance and completion share one witness batch; a lost record response is accepted only when
  exact-attempt resolution returns the identical committed response.
- Focused gates, the 8/15 contract corpus, the full deterministic suite, version/mirror checks, and
  the existing privileged P3.5/P3.6 gates pass. No result is described as installed P3.7 authority.

The original production P0, installed-host dogfood, KR8/KR10, and 14-day alias-removal gates below
remain open and keep the parent project active after this release.

## Global invariants

- The installed P3.5d descriptor-bound v2 handoff is the only intake route.
- The five P3.6 receipt-verifier/witness/broker/coordinator/worker identities are fixed by the installed
  snapshot and verified through peer credentials plus the exact systemd cgroup. The Kernel identity is
  frozen into the P3.7 route supplied by the external-host contract; installed Kernel peer/cgroup
  attestation remains part of the deferred full-activation gate.
- Worker output and model claims never append authoritative Owner Kernel events directly.
- Every semantic append uses a compare-and-append receipt bound to the prior Kernel head, route version,
  run/invocation, descriptor ticket, policy, acceptance contract, emitter role, and event hash.
- Receipt verification and witness persistence are different roles. A receipt is authoritative only after
  the verifier validates it and the witness advances the exact expected head.
- A version or binding mismatch, stale head, replay, ambiguous crash window, unavailable role, or durable
  state disagreement blocks. Recovery never repeats an effect or infers acceptance.
- Existing `converged` remains distinct from `accepted`.
- `/l3` through `/l6` remain one-release compatibility aliases. Their eventual removal requires the
  parent plan's real 14-day witnessed zero-use gate; this run does not manufacture elapsed telemetry.
- External push, publish, deploy, charge, send, and downstream-repository mutation remain forbidden.

## P3.7a Semantic witness bridge

### Goal

Consume one real P3.5d v2 handoff, construct the production `OwnerKernel`, and route versioned Kernel
semantics through `kernel -> receipt_verifier -> witness`. The action catalog is empty, the broker stays
disabled, no Engine sink runs, and acceptance stays unavailable.

### Design

1. Add a versioned semantic route to the supervised substrate rather than changing A0 operations.
2. Construct the Kernel only after the installed descriptor ticket, owner envelope, policy, acceptance
   contract, owner qualification, and route identities all verify.
3. Adapt the durable receipt-verifier and witness leaves to the Kernel witness interface:
   `getHead`, `appendIfHead`, and root readback. The receipt verifier recomputes the event/route binding;
   the witness accepts only its verified receipt and expected head.
4. Drive authenticated intent, owner activation, decision, delegation/evidence, checkpoint/resume, and
   disclosure. Do not call action mint/execution or `accept()`.
5. Keep all public status fields explicit:
   `owner_kernel_authority: semantic_only`, `effect_authority: none`,
   `broker_authority: disabled`, and `acceptance: not_available`.

### Acceptance

- A focused deterministic gate proves valid semantic append/replay/restart/disclosure.
- Independent negative controls reject direct decision append, forged worker evidence, replayed receipts,
  wrong prior head, wrong role, route-version downgrade, descriptor/ticket/policy/contract mismatch,
  peer/cgroup substitution, durable leaf mutation, and post-teardown head rewrite.
- Every oracle is mutation-proven by a defect that makes the gate fail.
- Existing P3.5d, P3.6 deterministic, replay, recovery, and privileged P0-A0 gates remain green.

## P3.7b One reversible broker-owned probe effect

### Goal

Enable exactly one fixed, reversible probe action through the existing P2 permit, claim, authorization,
receipt, and reconciliation protocol. No caller supplies a command, path, tool, target, or operation.

### Design

1. Add a new effect-capable profile and fixed catalog row. Its broker operation toggles one private,
   per-run probe sentinel between two bounded states and can restore the pre-effect state.
2. The Kernel mints a preclaim permit only after fresh host-capability evidence. The witness records the
   claim before the broker obtains postclaim authorization.
3. The broker consumes the exact authorization atomically, performs only the fixed operation, and returns a
   receipt binding effect ID, prior/new state hashes, catalog/decision/claim/permit/authorization hashes,
   peer identity, descriptor ticket, and times.
4. The receipt verifier independently reads the sentinel, verifies the receipt, advances its anchor, and
   supplies the witnessed reconciliation result. Pending or ambiguous claims resolve to `unknown` without
   replaying the effect.
5. Every other catalog entry and sink remains denied.

### Acceptance

- The focused gate proves one successful reversible effect and restoration through the broker.
- Negative controls exhaustively reject expired/stolen/replayed permits, preclaim/postclaim confusion,
  decision/action/target substitution, direct broker bypass, wrong peer/cgroup/descriptor, receipt mutation,
  effect-before-claim, cancellation races, duplicate effect IDs, and crashes at every durable boundary.
- Reconciliation proves exact completed/failed/unknown outcomes and zero effect replay.
- P3.7a and all prior gates remain green.

## P3.7c Acceptance coordinator and one real Engine sink

### Goal

Bridge the P2b acceptance coordinator and exactly one real `AutopilotEngine` sink. The first sink is the
implementation dispatch seam already frozen by the P3.3 inventory. Other Engine sinks remain denied until
they have their own fixed catalog entries and the same protocol.

### Design

1. Add a versioned coordinator route implementing `acquire`, `commit`, `requestAbort`, `cancel`,
   `resolveAttempt`, `verifyCommit`, `verifyResolution`, and `release` with a durable fenced lease.
2. Map one Engine dispatch request to an exact Owner decision/delegation, P2 action claim, fixed broker
   operation, independently verified receipt, evidence/challenge/audit records, and final manifest.
3. The acceptance candidate is the delivered immutable artifact manifest, not a worktree approximation.
   Verification and independent challenge bind that exact candidate and the current Kernel/witness heads.
4. Commit writes `acceptance` plus `complete` atomically through witness batch/readback. Lost responses are
   resolved by exact attempt ID and candidate hash; stale, foreign, concurrent, or ambiguous decisions fail
   closed.
5. Engine `converged` is an input observation only. Only the Kernel/coordinator transaction returns
   `accepted`.

### Acceptance

- The focused gate proves one real Engine dispatch sink reaches exact atomic acceptance.
- Negative controls reject stale/foreign/concurrent attempts, candidate or final-manifest substitution,
  verification/challenge/audit drift, lease theft/expiry, response loss, split batch, replayed commit,
  post-acceptance write, and `converged` without acceptance.
- Every oracle is mutation-proven and all P3.7a/P3.7b/prior gates remain green.

## Production P0, dogfood, and release

1. Re-run all eight named attack semantics against the complete authority-bearing installed route:
   protected-envelope forgery, direct decision append, worker-artifact decision injection, child capability
   theft, policy/Kernel mutation, mediated-action bypass, capability-set drift, and witness-head rewrite.
2. Execute all fifteen frozen baseline categories against production behavior. Report each category and
   oracle separately; an aggregate pass cannot hide `not_applicable` or unexecuted cases.
3. Mutation-prove every oracle. Fixture-only or A0-only evidence is not production qualification.
4. Run low-risk self-hosted dogfood before high-risk dogfood. Cover project default plus per-run override,
   session replacement, conservative policy, abort/recovery, exact final disclosure, and the one real Engine
   sink.
5. Preserve `/l3`-`/l6` as compatibility aliases for this release. Narrow duplicated prose only after live
   Owner Kernel authority is proven; do not delete aliases without the later real telemetry gate.
6. Measure KR8 and KR10 with the parent plan's frozen definitions. KR8 requires zero observed false
   acceptance, zero missed red-line escalation, and at least 30% fewer mandatory model reviews. KR10
   requires the executed post-P3 load-bearing surface count to be below both 42 and the projected 51.
   A failing KR blocks release; its definition is not changed after measurement.
7. Update architecture, configuration, help, migration, project tracking, CHANGELOG, canonical version
   manifests, and the generated Codex payload for v2.32.59.

## Dispatch units

Every implementation unit uses an immutable base and a frozen strict dispatch-unit contract. A
`dispatch-contract.js` result other than `GO` stops before model spend. Implementation uses the strict
`dispatch-hetero.sh` write rail; the canonical `engine implement-review --resume` path reviews the resulting
branch. Repair requires a new strict unit. Verification authoring uses
`dispatch-author.sh --strict-contract` on a different family.

| Unit | Scope | Objective command |
|---|---|---|
| U1 | P3.7a semantic route and focused tests | `bash hooks/tests/supervised-owner-kernel-semantic-witness.test.sh` |
| U2 | P3.7b fixed reversible probe effect and focused tests | `bash hooks/tests/supervised-owner-kernel-probe-effect.test.sh` |
| U3 | P3.7c coordinator plus one Engine sink and focused tests | `bash hooks/tests/supervised-owner-kernel-engine-acceptance.test.sh` |
| U4 | Production 8/15 corpus, dogfood, docs, version, mirrors | `bash hooks/tests/owner-kernel-production-corpus.test.sh` |

## Final verification

```bash
node scripts/owner-kernel.js resolve --config .claude/owner-kernel-governance.json --check
bash hooks/tests/supervised-owner-kernel-semantic-witness.test.sh
bash hooks/tests/supervised-owner-kernel-probe-effect.test.sh
bash hooks/tests/supervised-owner-kernel-engine-acceptance.test.sh
bash hooks/tests/owner-kernel-production-corpus.test.sh
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-p0-replay.test.sh
AUTOPILOT_P0_A0_LIVE=1 PYTHONDONTWRITEBYTECODE=1 \
  bash hooks/tests/supervised-production-substrate-p0-live.test.sh
AUTOPILOT_P35_LIVE=1 bash hooks/tests/supervised-intake-live-host.sh
AUTOPILOT_P36_LIVE=1 bash hooks/tests/supervised-production-substrate-live.test.sh
bash hooks/tests/run.sh --parallel 16
bash scripts/validate.sh
bash scripts/sync-all.sh --check
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/check-canonical-invariants.sh
bash scripts/sync-codex-plugin-skills.sh --check
git diff --check
```

## Risks

- The host boundary is Linux/systemd/cgroup-v2 specific; no cross-platform authority claim is made.
- A compromised root host remains outside the prevention model.
- The fixed probe effect is intentionally not general command execution.
- Versioned routes add compatibility obligations; old A0 evidence must remain replayable.
- KR10 can still block release even when correctness gates pass.
- Engine role qualification or quota may stop `/l6` before spend. That is a valid precondition failure,
  not permission to fabricate scorecard evidence or bypass the strict contract.

## Out of scope

- Remote/quorum witness infrastructure.
- Arbitrary command/path/tool authority.
- Downstream-repository migration.
- Push, publish, deploy, charge, or external destructive actions.
- Alias deletion before one shipped compatibility release and the real 14-day zero-use gate.
