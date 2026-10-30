# Runs watcher aborts when the dispatch manifest directory is missing (BL-0336)

Reported 2026-10-31 by the llm-playground session on 4124gs (message 01M66YQ9Y3R3PC1DF2EK7HGXKH).

- Symptom: statusline shows `autopilot [unavailable · run: autopilot status runs --watch --project ...]` on a host that never dispatched.
- Cause: `status runs --watch` aborts at startup with "watcher startup failed: manifest directory does not exist: /tmp/autopilot-dispatch-runs"; autostart fails silently each time.
- Workaround: `mkdir -m700 /tmp/autopilot-dispatch-runs` (lost on reboot).
- Code: `src/status/runs-watch.js:1059` (startup check), `hooks/runs-watch-autostart.js` (autostart), statusline text "unavailable · run:" (mods/live locale and statusline renderers).
- Suggested fix: create the directory (0700) or treat a missing one as no manifests; surface the autostart failure reason in the statusline or an advisory.
- Order: after idlestate (stale-panel criterion) merges; peer was told.
