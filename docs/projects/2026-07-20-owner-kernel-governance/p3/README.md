# P3 Compatibility Activation

P3 is split deliberately. P3.0 is implemented as a safe migration prerequisite; full P3 remains
blocked until a supervised host bridge controls live engine action sinks and v2 acceptance. P3.0 is
not release activation: it deliberately leaves target v2.32.57, manifests, and CHANGELOG unchanged
until the full P3 gate clears.

## P3.0 Implemented

- `src/engine/owner-kernel/compatibility.js` is the deterministic source of truth for `/l3` through
  `/l6` translation. It has no Kernel, acceptance, transition, or public append dependency.
- `node <autopilot-source>/scripts/owner-kernel.js translate-level --config <path> --level <lN>` is
  read-only for consuming projects. `<autopilot-source>` is an explicit source checkout or
  project-provided installed copy, never an assumed environment variable. It resolves the frozen
  policy, maps topology, and returns source/target hashes; `--all` renders the complete table.
- `governance.red_lines` and `governance.assurance_profile` are frozen into the policy hash. `-x`
  may only add canonical red-line tokens.
- `ShadowTranslationRuntime` is an integrating-host, ledger-only `/l3` bridge API. It needs the
  same trusted input, owner, qualification, translation, and witness adapters as an Owner Kernel
  run; it is not exposed through the public CLI. It permits no action catalog, no action authority,
  no acceptance coordinator, and no v2 acceptance.
- The bridge hashes and verifies the exact source/target mapping before calling
  `kernel.recordTranslation()`. A retry with the same run, invocation, and source hash returns the
  existing witnessed event; restart/resume preserves that idempotence.

The resulting telemetry is explicitly `owner_kernel_authority: "shadow"`,
`legacy_execution_authority: "unchanged"`, and `acceptance: "not_available"`. Correct deployment
still has to keep the bridge and trusted adapters outside model/workspace reach; P3.0 does not
itself establish that OS/IPC boundary. A local test `MemoryWitness` is machine-labelled
`test_only_not_eligible_for_alias_retirement` and never counts toward alias deletion telemetry.

## P3.1 Observational Engine Sidecar

`src/engine/engine-lifecycle-observation.js` adds a narrow, opt-in sidecar for the existing
`AutopilotEngine.runImplementationReviewLoop()` path. A host must inject the adapter in code with
`new AutopilotEngine({ lifecycleObserver })` and explicitly bind one run through
`lifecycleObservation`; there is no general CLI flag and an injected observer without that explicit
context is not called.

- The context binds an engine run ID, invocation ID, a host-supplied policy hash, and exactly `/l5`
  or `/l6`. The sidecar checks the hash shape and binds it into the record, but does not resolve or
  validate that policy. The adapter receives an `open` envelope, ordered `appendIfHead` records,
  and a `close` terminal record. Every append and close must advance the adapter's observation head.
- The adapter must echo the request bindings in every response: run ID, invocation ID, and the
  envelope hash for `open`; plus sequence, prior observation head, and record or terminal hash for
  `appendIfHead` and `close`. A response that reuses a head already observed in the current session,
  or that does not exactly echo those bindings, fails or becomes partial telemetry rather than an
  ordered receipt chain.
- It observes sanitized lifecycle facts: hashes for the prompt, branch, runner/model identities,
  findings, raw-log reference, and unbounded ledger metadata; immutable Git commits and bounded
  status/verification fields remain explicit. It never transfers raw prompt text, branch names,
  findings, raw log paths, worktree paths, or dispatcher stdout/stderr.
- A malformed, unavailable, or stale observer response is reported as `failed` or `partial`
  telemetry but cannot change the legacy implementation, verification, review, worktree, merge, or
  terminal result. The adapter is therefore not an authoritative witness, action broker, or
  acceptance coordinator. Its callbacks are synchronous, so a production host must bound them: a
  non-returning callback can stall this Node process and is not contained by the sidecar.
- The terminal labels are `engine_converged`, `engine_blocked`, or `engine_non_converged`. The
  terminal record and returned sidecar status remain `owner_kernel_authority: "none"`,
  `legacy_execution_authority: "unchanged"`, `acceptance: "not_available"`, and
  `alias_retirement_eligible: false`. In particular, `converged` is never mapped to `accepted`.

This is an observability seam for a future supervised host, not evidence of authenticated IPC,
durable external witnessing, side-effect mediation, or v2 acceptance. It cannot be used to retire
aliases or satisfy the full P3 gate.

## Deferred Full P3 Gate

Do not reduce `/l4` through `/l6` to aliases yet. Their worktree isolation, strict dispatch
contracts, artifact boundary, depth-0 QC, merge, session marker, and recovery rails are currently
the active enforcement path. The current `AutopilotEngine` has no Owner Kernel action-sink bridge,
and P2 callback contracts are not a production supervised broker/witness/coordinator.

Full activation requires all of the following:

1. A Linux-scoped supervised host/broker with authenticated user/owner/translation IPC, durable
   external witness compare-and-append/batch/readback, bounded callbacks, restart recovery, and the
   complete P0 attack corpus re-run against it.
2. `AutopilotEngine` integration that maps intake, exact action descriptors, dispatch provenance,
   verification, independent challenge, audit reconciliation, abort, resume, and final manifest into
   one v2 Owner Kernel ledger. Existing `converged` is not `accepted`.
3. Active conservative policy enforcement in the Kernel predicate: legacy-equivalent qualified,
   independent panel coverage must be checked from frozen policy, never borrowed from the legacy
   flow as a bypass.
4. Low-risk dogfood before high-risk activation, a qualified challenger, KR8/KR10 evidence, and the
   plan's 14-day witnessed zero-use migration gate before removing aliases.

`hooks/tests/level-governance-translation.test.sh` covers the P3.0 table, monotonic red lines,
host-witnessed event shape, replay idempotence, and no-authority negative controls.
`hooks/tests/engine-lifecycle-observation.test.sh` covers P3.1's explicit host binding, ordered
compare-and-append observations, receipt-binding/replayed-head rejection, raw-data exclusion,
observer-failure containment, and the `converged`-is-not-`accepted` negative control.
