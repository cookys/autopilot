# P3.5b Fail-Closed Shadow Admission

## Background

P3.5a proves that a root-installed host can deliver one signed owner-intake
envelope to a pinned verifier and obtain a hash-bound, non-authoritative
receipt. It deliberately does not run `AutopilotEngine`, construct an
`OwnerKernel`, hold a workspace descriptor, execute an action, or append an
independent witness.

The next safe step is not to call the existing Engine. Its ordinary loop owns
dispatcher, command, Git worktree, branch, cleanup, and repair-prompt seams.
Running it from a P3.5 receipt would create an unmediated effect path.

P3.5b therefore records only that the verified Engine bridge plan has been
admitted to a private, hash-only shadow projection. It is a durable diagnostic
record, not an Engine run and not a decision to run one.

## Design Decisions

1. The shadow consumer runs only inside the installed verifier after P3.3 and
   authenticated-intake verification succeed. It receives the in-memory
   compiled plan and receipts; it never accepts a caller-supplied path, state
   root, Engine adapter, or command.
2. The consumer persists a strict capsule containing only IDs and hashes:
   owner/Engine/invocation IDs; policy, contract, base, workspace, prompt,
   branch, and verification-command hashes; P3.3 ABI and sink inventory
   hashes; signed-intake provenance; and the installation binding. Raw prompt,
   envelope, bridge input, workspace path, branch, and command are never
   persisted or returned.
3. State is verifier-owned below the already validated `state_root`. A durable
   `pending` record is followed by atomically publishing `recorded` with
   no-replace semantics, then removing `pending`. Exact recorded input is
   idempotent. Same ID with different content, malformed/noncanonical data,
   symlinks, unexpected permissions, and state conflicts fail closed.
4. A startup sweep changes only durable pending records to
   `recovery_required`. It never completes a pending record, re-verifies an
   envelope, replays intake, starts an Engine, or creates a result. This is
   restart diagnosis, not automatic recovery.
5. The public verifier/gateway/host result exposes only a compact shadow
   summary. It is fixed to `owner_kernel_authority: "none"`,
   `effect_authority: "none"`, `broker_authority: "not_available"`,
   `acceptance: "not_available"`, and
   `witness_assurance: "local_verifier_state_not_independent_witness"`.
6. P3.2's same-UID lifecycle observer is not reused. P3.5b does not claim an
   independent witness, descriptor-pinned workspace, P2 authority adapter, or
   acceptance coordinator.

## Implementation Steps

1. Add an internal `supervised-shadow-engine-consumer.js` with strict capsule,
   record, state-file, idempotency, and fail-closed restart APIs.
2. Snapshot-pin that module in the root installer and invoke it only from the
   installed verifier after successful authenticated P3.3 validation.
3. Extend the verifier, gateway, and root host output validators in lockstep
   to carry a redacted shadow summary without changing authority semantics.
4. Add deterministic tests for exact binding, raw-data exclusion, idempotent
   record reuse, pending-crash recovery-required behavior, malformed/symlink
   state rejection, no Engine/Kernel/action imports, and installed-host output
   validation. Update the privileged live assertion to prove the compact
   result crosses the real host path.
5. Sync the Codex generated mirror, document the boundary, run focused and
   complete gates, then perform three-perspective review.

## Acceptance Criteria

1. A verified intake produces one deterministic private shadow record bound to
   the exact compiled bridge plan and authenticated receipt pair.
2. No source or runtime path calls `AutopilotEngine`, `OwnerKernel`, an action
   method, dispatcher, Git operation, shell command, or P2 witness API.
3. Recorded input is idempotent; stale `pending` input becomes only
   `recovery_required`, never `recorded` or an Engine terminal result.
4. All public output stays explicitly non-authoritative and contains no raw
   input or workspace locator.
5. The installed snapshot and Codex mirror both hash-pin the new consumer.

## Risks

- Local verifier state can be durable but is not an independent witness. A
  verifier or host compromise is outside its evidence claim.
- P3.3 still binds only a workspace path hash. P3.5b must not re-open that
  path or infer descriptor identity from it.
- P3.5a's one-shot public session has no receipt-recovery protocol. This work
  cannot turn a submitted but interrupted request into a completed outcome.

## Out of Scope

- Workspace registration, root-side descriptor binding, or reopening a
  workspace path.
- Independent cross-UID witness service, broker-held actions, Engine runtime
  execution, P2 authority/acceptance integration, P0 production corpus rerun,
  and alias retirement.

## Review Summary

| Perspective | Decision | Disposition |
| --- | --- | --- |
| Architect | Build a verifier-local, hash-only shadow consumer; avoid Engine and P2 adapters. | Adopted; final review SHIP with no findings. |
| Integration | Do not invoke the live Engine; bind any future workspace through a separate ticket/descriptor protocol. | Adopted as a deferred P3.5c gate; final review SHIP. The live host gate proves first admission only, while idempotency and crash recovery remain deterministic consumer coverage until P3.5c supplies retained ticket/witness end-to-end evidence. |
| Security | Pending state must never be promoted after restart; no root use of untrusted workspace paths or P3.2 witness promotion. | Adopted; pending becomes `recovery_required`; final review SHIP with no findings. |
