Verdict: yes — the launch recipe `setsid nohup flock -n LOCK node STUB` (from Node `spawn({detached:true,stdio:'ignore'}).unref()`) works: envelope lands within 2 ticks, writer_pid holds the lock (via an inherited fd; /proc/locks shows the `flock` wrapper pid), a second launch starts no second writer, kill releases the lock, relaunch gives a new writer, and a watcher launched from inside a child claude's Bash tool survived claude's exit. Stub watcher only; (a) mod lifecycle is not in this hand's scope.

## Setup
- `scripts/lib/live-state-dir.js` honours `AUTOPILOT_LIVE_DIR` (first candidate, "override"; accepted only if tmpfs/ramfs — see its header). The stub reads $AUTOPILOT_LIVE_DIR directly; the tmpfs check was NOT exercised (fixture is under /tmp which is ext4 on this host).
- Files (artifacts/S5/): stub-watcher.js (writes $LIVE/runs/spikeproj.json {writer_pid, at} every 2 s, atomic rename), launch.js (the launcher: `spawn('setsid',['nohup','flock','-n',LOCK,'node',STUB,'spikeproj'],{detached:true,stdio:'ignore'}).unref()`, prints wrapper pid and exits), holder.sh (finds lock holders: inode from `stat`, matches /proc/locks, then scans /proc/<pid>/fd for that file), run-s5b.sh (the 5-step proof), inner-launch.sh + run-child.sh (in-claude case).
- Tools: /usr/bin/setsid, nohup, flock; node v24.16.0. Run: `/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/s5/run-s5b.sh`.

## Raw output of the 5-step proof (artifacts/S5/s5b-direct.txt, verbatim)
```
== (1) launch
launched wrapper pid 572781
{"writer_pid":572783,"at":"2026-10-03T14:03:48.536Z"}
writer_pid=572783
== (2) lock holder
lock inode=8813764
proc/locks: 20: FLOCK  ADVISORY  WRITE 572782 fc:00:8813764 0 EOF
fd-holder pid=572782 cmd=flock -n $WORK/s5/pro
fd-holder pid=572783 cmd=node $WORK/s5/stub-wa
cmd of writer_pid: node $WORK/s5/stub-watcher.js spikeproj   ppid=572782 sid= 572782
== (3) second launch while held
launched wrapper pid 577240
writer_pid after 2nd launch: 572783
direct foreground flock -n (what 'set' can use to detect holder):
flock rc=1 (1 = held)
s5/run-s5b.sh: line 16: /proc/574282/cmdline: No such file or directory
s5/run-s5b.sh: line 16: /proc/574301/cmdline: No such file or directory
s5/run-s5b.sh: line 16: /proc/577277/cmdline: No such file or directory
node processes running stub: "572753 ""572782 ""572783 "
== (4) kill writer
lock acquired after kill rc=0
flock rc=0
lock inode=8813764
== (5) relaunch
launched wrapper pid 583009
new writer_pid=583011 (old 572783)
lock inode=8813764
proc/locks: 1: FLOCK  ADVISORY  WRITE 583010 fc:00:8813764 0 EOF
fd-holder pid=583010 cmd=flock -n $WORK/s5/pro
fd-holder pid=583011 cmd=node $WORK/s5/stub-wa
cleanup flock rc=0
```

