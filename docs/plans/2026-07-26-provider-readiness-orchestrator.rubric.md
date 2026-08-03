# Frozen review rubric — Provider Readiness Orchestrator

Only the following criteria may admit a blocking plan finding.

- R1: Exact identity includes role, runner, model, effort, and endpoint/null.
- R2: Transport, live auth/quota, and role qualification are independent truth axes.
- R3: Missing/stale state triggers a bounded probe and is not treated as unavailable.
- R4: Probe is safe-first, then at most one minimal live request per exact tuple and TTL; credentials are never exposed.
- R5: Native Kimi is an optional post-core read-only transport with explicit `kimi-code/k3`
  mapping; it neither asserts qualification nor blocks readiness-core shipment.
- R6: PRO emits a content-bound exact-roster readiness receipt naming only eligible fallbacks; ICC
  alone consumes it at the effectful pre-spend intake.
- R7: Status CLI honestly reports present usability and preserves existing status subcommands.
- R8: Plan includes executable red/green tests for TTL, endpoint identity, redaction, receipt
  expiry/drift/blocking, plus separate optional Kimi transport tests.
- R9: Scope excludes review panel semantics, worktree lifecycle, campaign generation/engine wiring,
  Mission budget, and task closeout.
- R10: PRO consumes the shared mechanical runner envelope and owns only purpose-bound
  probe/readiness validation; native Kimi does not create another transport truth.

Next-slice readiness means a zero-context implementer can identify the files, contracts, phase
dependencies, commands, and expected results without choosing a new architecture.
