# probe-unknown default memory dir misses the main checkout's memory from a worktree

Source: feat/mods-activity session, 2026-10-12.

- `scripts/probe-unknown.js` `defaultMemoryDir(root)` builds `~/.claude/projects/<slug>/memory` with
  `slug = root` and `/` replaced by `-`.
- From a worktree, `root` is the worktree path, so the slug is
  `-home-…-autopilot--claude-worktrees-<name>`, a dir that holds no memory. The session's real memory lives
  under the main checkout's slug.
- Fix direction: derive the slug from the main worktree (`git rev-parse --path-format=absolute
  --git-common-dir`, parent dir) when `root` is a linked worktree; keep an explicit `--memory-dir` winning.
