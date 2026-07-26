# Frozen review rubric — Provider Readiness Orchestrator

Only the following criteria may admit a blocking plan finding.

- R1: Exact identity includes role, runner, model, effort, and endpoint/null.
- R2: Transport, live auth/quota, and role qualification are independent truth axes.
- R3: Missing/stale state triggers a bounded probe and is not treated as unavailable.
- R4: Probe is safe-first, then at most one minimal live request per exact tuple and TTL; credentials are never exposed.
- R5: Native Kimi read-only author/reviewer transport supports explicit `kimi-code/k3` mapping without asserting qualification.
- R6: L5/L6 intake checks every selected seat before implementation dispatch and names only eligible fallbacks.
- R7: Status CLI honestly reports present usability and preserves existing status subcommands.
- R8: Plan includes executable red/green tests for TTL, endpoint identity, redaction, Kimi transport, and early intake blocking.
- R9: Scope excludes review panel semantics and existing worktree lifecycle controls.

Next-slice readiness means a zero-context implementer can identify the files, contracts, phase
dependencies, commands, and expected results without choosing a new architecture.
