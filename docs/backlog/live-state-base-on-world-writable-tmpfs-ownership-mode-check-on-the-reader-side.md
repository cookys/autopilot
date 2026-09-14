# Live-state base on world-writable tmpfs — ownership/mode check on the reader side

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: autopilot runs on a multi-user host, or a second local user is observed on any fleet host; or the first report of a foreign `/dev/shm/autopilot-<uid>` directory.
- **Context**: v2.36.1 moved `context-budget`/`depth0-gate` state and the codeforge live files under `$XDG_RUNTIME_DIR/autopilot` (0700, safe) or `/dev/shm/autopilot-<uid>` / `/tmp/autopilot-<uid>` (parent `drwxrwxrwt`, name predictable, no pre-existing dir). A hostile local user could pre-create the dir and plant a fresh `context/<sid>.tasks.json` to deny a foreman's Bash (`foreman-guard.js`) or a depth-0 read (`depth0-delegate-gate.js` block mode). Readers check schema/freshness but not owner or mode. Fix shape: create the base with `mkdirSync(..., {mode: 0o700})`; reject a candidate whose `lstat` is a symlink, has a foreign uid, or `mode & 0o077`; same in codeforge `live.rs`. Cut from v2.36.1 (pre-merge review 🟡): shipped target is single-user dev hosts.
- **Effort**: S (both repos)
- **Source**: `docs/projects/_archive/2026-09-05-statusline-live-context-feed/` pre-merge review (opus), 2026-09-05

