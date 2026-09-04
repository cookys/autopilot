# Decision — build Host Conformance first; no runtime redesign authorized

## Status

`READY_FOR_IMPLEMENTATION` for the conformance tool only.

Architecture migration remains undecided until the generated evidence report exists.

## Bounded review result

- R1: four independent attack reviews.
- One consolidation repair.
- R2 closure: `SHIP-AS-IS`, zero unresolved Critical/Major findings.
- Review loop is closed; no third review generation is allowed.

## Authorized implementation

Build:

```text
Autopilot Host Conformance
  - generator-owned projection inventory
  - honest host capability matrix
  - four-boundary Mission recovery matrix
  - root/Codex fail-closed semantic parity
  - fake Pi RPC steer/abort proof
  - typed autopilot.host-conformance.v1 report
```

Initial lifecycle budget:

```text
new long-lived processes: 0
new protocols/sockets: 0
new state stores: 0
new runtime dependencies: 0
new production packages: 0
```

## Not authorized

- local supervisor daemon;
- host bridge architecture;
- standalone Autopilot primary UI/runtime;
- Pi- or DSH-based primary harness migration;
- changes to Mnemos, CodeForge, Fuchikoma, Hangar, or hangar-bridge;
- production Option-A extraction before the conformance report names a specific deletable manual semantic duplicate.

## Architecture decision after evidence

- `keep-option-0`: fixtures pass; remaining differences are generated or genuinely host-specific. Keep current architecture and retain the new regression gate.
- `extract-option-a`: report identifies a manual host semantic duplicate. Open a separate plan that moves exactly that semantic to root core and deletes the named duplicate.
- `insufficient-evidence`: stop. Missing evidence does not authorize a larger architecture.

## Re-entry for larger designs

A supervisor service requires two real, evidenced recovery incidents that resumed CLI cannot safely reconcile. A Pi/DSH primary-runtime comparison requires a named required capability that Option 0/A cannot deliver and must identify the existing component it removes.
