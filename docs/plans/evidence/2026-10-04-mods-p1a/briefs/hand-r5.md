# Row R5 — `session-mode.js set` starts the project watcher; `references/mods.md`
Worktree: /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/wt-r5  Branch: p1a/r5  Base: 95634d0c (R2 + R3 + R4 incl. repairs; already checked out)
Plan text (binding): §4 P1a bullet "誰起 watcher" (the `set` path), the "真實啟動路徑（S5b）" item of "驗收", §2.8 (pointer is
already written by `set` since R2), §3 file-map rows `scripts/session-mode.js` (watcher launch only — idle supersede is P3)
and `references/mods.md`. Evidence for the launch shape: docs/plans/evidence/2026-10-03-mods-spikes/S5b.md.

## Product
1. `scripts/session-mode.js set` starts the project watcher when the marker has a non-null `project_key`:
   - Foreground probe first: `flock -n <live>/runs/<project_key>.lock true`. Held → print one line naming the holder pid
     (from the existing envelope's writer.pid) and do not launch. Free → launch detached (`setsid nohup …`, stdio to the
     watcher log, `unref`) using the SAME launch definition R4 uses for `--watch` (export one helper from
     `src/status/runs-watch.js` if none exists; never a second copy of the command line). `flock` unavailable → one
     stderr line, `set` still succeeds.
   - Fail-open: any launch error is one stderr line; `set` exit code and marker are unchanged.
2. AUTOSTART SWITCH (BLOCKING safety): many existing suites (and L1 tests) call `session-mode.js set`. Unswitched, each
   would leave a detached watcher alive for up to 24 h and possibly write the real live dir. Add
   `AUTOPILOT_RUNS_WATCH_AUTOSTART` (`0` = never start). Export `AUTOPILOT_RUNS_WATCH_AUTOSTART=0` from
   `hooks/tests/lib.sh`, then enumerate every test that runs `session-mode.js set` WITHOUT sourcing lib.sh
   (`git grep -l "session-mode" -- 'hooks/tests/*.sh' '*.test.js'`) and set it there too. Prove it: after your full
   consumer sweep, `pgrep -af "status runs --watch"` (spell the pattern via a variable so pgrep does not match its own
   shell — see the pkill self-match trap) shows no new watcher, and no new files appear under /run/user/1000/autopilot/runs.
3. Follow-up from R2 review: `session-mode.js` has a pre-existing `markerRepoIdentity()` and R2 added `scopeFromCwd()`. If
   they derive the same value for main worktree, linked worktree and symlinked cwd, make `markerRepoIdentity()` delegate to
   `scopeFromCwd()` (one source); if they can differ, do NOT merge — document why in a comment and in your report.
4. `references/mods.md` (new, English): mod packaging in the plugin (`hooks/hooks.json` top-level `modules`, path relative
   to hooks.json, `../mods/<name>/register.ts` accepted — S1), the surface degradation table (terminal / desktop / -p; Image
   is terminal-only and unusable for an owner over ssh+tmux — S4), the data-supply contract (pointer at
   `<autopilot_home>/live-pointer.json`, mod resolution order marker → paths/*.json longest prefix → none, `$.fs` relative
   paths resolve against `$.session.cwd()` with no root confinement, `~` not expanded, errors carry no `code` — S2), the
   lifecycle facts (reload re-fires session.start, old timers dropped; `/clear` unverified — S5a), the watcher launch
   (lock form (ii); /proc/locks names the exited flock helper, verify by fd — S5b/R4), and links to the spike evidence. Keep
   it an index-shaped reference, ≤ the cap `node scripts/check-reference-sizes.js` enforces; register it wherever that
   checker or any references index requires.

## Tests (new, RED-first): `hooks/tests/session-mode-watcher.test.sh`
Fake HOME, AUTOPILOT_SESSION_MODE_DIR fixture, AUTOPILOT_LIVE_DIR on /dev/shm, a fixture git repo and fixture manifest dir;
this suite sets AUTOPILOT_RUNS_WATCH_AUTOSTART=1 explicitly. Cases: `set` → envelope appears within 2 ticks and
writer.pid holds an fd on the locked inode; second `set` while held → no second writer, holder pid printed; kill writer by
PID → `flock -n` free → `set` again → new writer; AUTOSTART=0 → no watcher; flock missing on PATH → set exits 0, marker
written, stderr line; non-repo cwd behaviour stays as before. Cleanup trap kills every watcher it started BY PID.

Allowed files: scripts/session-mode.js, src/status/runs-watch.js (only to export the launch helper), hooks/tests/lib.sh
(the one export line), the non-lib.sh tests found in step 2 (only the AUTOSTART line), references/mods.md (new), any
reference index the size checker requires, codex mirrors, the new suite. Consumer sweep: every suite/L1 that greps
`session-mode`, plus runs-watch, runs-watch-lock, project-key, live-pointer, status-runs-fields, and `node
scripts/check-reference-sizes.js`.
Commit: `feat(session-mode): set starts the project watcher behind an autostart switch; references/mods.md (mods P1a R5)`

## Also fold in (R4 delta-review 🔵, same file you already touch)
- `src/status/runs-watch.js` `flockAvailable`: move the `fs.mkdtempSync` inside the try so an unwritable tmpdir yields the
  one-line `flock_unavailable` exit 2, not a stack trace.
- The final-publish fallback `state.lastRuns || runs`: confirm `state.lastRuns` is a maintained field; if not, make the final
  publish use the same project-wide fresh bound as a normal tick (no scope-local fallback). Add one assertion each.
