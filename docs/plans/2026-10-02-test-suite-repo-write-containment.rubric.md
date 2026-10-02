# Rubric — 2026-10-02-test-suite-repo-write-containment.md

> Source plan: docs/plans/2026-10-02-test-suite-repo-write-containment.md

R1: Containment claim is honest: the plan never claims the snapshot makes a real-repo write fail; every residual route to the real repo (absolute path, inherited GIT_DIR, standalone test run) is named with the layer that covers it.
R2: Snapshot write-through safety: no construction step can make a write inside the snapshot modify the real repo (no hardlinked working-tree files, no shared object dir, no worktree of the real repo, origin neutered).
R3: Snapshot fidelity: tests see the same code and the same ignored local state as an in-place run; any divergence (staged-only index state, refs not cloned) is named and justified against the §0.1 probe.
R4: The drift guard measures the REAL repo, not the snapshot, and its ignore list cannot hide the 2026-09-04 identity write.
R5: The test-identity rule is a single canonical copy, matches every fixture identity in the tree, and cannot match a real owner email.
R6: Commit-time gate covers every way a commit is created in the real repo (commit, merge commit) plus push of an already-made commit; its bypass cannot be inherited by a leaking test.
R7: Each phase is independently shippable with a RED-first test and an explicit negative control; P4 verification compares against the §0.1 baseline.
R8: Residue lifecycle: no snapshot, hetero worktree, or lock leaks after normal exit, interrupt, or failure, and the reaper ordering in G5 is consistent with how suite-residue-reap.sh decides liveness.
R9: Inversion: what guarantees failure? hardlinked copy, live origin, guard on the wrong repo, over-broad identity rule. Each is forbidden by a §2.5 line and asserted by a named test.
