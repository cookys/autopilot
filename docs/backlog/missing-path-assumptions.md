# Missing paths, files or tools abort or silently disable autopilot (BL-0336)

Reported 2026-10-31 by the llm-playground session on <host> (messages 01M66YQ9Y3R3PC1DF2EK7HGXKH, widened by the owner in 01M66YW3B1QS5VK0PNAA9JTBN0). Status: design first, owner reviews the design before any implementation.

Trigger example: the statusline shows `autopilot [unavailable · run: autopilot status runs --watch --project ...]` on a host that never dispatched. `status runs --watch` aborts with "watcher startup failed: manifest directory does not exist: /tmp/autopilot-dispatch-runs" (`src/status/runs-watch.js:1059`; autostart `hooks/runs-watch-autostart.js`), and autostart fails silently. Manual `mkdir -m700` is lost on reboot.

General problem: many places assume a path, file or tool already exists (`/tmp/autopilot-dispatch-runs`, `$TMPDIR`, `/run/user`, `~/.autopilot`, live and review directories, flock) and abort or silently stop working on a new host or after /tmp is cleared.

Direction:
1. Inventory every place that aborts or silently fails when something is absent.
2. A shared `ensureDir(path, mode)` helper: create missing directories instead of treating them as preconditions.
3. Autostart or watcher failure shows `unavailable: <reason>` in the statusline or an advisory.
4. `dev-setup.sh --check` or a doctor lists everything missing at once; regression test: with empty HOME and empty TMPDIR, SessionStart plus the watcher must self-create and not abort.
5. Prefer self-creation in code over boot-time setup; avoid systemd-tmpfiles unless necessary.
