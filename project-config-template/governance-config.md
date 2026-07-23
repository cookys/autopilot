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
    "max_blocked_duration_seconds": 86400
  }
}
```

The policy is frozen and content-addressed at intake together with the acceptance contract. Roster
entries must be real, verified attestations; replacing the example values with an unverified model label
does not create owner authority. A local JSONL file is not an authoritative witness. Autonomous
activation requires a host-resident external witness adapter and owner capability that are outside
every model and workspace process.
