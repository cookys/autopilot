# mods P1a known follow-ups (hardening)

Source: P1a per-row reviews, three combined reviews, hand reports (2026-10-04); evidence `docs/plans/evidence/2026-10-04-mods-p1a/`. Fixed 2026-10-16 and removed from this list: cursor-file merge-on-save, spawn-error preflight, autostart gate, heartbeat doc note, probe clock. Items already fixed in the shipped code (fresh-bound candidate set, runs-live schema, repo_identity for `--project`, paths file kept on git failure, `--stop` exit confirmation, flock probe, idle-exit re-arm) are not listed.

- **Trigger**: P1b start (touches `src/status/runs-watch.js` and the renderer inputs).
- **Foreground launcher**: `launchUnderLock` waits in `spawnSync`; SIGTERM to the outer node is not forwarded, leaving the inner writer holding the lock. `--stop` still works.
- **flock message**: `flockAvailable` is false when `os.tmpdir()` is unwritable, so a TMPDIR problem prints `flock_unavailable`; pinned by `session-mode-watcher.test.sh` case 8.
- **Identity sources**: `markerRepoIdentity` and `scopeFromCwd` are two sources for the same value; unify.
- **repo-identity.sh**: `REPO_IDENTITY_FIELDS` is now initialised in dispatch-hetero.sh (2026-10-16); still open: cache keyed on the resolved dir. Diagnostic misattributes a non-repo cwd; JSON escape skips control characters; the manifest suite lacks a PID trap.
- **Roots set**: the watcher's roots set is unbounded (P3 owns the bound).
