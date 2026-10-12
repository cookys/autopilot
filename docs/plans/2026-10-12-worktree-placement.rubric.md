# Rubric — 2026-10-12-worktree-placement.md

> Source plan: docs/plans/2026-10-12-worktree-placement.md

R1: C1 — a marker created in the main checkout and used from a linked worktree of the same repo measures E1 in that worktree; the plan's test is red at base and the D5 identity check keeps a different repo's cwd from taking over the marker.
R2: C2 — the base_ref rule (D6) is fully specified for local-behind, local-ahead, diverged and one-side-missing, needs no fetch, and each case has a test.
R3: C3 — the new-task advisory is advisory only (exit code unchanged), silent in the main checkout, and its token rule cannot fire on a matching worktree/branch pair.
R4: C4 — both handoff routes take their path from one resolver; manual is keyed by repo identity, /clear stays per worktree, the reason for the difference is stated, and the existing pinned /clear tests prove the key did not move.
R5: C5 — hetero, foreman and batch place worktrees under the real main checkout's .claude/worktrees/ also when called from a linked worktree (D1), with a stated fallback for bare / separate-git-dir layouts, and every reaper, registry entry and residue sweep still finds and reclaims them.
R6: C5 safety — the main-checkout fingerprint (D3), the orchestrator-edit-gate exemption (D7), the residue-sweep busy-skip (D10), the foreman-guard rm allowlist and consumer-repo untracked noise (D11) are each handled, and no rail round is discarded as main_checkout_mutated because of the move.
R7: C6 — every repo-tree walker that can run from the main checkout either skips .claude/worktrees/ or is shown unable to reach it.
R8: C7 — the rule is written in one reference doc, each backlog gap is marked fixed or deferred with a trigger, and the new script is wired per CLAUDE.md's four steps.
R9: Scope — D2 keeps fingerprint, identity, boundary and marker roots on the caller's toplevel; nothing outside the stated scope changes, and deferred items (gap 5, gap 8 wiring, scratch worktrees) are named.
R10: Order and evidence — each phase writes red tests first, runs suites one at a time, and has a verification row; the plan names every test whose assertion moves and why (including the vacuous leak check).
