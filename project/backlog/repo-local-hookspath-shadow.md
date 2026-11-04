# A repo-local core.hooksPath into a lane worktree shadows the global lab hooks (BL-0395)

Source: PM, 2026-11-05 (approved).

## Problem
- On 2026-11-05 the main checkout's `.git/config` had a repo-local `core.hooksPath` pointing into a lane worktree (`.claude/worktrees/<lane>/.githooks`).
- Every push in every worktree then ran the hooks of that lane's checkout; if that lane worktree were removed or switched branch, the hooks would silently vanish or change.
- It also shadowed the global lab hooks (global `core.hooksPath` -> `~/.config/lab/git-hooks`, which chain to `<git-common-dir>/hooks/<name>`), so the lab checks did not run either.

## Fixed by hand that day
- The repo-local `core.hooksPath` was unset (the config was backed up first).
- `.git/hooks/{pre-commit,pre-push,pre-merge-commit,post-merge}` are now small wrappers that exec the current worktree's own `.githooks/<name>`.
- Verified with a throwaway worktree: lab pre-commit, commit-msg and pre-push run, and autopilot's pre-push (qc-gate) runs.

## Fix wanted (describe only, not implemented)
- `scripts/dev-setup.sh --check` (or a separate check) flags any `core.hooksPath` that points into `.claude/worktrees/`, or anywhere outside the repo's own `.githooks` and the global lab dir, with a red test (a planted bad path must turn it red).
- `scripts/install-hooks.sh` must not set a repo-local `core.hooksPath` that shadows a global one; it should install the wrappers into `<git-common-dir>/hooks/` instead.

## Notes
- Trigger: PM dispatch. Effort S.