## Reading the proof
1. Envelope lands: `{"writer_pid":572783,"at":...}` 3 s after launch (launcher printed wrapper pid 572781 and exited at once; stdio ignored).
2. writer_pid == lock holder, with a NUANCE: `/proc/locks` lists the lock under pid **572782 = the `flock` process** (writer_pid 572783 is its child `node`). Both pids hold an fd on the lock file (inherited open file description, `fd-holder` lines), `ppid(writer)=572782`, and both are in the new session (sid 572782, from setsid). So "pid holding the lock" is true for node via fd inheritance, but a check that matches `/proc/locks` pid against `writer_pid` would FAIL (572782 != 572783). The plan's acceptance wording ("`writer.pid` is the lock-holding process") needs either: (a) the check = "writer_pid has the lock file open on an fd whose inode is the locked inode" (what holder.sh does), or (b) a launcher where node itself takes the lock (e.g. node opens the file and calls flock itself, or `sh -c 'exec 9>LOCK; flock -n 9 || exit 1; exec node STUB'`), making writer_pid the /proc/locks pid. Not built here.
3. Second launch while held: wrapper started, `flock -n` exited non-zero silently (stdio ignored), envelope's writer_pid stayed 572783, only one stub node process (572783) existed. The detached launcher cannot print anything; to print the holder, `set` must probe in the foreground first: `flock -n LOCK true` -> rc=1 means held (shown: `flock rc=1 (1 = held)`), then name the holder from the envelope's writer_pid or from /proc/locks (holder.sh method). Caveat: the foreground `flock -n LOCK true` probe itself briefly takes the lock when free (race with a concurrent launch is harmless: flock -n in the launcher just loses).
4. Kill writer: `kill 572783`; `flock -n LOCK` immediately succeeded (rc=0) and holder.sh showed no holder. (The `flock` wrapper exits when its child dies, so the lock is released with it.)
5. Relaunch: new writer_pid 583011 (old 572783), new lock holder pair 583010/583011, same lock inode.
Artifact noise: three `/proc/<pid>/cmdline: No such file` lines are my own scan racing short-lived processes.

## Realistic case: launch from inside a child claude's Bash tool
No --plugin-dir (the point is CC's own Bash tool), model haiku, `--allowedTools Bash`, fake HOME/CLAUDE_CONFIG_DIR, AUTOPILOT_SESSION_ID unset (run-child.sh):
```
cd $WORK/proj ; claude -p "Run exactly this one shell command with the Bash tool and then reply with the word done: bash $WORK/s5/inner-launch.sh" --model claude-haiku-4-5-20251001 --max-budget-usd 0.05 --no-session-persistence --allowedTools Bash
```
Output (artifacts/S5/s5b-child-run.txt): `child start 15:20:36Z` / `child exit rc=0 at 15:20:45Z`; stdout `done`. The debug log (full: $WORK/s5/debug-child.log) shows `tool_dispatch_start tool=Bash ... permissionDecisionMs=19` and `tool_dispatch_end tool=Bash outcome=ok durationMs=198` — the model ran the launcher. After claude exited:
```
{"writer_pid":654873,"at":"2026-10-03T15:20:49.458Z"}      (4 s after claude exit; date was 15:20:50Z)
proc/locks: 1: FLOCK ADVISORY WRITE 654872 ... ; fd-holder pid=654872 (flock) and pid=654873 (node stub)
```
and 25 s later still ticking (`at 15:21:09.479Z`, `ps`: pid 654873 ppid 654872 sid 654872 elapsed 26 s). Killed by PID (`kill 654873`), then `flock -n LOCK true` rc=0, and no stub-watcher processes remain.
CC sandbox: the child's settings were the defaults of a fresh CLAUDE_CONFIG_DIR; nothing in the debug log mentions a sandbox and setsid/flock ran without error, so there was no blocking — but that says nothing about a user who has CC's sandbox enabled (not tested).

## Cleanup
All started processes killed by PID (none remain: `ps -eo pid,cmd | grep "[n]ode .*stub-watcher"` -> 0). $WORK/s5/project.lock and live fixture remain under $WORK only. /run/user/1000/autopilot/spike-s2 removed.

## Does NOT prove
- The real `session-mode.js set` / project watcher (do not exist yet); only a stub with the same launch shape.
- Behaviour with CC's sandbox ON, under systemd user-scope cgroup kill (a session end that kills the whole cgroup would also kill a setsid'd child; here it did not, but this host's claude -p exit does not do that), on macOS/Windows (no setsid/flock by default), or after host reboot.
- The AUTOPILOT_LIVE_DIR tmpfs acceptance rule, envelope schema, idle-exit or heartbeat logic.
- That the detached watcher survives interactive session /exit or desktop app close (only `-p` exit tested).
- S5(a) (mod `$.clock.every` rebuild / session.end cleanup): not run by this hand.
