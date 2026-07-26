# Owner Kernel Governance Config

Place the resolved project policy in `.claude/owner-kernel-governance.json`. From a consuming
project, validate it through an explicit Autopilot source checkout or project-provided installed
copy: `node <autopilot-source>/scripts/owner-kernel.js resolve --config
.claude/owner-kernel-governance.json --check`. `<autopilot-source>` is a literal path, not an
assumed environment variable. A one-run mode override is passed to the caller and does not edit
this file.

`owner-led` keeps a qualified owner active across normal work. `milestone-led` replaces the
owner at plan, milestone, and acceptance boundaries. Neither mode is a human result-approval
gate. Human input is required only when the frozen policy class requires an exact approval.

`red_lines` is a canonical token list frozen with the policy. A compatibility invocation can add
tokens with `-x`, but it cannot remove or replace project tokens. `assurance_profile` reserves
the project default for the active Owner Kernel bridge: `standard` is the ordinary profile and
`conservative` requires legacy-equivalent independent challenge coverage once that bridge is live.
P3.0 shadow translation only records the selected profile; it does not make either profile an
action or acceptance authority.

`guidance_profile`, `topology_preference`, and `data_egress` are project defaults. A task authority
envelope may override them only for that task; assurance and egress overrides may narrow but never
weaken the project ceiling. Omitted fields resolve to `adaptive`, `conservative`, `auto`, and
`allowlisted`. Through P1 the effective payload still remains `guided`; profile choice cannot grant
a tool, effect, reviewer, or approval.

Freeze the project default plus an optional task override at intake, then pass only that frozen
envelope to the child role resolver:

```bash
node <autopilot-source>/scripts/owner-kernel.js freeze-task \
  --config .claude/owner-kernel-governance.json \
  --task task-authority-input.json --check

node <autopilot-source>/scripts/resolve-execution-profile.js grant \
  --envelope frozen-task-authority.json \
  --input role-grant-input.json
```

The first command owns project-policy resolution. The second command cannot read project config or
create a parent envelope; it can only narrow the supplied envelope. Both remain shadow/read-only
projections and do not write a ledger or perform an effect.

Host integrations that need a trusted chain use `OwnerKernel.freezeTaskAuthority()` and
`OwnerKernel.issueRoleGrant()`. The latter obtains eligibility, exact model identity, and scoped evidence
from the host-supplied `roleCapabilityVerifier`; callers cannot self-declare those fields.
`OwnerKernel.assertRoleGrantActive()` retrieves the exact witnessed grant and requires a complete live
observation from `roleCapabilityObserver`. Drift or expiry appends `role_grant_revoked` before it fails.

```json
{
  "schema_version": 1,
  "governance": {
    "default_mode": "owner-led",
    "red_lines": ["no-production-push", "no-secret-disclosure"],
    "assurance_profile": "conservative",
    "guidance_profile": "adaptive",
    "topology_preference": "auto",
    "data_egress": "allowlisted",
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

## Compatibility Translation (P3.0)

The public command is a pure mapping and has no ledger write path:

```bash
node <autopilot-source>/scripts/owner-kernel.js translate-level \
  --config .claude/owner-kernel-governance.json \
  --level l3 --expand -x no-delete --check
```

It returns source/target hashes, an inline/foreman/heterogeneous topology preference, the frozen
policy hash, and the monotonic effective red-line set. `--all` renders the four level mappings
without recording telemetry. `--solo` is valid only for `/l4` through `/l6`; it changes topology
to inline but cannot remove red lines.

Only an integrating host using `ShadowTranslationRuntime` can turn an `/l3` translation into a
witnessed `translation_used` event; the public CLI has no ledger write path. The adapter API
accepts an empty action catalog and a v1 ledger-only contract only; its result always says
`owner_kernel_authority: "shadow"` and `acceptance: "not_available"`. It is deliberately not a
generic CLI append operation, not a replacement for existing lifecycle rails, and not evidence
that AutopilotEngine acceptance or action sinks are Kernel-controlled. A `MemoryWitness` result is
machine-labelled `test_only_not_eligible_for_alias_retirement`; an external receipt is still not
alias-retirement evidence until the full P3 gate is complete.

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
    "requires_challenge": true,
    "blocked_by_red_lines": ["no-production-push"]
  }
]
```

Each `(operation, tool_class)` pair is unique. The Kernel hashes an exact command when required and only
accepts a finite, explicitly enumerated target set. An owner can raise a catalog action class but cannot
lower it. `requires_mediator` requires a broker-only host route. `requires_challenge` is valid only with
an acceptance-contract schema version 2: startup rejects a v1 contract because it cannot serialize the
candidate-manifest-bound challenge proof. Historical v1 ledgers can still replay, but cannot authorize
such an action. It requires a typed, qualified independent `action` challenge before the action executes.
`blocked_by_red_lines` is an optional exact token list; a matching frozen project or task red line removes
that catalog action from the task authority before any role grant can be considered.
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
