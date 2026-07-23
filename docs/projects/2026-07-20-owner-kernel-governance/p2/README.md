# P2 Action Authority

P2a implements a fail-closed action-authority protocol. It classifies an action before it reaches a host
boundary, binds the host capability verifier, executor, receipt verifier, and witness at intake, records a
durable claim before the side effect, and accepts only a reconciled receipt. It is intentionally narrower
than the full P2 acceptance transaction and is not yet wired into every Autopilot engine action sink; that
integration belongs to P3.

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
   fail closed, and another Kernel cannot resume the run. Failed, unknown, or pending outcomes cannot pass
   acceptance.

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

`requires_challenge` is fail-closed now: an action marked with it cannot run until P2b supplies the
qualified challenge-evidence path. P2b also owns the serializable acceptance transaction, exact contract
leg predicate, durable action-claim reconciliation/recovery and delegation transitions, and final
acceptance locking. P3 owns integration with the live `AutopilotEngine` action sinks and a real supervised
host/broker path.

P2a is a protocol-level boundary, not process-isolation proof or production acceptance. Its probe and
receipt callbacks are synchronous; a stalled adapter can block the Node event loop, so timeout and user
abort cannot preempt that callback. Production use therefore requires a trusted, bounded synchronous host
adapter today, and must not claim that descriptor fields alone prove IPC credentials, signed attestations,
or OS namespace separation. Those properties belong in the supervised host integration and its evidence.

## Evidence

```bash
bash hooks/tests/owner-action-reconciliation.test.sh
bash hooks/tests/owner-action-hardening.test.sh
bash hooks/tests/owner-kernel.test.sh
bash hooks/tests/owner-kernel-adversarial.test.sh
bash hooks/tests/owner-kernel-cli.test.sh
```

The hardening tests cover broker-only and direct execution, independently bound host verifier/broker/executor/
receipt verifier/witness roles, nonce replay rejection, authority-header substitution, witness-head races,
two-stage permit/authorization binding, expiry and effect-time rejection, full witnessed-claim delivery,
compare-and-append failure before execution, cancellation acknowledgement reconciliation, commit-window
abort races, durable pending-claim resume exclusion, automatic-checkpoint regression, P1 compatibility,
and challenge fail-closed behavior.
