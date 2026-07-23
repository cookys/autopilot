# Owner Kernel Governance Config

Place the resolved project policy in `.claude/owner-kernel-governance.json`.
Use `node scripts/owner-kernel.js resolve --config .claude/owner-kernel-governance.json --check`
to validate it. A one-run mode override is passed to the caller and does not edit this file.

`owner-led` keeps a qualified owner active across normal work. `milestone-led` replaces the
owner at plan, milestone, and acceptance boundaries. Neither mode is a human result-approval
gate. Human input is required only when the frozen policy class requires an exact approval.

```json
{
  "schema_version": 1,
  "governance": {
    "default_mode": "owner-led",
    "owner_roster": [
      {
        "identity": "qualified-owner-a",
        "model_alias": "owner-model",
        "model_version": "pinned-version",
        "family": "provider-family",
        "runner": "host-owner-adapter",
        "role": "owner",
        "attestation": {
          "issuer": "project-attestation-issuer",
          "uri": "https://attestation.example/owner-a",
          "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
          "issued_at": "2026-01-01T00:00:00.000Z",
          "expires_at": "2026-12-31T00:00:00.000Z"
        }
      }
    ],
    "challenger_roster": [
      {
        "identity": "qualified-challenger-a",
        "model_alias": "challenger-model",
        "model_version": "pinned-version",
        "family": "independent-provider-family",
        "runner": "host-challenge-adapter",
        "role": "challenger",
        "attestation": {
          "issuer": "project-attestation-issuer",
          "uri": "https://attestation.example/challenger-a",
          "sha256": "1111111111111111111111111111111111111111111111111111111111111111",
          "issued_at": "2026-01-01T00:00:00.000Z",
          "expires_at": "2026-12-31T00:00:00.000Z"
        }
      }
    ],
    "trusted_runner_roster": [
      {
        "identity": "trusted-runner-a",
        "model_alias": "runner",
        "model_version": "pinned-version",
        "family": "host",
        "runner": "owner-kernel-executor",
        "role": "trusted_runner",
        "attestation": {
          "issuer": "project-attestation-issuer",
          "uri": "https://attestation.example/runner-a",
          "sha256": "2222222222222222222222222222222222222222222222222222222222222222",
          "issued_at": "2026-01-01T00:00:00.000Z",
          "expires_at": "2026-12-31T00:00:00.000Z"
        }
      }
    ],
    "approval_policy": {
      "read_only": { "requires_approval": false, "max_uses": 1 },
      "reversible": { "requires_approval": false, "max_uses": 1 },
      "external": { "requires_approval": true, "max_uses": 1 },
      "irreversible": { "requires_approval": true, "max_uses": 1 }
    },
    "capability_ttl_seconds": 3600,
    "checkpoint_interval_closed_events": 100,
    "max_blocked_duration_seconds": 86400,
    "max_recover_cycles": 3,
    "max_delegate_per_decision": 3,
    "action_catalog": []
  }
}
```

The policy is frozen and content-addressed at intake together with the acceptance contract. Roster
entries must be real, verified attestations; replacing the example values with an unverified model label
does not create owner authority. A local JSONL file is not an authoritative witness. Production autonomous
activation requires a host-resident external witness adapter and owner capability outside every model and
workspace process; P2a callback descriptors alone cannot prove that deployment property.

## Action Catalog

Leaving `action_catalog` empty preserves the ledger-only P1 surface. A non-empty catalog opts the run into
P2 action authority and requires a trusted host to inject `actionAuthority` when it starts or resumes the
Kernel. Configuration alone never grants that authority.

```json
"action_catalog": [
  {
    "id": "deploy-production",
    "operation": "deploy",
    "tool_class": "network",
    "action_class": "irreversible",
    "command_required": true,
    "requires_mediator": true,
    "requires_challenge": true
  }
]
```

Each `(operation, tool_class)` pair is unique. The Kernel hashes an exact command when required and only
accepts a finite, explicitly enumerated target set. An owner can raise a catalog action class but cannot
lower it. `requires_mediator` requires a broker-only host route. `requires_challenge` is valid only with
an acceptance-contract schema version 2: startup rejects a v1 contract because it cannot serialize the
candidate-manifest-bound challenge proof. Historical v1 ledgers can still replay, but cannot authorize
such an action. It requires a typed, qualified independent `action` challenge before the action executes.
The challenge is bound to the frozen action descriptor hash and to the candidate manifest from the latest
complete coordinator audit that covers the current action footprint. A clear finding for an older or
different manifest cannot mint or execute the action; a blocking finding vetoes execution.
A clear finding must remain current when it is used. A blocking action finding that was qualified when
witnessed remains a durable veto for its frozen intent, descriptor, and candidate tuple; challenger expiry
cannot turn it into an authorization bypass.

