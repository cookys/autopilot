# Suite reaper — symlinked-TMPDIR hosts fall back to rm -rf (git-worktree-remove path never engages)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: first report of dangling `.git/worktrees` entries on a host with symlinked `/tmp`
  (e.g. macOS).
- **Context**: `_wt_is_registered_path` exact-string-compares realpath'd entry vs git's raw
  recorded path, so on symlinked TMPDIR the git remove path silently never engages (same
  behavior as pre-fix, not unsafe, just incomplete).
- **Effort**: S.
- **Source**: depth-0 qc panel 🔵, 2026-08-28.


