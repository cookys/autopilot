# worktree-teardown-config — autopilot's own hetero-worktree cleanup

Repo-local override of [`project-config-template/worktree-teardown-config.md`](../project-config-template/worktree-teardown-config.md),
resolved by [`scripts/resolve-worktree-teardown.sh`](../scripts/resolve-worktree-teardown.sh).

Autopilot dogfoods its own dispatch rails; stale worktrees are reclaimed by the SessionStart
`repo-residue-sweep.js reap --auto --yes` hook (the former `--gc` / `stale_reaper_age_days`
rail-local reaper was removed at 3.0.0).

## Settings (one `key: value` per line; first match wins)

- teardown_hook:
- max_leaf_worktrees_per_root: 4

No `teardown_hook`: this repo provisions no root-owned build artifacts or named
volumes inside hetero worktrees, so `git worktree remove --force` reclaims everything.
