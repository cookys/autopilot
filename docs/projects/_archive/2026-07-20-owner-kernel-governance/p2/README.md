# P2 Authority and Serializable Acceptance

P2a implements a fail-closed action-authority protocol. It classifies an action before it reaches a host
boundary, binds the host capability verifier, executor, receipt verifier, and witness at intake, records a
durable claim before the side effect, and accepts only a reconciled receipt. It is intentionally narrower
than a real supervised host integration and is not yet wired into every Autopilot engine action sink; that
integration belongs to P3.

P2b adds the protocol core for serializable acceptance. It is opt-in through an acceptance-contract v2 and
an independent host acceptance coordinator. Version-1 ledgers remain replayable but cannot call the v2
acceptance API, because their historical artifact-hash shape cannot prove the final delivered candidate.

## Activation Contract

A non-empty `governance.action_catalog` requires `OwnerKernel.start()` to receive an action authority.
The authority is not a project JSON value: it is injected as host callbacks plus frozen protocol bindings.
P2a validates those bindings and their message contracts; it does not prove that a JavaScript callback,
identity string, UID, or attestation hash originated in a separate OS process.

- The catalog maps `operation` plus `tool_class` to the minimum action class. A caller may raise that class
  but cannot lower it. Targets must be an exact finite set; wildcard targets are rejected.
- A `full` host must provide preventive plus audited coverage for every external or irreversible catalog
  action. A `partial` host must instead provide a broker-only route for every uncovered red-line action.
  Any row with `requires_mediator`, including a read-only or reversible row, must have that broker-only
  route. A `none` host cannot start an autonomous authority run.
- The host capability verifier echoes a fresh per-probe nonce, its capability hash, and a content-addressed
  observation. Its identity, trust tier, and attestation hash are frozen with the successful intake
  observation and nonce commitment.
- The host capability verifier, executor, receipt verifier, witness, and (when present) broker must have
  distinct identities and attestation hashes. A brokered authority has no worker `executor.execute()`
  callback; it invokes only `executor.broker.execute()` and `executor.broker.cancel()`. The broker
  descriptor requires distinct worker/broker UIDs, permit revocation, protocol version 1, and a canonical
  receipt root. Every brokered receipt must be rooted below that path.
- The external witness supplies `getHead()` and atomic `appendIfHead()`. Every authority event uses that
  compare-and-append operation, so a changed witness head aborts before a host action executes.

The immutable header binds the capability descriptor and hash, host capability verifier binding, executor
binding, receipt verifier binding, witness binding, broker descriptor, intake observation hash, and intake
nonce commitment. Its `authority_hash` is included in every witnessed authority event, so a self-consistent
replacement header cannot be replayed against the original event chain. Resume and ledger verification
reject a different capability verifier, executor, receipt verifier, or witness binding.

## P2b Acceptance Contract

A schema-v2 contract contains a finite artifact ID/target set and legs that name those artifact IDs. A leg's
kind is mechanically derived: `command` present means `executable`; no command means `non_executable`.
The host injects an `acceptanceAuthority` rather than reading it from project JSON. Its coordinator identity,
attestation, protocol version, and the exact witness binding are frozen in the header. The complete frozen
acceptance-authority object is hashed as `acceptance_authority_hash` and that commitment is included in
every schema-v2 event, preventing coordinator-header substitution on an unfinished ledger.

The coordinator must be independently identified and attested from the action verifier, executor, receipt
verifier, broker, and witness. It supplies `acquire()`, `commit()`, `requestAbort()`, `cancel()`,
`resolveAttempt()`, synchronous `verifyCommit()` / `verifyResolution()`, and `release()` around a fenced
snapshot containing the transaction ID, fence, candidate and delivered manifests, audit head, current
event/witness heads, and snapshot hash. Candidate and delivered manifests must match exactly. A schema-v2 witness also requires
`appendBatchIfHead()`; `acceptance` and `complete` are committed as one witnessed batch, and only the latter
is terminal.

`recordVerification()`, `recordChallenge()`, and `recordAuditReconciliation()` create typed, archived
evidence. Every schema-v2 leg needs a clear qualified independent challenge for the exact candidate
manifest; executable legs additionally need green Kernel/trusted-runner evidence for the exact command.
Blocking challenges, generic evidence, self/same-family review, an incomplete audit window, any pending action claim, and an unknown
claim without independent receipt reconciliation all fail the predicate. `requires_challenge` action rows
now use the same typed independent-challenge path before crossing the host boundary. Because that proof
depends on the candidate manifest and durable challenge record, a catalog containing `requires_challenge`
rows requires an acceptance-contract schema version 2 for new runs; `OwnerKernel.start()` rejects v1.
Historical v1 ledgers remain replayable, but cannot mint or execute a challenge-required action.
For a v2 action, the challenge candidate hash must also equal the latest complete coordinator audit that
covers the current action footprint. This prevents a clear result for an old or different artifact manifest
from authorizing a later state; each action that changes the footprint requires a fresh audit before another
challenge-gated action can cross the boundary. A clear result must still be current when it is used, but a
record-time-qualified blocking action finding remains a durable veto for its frozen intent, descriptor, and
candidate tuple even after that challenger's qualification expires.

