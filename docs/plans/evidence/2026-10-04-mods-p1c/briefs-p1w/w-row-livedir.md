# P1W row LIVEDIR — an explicit live-dir override is always honoured (owner 2026-10-05, plan R5.7)

Read `w-common.md` and `scripts/lib/live-state-dir.js` (header L1–30, `resolveLiveDir` ~L199–235) plus the leak report `/tmp/claude-1000/-home-cookys-projects-autopilot/df52a188-d763-4372-8a90-560abfbd4008/scratchpad/leak/REPORT.md`. Base: `w/int3`. Worktree `$P/wt-livedir`, branch `w/livedir`.

## Defect
`resolveLiveDir` skips a rejected `AUTOPILOT_LIVE_DIR` (not tmpfs/ramfs, unresolvable mount, symlink, unsafe perms) and falls through to `$XDG_RUNTIME_DIR/autopilot` / shm / `~/.autopilot`. A caller that set the override to isolate itself silently writes the REAL store (2026-10-05: a probe's detached watcher wrote 5 files into /run/user/1000/autopilot).

## Ruling
An explicit override is always used. Not RAM-backed → use it anyway and print one warning (stderr, once per process) naming the path and the reason. Security rejections stay rejections but FAIL CLOSED instead of falling through: a symlinked or unsafe override → the resolver throws/returns an error the caller reports, never another directory. Read the header's reasons for each rejection and classify each as "performance" (honour + warn) or "safety" (fail closed); list the classification in the report. The no-override path (XDG → shm → ~/.autopilot) is unchanged.

## Deliverables
1. The change in `live-state-dir.js` + header rewrite; every caller that can receive the new failure (grep `resolveLiveDir`) handles it fail-open for hooks (hook does nothing) and fail-closed for writers that would otherwise pick another dir (the watcher does not start; `session-mode.js set` still writes the marker but skips the watcher spawn with a message).
2. Tests (RED-first, mutations): ext4 override (use a dir on /tmp, which is ext4 on this host — detect and skip with a clear message if /tmp is tmpfs) → used + warning; symlink override → fail closed, nothing written anywhere else; no override → unchanged; the 2026-10-05 repro (plain `session-mode.js set` with an ext4 override in a temp repo, autostart on) → the watcher writes only under the override (or does not start) and `XDG_RUNTIME_DIR` (pointed at a scratch dir under /dev/shm) stays empty.
3. Consumers: `git grep -l -e resolveLiveDir -e live-state-dir` suites + L1 + `hooks/tests/lib.sh` users (lib.sh already gives each suite a /dev/shm dir — confirm nothing relied on the fall-through).
One commit `fix(live-state): an explicit AUTOPILOT_LIVE_DIR is honoured or refused, never silently replaced (mods P1W LIVEDIR)`. Report `$P/run-w/livedir/REPORT.md`.