The injected authority must provide a current content-addressed host-capability descriptor, nonce-bound
host capability verifier, independently identified and attested receipt verifier and executor, and an
external witness with `getHead()` plus atomic `appendIfHead()`. Their identity and attestation hashes are
frozen independently; a broker adds its own distinct identity, attestation, descriptor UID pair, protocol
version, revocation capability, and receipt root.

Before every host action, the verifier issues an opaque short-lived preclaim permit bound to the run,
proposed claim, witness head, capability, descriptor, executor, and boundary audience. After the witnessed
`action_claim`, it issues an opaque one-shot postclaim authorization bound to the exact claim event. The
direct executor or broker receives the full witnessed claim plus both raw bearer values and must atomically
consume or revoke them at its durable effect boundary. Receipts and independent verification bind their
hashes, effect ID/state/time, and cancellation acknowledgement; raw bearer values do not enter the ledger.
An unresolved host claim blocks control-plane changes. For a schema-v2 acceptance run, resume asks a
separately bound receipt-reconciliation adapter to settle the old claim as `unknown`; it never retries the
side effect or receives the original raw permit/authorization. A second typed receipt reconciliation must
then establish the final outcome before acceptance can continue. A schema-v1 action ledger remains
non-resumable while its claim is pending.

These are P2a protocol checks, not evidence that callback code is outside the model/workspace process or
that a UID/attestation hash proves OS or IPC isolation. A production authority needs a trusted, bounded host
adapter to enforce those properties; the current synchronous probe cannot be preempted by Kernel timers.

## Serializable Acceptance Contract

Schema version 2 opts a run into serializable acceptance. Version 1 ledgers remain replayable for
compatibility, but `accept()` is unavailable for them because their artifact-hash shape cannot bind a final
delivery snapshot.

```json
{
  "schema_version": 2,
  "contract_id": "release-artifact",
  "artifacts": [
    { "id": "workspace", "target": "dist/workspace.tar" }
  ],
  "legs": [
    {
      "id": "tests",
      "kind": "executable",
      "command": "node --test",
      "artifact_ids": ["workspace"]
    },
    {
      "id": "design-review",
      "kind": "non_executable",
      "artifact_ids": ["workspace"]
    }
  ]
}
```

`kind` is mechanically derived: a leg with `command` is `executable`; one without it is
`non_executable`. Artifacts and targets are finite and non-wildcard. The host injects an
`acceptanceAuthority` separately from project JSON. It must be independent from the action verifier,
executor, receipt verifier, broker, and witness, and exposes `acquire()`, `commit()`, `requestAbort()`,
`cancel()`, `resolveAttempt()`, synchronous `verifyCommit()` / `verifyResolution()`, and `release()` for
a fenced, host-owned candidate/delivery lease.

The coordinator snapshot binds the run, transaction ID, fence, exact candidate and delivered manifests,
audit head, current event head, current witness head, timestamp, and snapshot hash. Candidate and delivered
manifests must match exactly. The witness must additionally implement atomic `appendBatchIfHead()`; only an
atomic `acceptance` plus `complete` pair is terminal. The complete acceptance-authority header, including
its witness binding, is hashed into every schema-v2 event, so replacing a coordinator header cannot replay
an unfinished ledger under another coordinator.

Acceptance requires a clear qualified challenge for every schema-v2 leg and green trusted verification for
every executable leg, no blocking challenge, a complete coordinator-bound audit reconciliation, no
pending or unreconciled action claim, the exact final artifact manifest, an active qualified owner, and no
authenticated abort request. Generic evidence and self-review are advisory only.

The coordinator/witness adapter is a trusted protocol boundary, not a proof of process isolation. It must
enforce lease expiry, durable control ordering, and atomic batch/readback semantics outside the model
process. If an acquire or batch result is ambiguous, the Kernel does not guess or replay the side effect;
the host must recover from its durable witness/ledger record before another attempt.