When a schema-v2 action ledger resumes with an unresolved claim, `pendingActionReconciler` is bound to the
intake-frozen receipt verifier and writes an `unknown` outcome with archived recovery evidence. It receives
claim hashes and identifiers, never the raw preclaim permit or postclaim authorization, and the Kernel never
retries the effect. `actionReconciliationVerifier` must later provide a separately archived, exact receipt
result before that claim's acceptance block clears. A schema-v1 pending claim remains non-resumable.

Delegation and recovery budgets are per authenticated decision. Reaching either configured limit blocks
further work before another dispatch/recovery is issued; only a new authenticated decision clears the prior
exhaustion block and starts a fresh counter.

## Action Sequence

1. `mintActionDecision()` re-probes host capability and freezes the catalog descriptor.
2. `executeAuthorizedAction()` checks the external witness head, active intent, qualification, and exact
   decision/approval use. Before a claim exists, the host capability verifier issues a short-lived opaque
   preclaim permit. It is bound to the run, witness binding and head, authority, future claim ID,
   capability, descriptor, executor binding, and boundary audience. Raw permits never enter the ledger.
3. The Kernel atomically witnesses an `action_claim` carrying only the permit ID and hash. After that exact
   witness event exists, the verifier issues a one-shot opaque execution authorization bound to the claim
   event hash, witness head, emitted time, and preclaim permit. The authorization cannot outlive its permit.
4. The direct executor or broker receives the complete witnessed claim plus the raw preclaim permit and
   postclaim authorization. It must atomically consume or revoke its authorization at the durable
   side-effect boundary. The receipt verifier receives hashes and receipt evidence, not raw bearer values.
   Executor and verifier output must bind run, claim, permit, authorization, executor, receipt, and observed
   action; success also requires an attested effect ID, state version, and effect time within the final
   authorization window. A mismatch becomes `unknown`, never success.
5. Every failure after the claim, user abort, or action timeout calls `revoke_claim_authorizations` with the
   frozen run/claim/permit/authorization tuple. The independently identified receipt verifier must confirm
   the acknowledgement. Cancellation failure is recorded as `unconfirmed`; a `completed` cancellation is
   invalid without a final authorization and in-window effect time. If abort re-enters while the host is
   issuing the postclaim authorization, cancellation waits for issuance to settle and revokes that final
   authorization rather than an empty placeholder.
6. A failed outcome write leaves the claim pending and non-retryable. While such a claim exists, the ledger
   accepts only its durable outcome; intent, owner, approval, abort, checkpoint, and capability mutations
   fail closed. A schema-v2 resume converts it to durable `unknown` only through the independently bound
   recovery adapter; a schema-v1 resume remains blocked. Failed or pending outcomes, and unknown outcomes
   without an exact independently bound reconciliation proof, cannot pass acceptance.

While an action is in flight, intent capture, owner activation, approval, evidence, translation, host
revalidation, and explicit checkpoint control operations fail with `ACTION_CONTROL_LOCKED`. An
authenticated `userAbort()` normally signals cancellation and the action settles only as `unknown` unless a
normal, independently verified receipt arrived first. There are two explicit witness commit windows: an
abort during `action_claim` commit is preserved and reconciled immediately after the claim; an abort during
the already-verified `action_outcome` commit returns `cancellation_requested: false` because success has
already reached its ledger linearization point. The default action timeout is five minutes and uses the same
path. A host/broker that ignores cancellation cannot make a later action acceptable; the run remains blocked
for recovery.

## Current Boundary

P2b is a protocol core, not a production host claim. It supplies the serializable acceptance transaction,
exact contract-leg predicate, qualified challenge evidence, durable action-claim reconciliation/recovery,
delegation transitions, and final acceptance locking. P3 owns integration with the live
`AutopilotEngine` action sinks and a real supervised host/broker path.

P2a is a protocol-level boundary, not process-isolation proof or production acceptance. Its probe and
receipt callbacks are synchronous; a stalled adapter can block the Node event loop, so timeout and user
abort cannot preempt that callback. Production use therefore requires a trusted, bounded synchronous host
adapter today, and must not claim that descriptor fields alone prove IPC credentials, signed attestations,
or OS namespace separation. The P2b coordinator additionally needs host-enforced lease expiry, durable
control ordering, atomic batch/readback behavior, and recovery from an ambiguous witness response. The
Kernel fails closed rather than inferring whether a side effect or acceptance batch committed. Those
properties belong in the supervised host integration and its evidence.

## Evidence

```bash
bash hooks/tests/owner-action-reconciliation.test.sh
bash hooks/tests/owner-action-hardening.test.sh
bash hooks/tests/owner-kernel-acceptance.test.sh
bash hooks/tests/owner-kernel.test.sh
bash hooks/tests/owner-kernel-adversarial.test.sh
bash hooks/tests/owner-kernel-cli.test.sh
```

The hardening tests cover broker-only and direct execution, independently bound host verifier/broker/executor/
receipt verifier/witness roles, nonce replay rejection, authority-header substitution, witness-head races,
two-stage permit/authorization binding, expiry and effect-time rejection, full witnessed-claim delivery,
compare-and-append failure before execution, cancellation acknowledgement reconciliation, commit-window
abort races, v1 pending-claim resume exclusion, v2 pending-claim `unknown` recovery without effect replay,
automatic-checkpoint regression, P1 compatibility, typed action challenge gating, coordinator-header
substitution rejection, atomic acceptance/complete batches, and challenge fail-closed behavior.
