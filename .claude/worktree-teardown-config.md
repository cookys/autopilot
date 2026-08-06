# worktree-teardown-config — autopilot's own hetero-worktree cleanup

Repo-local override of [`project-config-template/worktree-teardown-config.md`](../project-config-template/worktree-teardown-config.md),
resolved by [`scripts/resolve-worktree-teardown.sh`](../scripts/resolve-worktree-teardown.sh).

**Why this repo overrides the shipped default.** The template ships
`stale_reaper_age_days: 0` (reaper off) because a consuming project should opt in
before anything reclaims its worktrees. Autopilot dogfoods its own dispatch rails
continuously, so it is the one repo that reliably produces orphan worktrees — on
2026-08-06 a cleanup found 4.4 GB of them, none of which any reaper had enumerated,
because the age reaper was never enabled here. The `--gc` path is marker-scoped and
`flock`-gated, so enabling it reclaims only dead, marked leaves.

Age is measured from the marker's `created_at`, not filesystem mtime. 14 days leaves
a long inspection window for a retained outcome that depth 0 has not dispositioned yet.

## Settings (one `key: value` per line; first match wins)

- teardown_hook:
- stale_reaper_age_days: 14
- reaper_scope: marker-only
- max_leaf_worktrees_per_root: 4

No `teardown_hook`: this repo provisions no root-owned build artifacts or named
volumes inside hetero worktrees, so `git worktree remove --force` reclaims everything.
