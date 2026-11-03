# P1 Governance Core

P1 creates the durable governance substrate used before action mediation. It is deliberately narrow:
it resolves one project policy plus an optional one-run mode override, mints only typed witnessed events,
and reconstructs state and disclosure from the event ledger.

## Delivered Surface

- `src/engine/owner-kernel/`: canonical serialization, policy/contract freezing, typed event validation,
  principal capability, witnessed ledger, replay/checkpoint, approval validation, timeout, and disclosure.
- `scripts/owner-kernel.js`: read-only `resolve`, `verify`, `status`, and `disclose` commands. There is no
  generic event append or approval command.
- `schemas/owner-event.schema.json`: structural event schema; state-dependent authorization remains in
  the Kernel so a schema-only caller cannot mint authority.
- `project-config-template/governance-config.md`: project-default config and one-run override guidance.

## Trust Boundary

An authoritative run is constructed only with host adapters for authenticated user input, owner turns,
principal resolution, qualification, and an external witness. Every adapter response is bound to the
current run, and owner-turn/qualification responses are also bound to the active principal.

`MemoryWitness` is permanently test-only. It cannot be elevated through configuration. The read-only CLI
can verify a ledger's internal hash and receipt shape, but reports that production activation remains
blocked without an external witness adapter. A model process sharing the workspace or UID is not a trust
root; host process separation and P1's production broker integration remain required before activation.

## Deferred To P2/P4

- P2 owns action mediation, atomic approval-use consumption, contract-leg reconciliation, and the exact
  acceptance transaction. P1 records approval availability but never exposes a generic acceptance path.
- P4 replaces initial roster attestations with formal model-role scorecards. A model label alone cannot
  mint owner authority.

## Evidence

```bash
node scripts/owner-kernel.js resolve --config .claude/owner-kernel-governance.json --check
bash hooks/tests/owner-kernel.test.sh
bash hooks/tests/owner-kernel-cli.test.sh
bash hooks/tests/owner-kernel-adversarial.test.sh
```

The repository's [dogfood config](../../../../.claude/owner-kernel-governance.json) exercises policy
resolution only. Its identities are explicitly `pending-p4` and cannot activate an unattended run until
P4 qualification and the independent host witness/broker are present.

The negative controls cover forged capability objects, unverified user input, stale approvals after intent
supersession, hash tamper, cross-run replay, forged emitter kind, roster escape, forged runner evidence,
timeout abort, and qualification revocation.
