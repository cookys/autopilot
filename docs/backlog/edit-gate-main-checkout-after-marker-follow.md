# orchestrator-edit-gate stops gating the main checkout once the marker follows into a worktree

Source: the worktree-placement qc-gate review (2026-10-12), Suggestion 1, deferred as the owner's call. The review
record is `docs/plans/evidence/2026-10-12-worktree-placement/qc-gate.md` (moves under `docs/plans/_archive/` when
that plan is archived).

## What happens

`session-mode.js set --new-task` (or `set --size` …) run in a linked worktree of the same repo moves
`marker.repo_root` there (plan D5). `decide()` (`hooks/orchestrator-edit-gate-lib.js:81-97`, called from
`hooks/orchestrator-edit-gate.js:108-115`) gates a target
inside `repoRoot` or under a `.autopilot-worktree` marker; a path in the main checkout is now neither, so it takes
the "outside repo and worktrees ⇒ allow" branch. Before the marker followed, those edits were gated.

## Why it is deferred

The gate is opt-in, and the session has moved to the worktree on purpose. Whether depth-0 edits to the main checkout
should stay gated after that is a policy choice.

## Fix, if wanted

Treat the main checkout of `marker.repo_identity` (`scripts/resolve-repo-placement.js main`) as in-repo in
`decide()`, with a test for each direction.
