# mods P1a known follow-ups (hardening)

Source: P1a per-row reviews, three combined reviews, hand reports (2026-10-04); evidence `docs/plans/evidence/2026-10-04-mods-p1a/`. Items already fixed in the shipped code (fresh-bound candidate set, runs-live schema, repo_identity for `--project`, paths file kept on git failure, `--stop` exit confirmation, flock probe, idle-exit re-arm) are not listed.

- **Trigger**: P1b start (touches `src/status/runs-watch.js` and the renderer inputs).
- **Cursor file**: `<live>/runs-enrich-cursor.json` is read-modify-written by every `status runs` caller and every watcher with tmp+rename and no lock (last writer wins). Fail-open and bounded; fix is merge-on-save or a watcher-private probe map.
- **Heartbeat rows**: heartbeats republish `state.lastRuns`, so `elapsed_s` / `probe_age_s` / `observed_at` freeze between changes while `counts` stay current. Readers should derive elapsed from `started_at`; note it in `references/mods.md`.
- **Foreground launcher**: `launchUnderLock` waits in `spawnSync`; SIGTERM to the outer node is not forwarded, leaving the inner writer holding the lock. `--stop` still works.
- **Spawn errors**: `startWatcherDetached` reports `started` even when the async `spawn('nohup', ...)` fails (the `error` handler is a no-op). Preflight `nohup`/`sh` on PATH or wait for the `spawn` event.
- **flock message**: `flockAvailable` is false when `os.tmpdir()` is unwritable, so a TMPDIR problem prints `flock_unavailable`; pinned by `session-mode-watcher.test.sh` case 8.
- **Autostart**: only the literal `0` disables `AUTOPILOT_RUNS_WATCH_AUTOSTART`. Any JS test calling `session-mode.js set` without the env starts a real watcher (lib.sh covers shell suites); add a repo-wide grep gate or a test setup export. The watcher suite also has a short orphan window.
- **Identity sources**: `markerRepoIdentity` and `scopeFromCwd` are two sources for the same value; unify.
- **repo-identity.sh**: `REPO_IDENTITY_FIELDS` is not initialised at script top, so `declare -p` can return 1 if a detach precedes the first manifest write; an exported ambient `REPO_IDENTITY_FIELDS` would be copied verbatim (key the cache on the resolved dir). Diagnostic misattributes a non-repo cwd; JSON escape skips control characters; the manifest suite lacks a PID trap.
- **Clock**: `runs-fields.js` stamps probe `observed_at` with `Date.now()` while `probe_age_s` uses the injected `nowMs`; identical in production.
- **Roots set**: the watcher's roots set is unbounded (P3 owns the bound).
