# Frozen review rubric — L6 Status, Merge, and Honest Closeout Contract

Only the following criteria may admit a blocking plan finding.

- R1: Task status includes acceptance, blockers, deferred count, candidate, integration, push, owned worktrees/branches, `can_merge`, and `can_close`.
- R2: Product merge, consumer update, push, and zero residue remain independent states.
- R3: Ownership comes from lifecycle ledger/journal only; missing evidence fails close.
- R4: Merge intent is ordered, exact, hash-sealed, and includes forbidden reverse edges.
- R5: Preflight accounts for staged, unstaged, and untracked target changes and incoming paths.
- R6: Status/preflight are read-only; execution requires the seal and excludes push/deletion.
- R7: Finish-flow cannot clear terminal state while any close predicate is false.
- R8: Default human output is plain `DONE|NOT DONE` plus blocker/next action.
- R9: Existing status subcommands stay compatible.
- R10: Tests cover residue, dirty overlap, reverse direction, SHA drift, and false-clean reporting.

Next-slice readiness means the implementer does not need to invent status predicates, merge direction
semantics, preservation scope, or finish integration.
