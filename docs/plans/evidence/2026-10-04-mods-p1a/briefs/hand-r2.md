# Row R2 — `project_key`, session-mode marker scope fields, live pointer
Worktree: /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/wt-r2  Branch: p1a/r2  Base: 532930ed
Plan text: §2.7 row "project（檔名用）", §2.8 bullets 1, 2 (writes (2) only — the marker; (1) envelope and (3)
`runs/paths` are R4's) and the pointer mechanism of bullet 3 (G2 R4), §3 file-map rows `src/status/project-key.js` and
`scripts/session-mode.js` (marker + pointer parts ONLY — the watcher launch and idle supersede are later rows).

Product:
- `src/status/project-key.js`: `projectKey(repo_identity)` → 16 lowercase hex (sha256 prefix); plus a helper that derives
  repo_identity from a cwd by calling the existing `task-runtime.js` `repoIdentity()` (do not reimplement git logic).
- `src/status/live-pointer.js`: `writeLivePointer({env, now})` writes `$HOME/.autopilot/live-pointer.json` atomically
  (tmp + rename) as `{schema:"autopilot.live-pointer/1", live_base:<resolveLiveDir() from scripts/lib/live-state-dir.js>,
  autopilot_home:"<HOME>/.autopilot", written_at}`; a reader `readLivePointer()` for tests/consumers. S2 showed HOME is
  available to the mod, so the repo-local fallback pointer is NOT built (record that in the report).
- `scripts/session-mode.js set`: marker gains additive `repo_identity`, `project_key`, and `root_run_id` (from
  `AUTOPILOT_ROOT_RUN_ID` when set, else null); `set` calls `writeLivePointer()`. Failures to derive identity → fields
  null, `set` still succeeds (fail-open). Existing marker readers must keep working with old markers (no new required field).

Tests (new, plan names): `hooks/tests/project-key.test.sh` (main worktree, symlink path, linked worktree, subdirectory →
same key; two repos → different keys; marker written by `set` has the three fields; old marker without them is still
read by existing readers) and `hooks/tests/live-pointer.test.sh` (`set` writes the pointer under the fake HOME; its
`live_base` equals `resolveLiveDir()` under the same env; atomic: no partial file on a forced failure if feasible).
The paths/*.json merge test of §2.8 belongs to R4 — skip it.

Allowed files: src/status/project-key.js (new), src/status/live-pointer.js (new), scripts/session-mode.js, their
platforms/codex/plugin mirrors (if mirrored), the two new tests. Consumer sweep must include every existing suite that
greps `session-mode.js` (there are several: autopilot-cli, dispatch-author-session-mode, dispatch-hetero, foreman-guard*,
…) — run them all.
Commit message: `feat(status): project_key, session-mode marker scope fields, and the live pointer (mods P1a R2)`
