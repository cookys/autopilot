# Frozen Rubric — Dispatch Worktree Lifecycle Budget

- R1: The plan accurately identifies the current control surfaces and the concrete gap that allowed one logical project to accumulate retained worktrees and process branches.
- R2: The plan defines a race-safe per-root worktree occupancy cap enforced before creation without deleting live, dirty, unsupported, malformed, legacy, or foreign-owned state.
- R3: The plan defines safe immediate and closeout-time worktree reclamation with exact identity, liveness, cleanliness, revalidation, and branch-tip preservation.
- R4: The plan emits a content-bound lifecycle receipt; missing, dirty, live, unknown, raced, moved, or stale state can never be represented as zero residue.
- R5: ICC alone owns implementation/review generations, while LSM alone computes `can_close` and clears finish state; WLB records campaign/loop IDs only as resource provenance.
- R6: The test strategy includes executable positive oracles and negative controls for concurrency, liveness, dirty state, malformed/legacy markers, exact branch containment, races, stale receipts, and LSM consumption.
- R7: The plan is implementable in bounded phases, preserves direct-dispatch backward compatibility, and excludes unrelated worktrees, dirty auto-deletion, and uncontained branch deletion.
- R8: The file map and documentation work cover only canonical resource lifecycle scripts/config,
  L5/L6 propagation, receipts, references, and validation commands; it does not modify engine
  generation state or finish-flow.
