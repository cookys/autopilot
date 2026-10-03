#!/usr/bin/env bash
# Tests for `session-mode.js set` starting the project watcher (mods plan P1a R5) plus the two R4 delta-review folds.
# Real watcher processes against a fixture repo and a fixture manifest dir. HOME, CLAUDE_CONFIG_DIR, XDG_RUNTIME_DIR,
# AUTOPILOT_LIVE_DIR (a /dev/shm tmpdir), AUTOPILOT_SESSION_MODE_DIR, AUTOPILOT_COSTS_FILE and
# AUTOPILOT_DISPATCH_RUNS_DIR all point under a mktemp dir: nothing touches the real ~/.autopilot, ~/.claude,
# /run/user/*/autopilot or the dispatch manifest dir. Every watcher this suite starts is killed BY PID in the trap.
. "$(dirname "$0")/lib.sh"

# RED at 95634d0c (unmodified base; set never starts a watcher, lib.sh has no autostart export, flockAvailable throws):
#   FAIL 13 of 33 assertions, e.g.
#   lib.sh exports AUTOPILOT_RUNS_WATCH_AUTOSTART=0 for every suite: expected '0', got '';
#   set starts a watcher: envelope with writer.pid appears within 15 s: expected 'yes', got 'no';
#   writer.pid holds fd 9 on the project lock: expected '<lock>', got '';
#   set after the writer was killed starts a new writer: expected 'yes', got 'no';
#   no flock on PATH: stderr names flock: expected 'yes', got 'no';
#   unwritable TMPDIR -> exit 2 flock_unavailable (no stack trace): expected '2', got '1';
#   state.lastRuns / final-publish fallback bound (case 9) errored on the fixture ident until fixed in the suite itself.
#   (AUTOSTART=0, non-repo and markerRepoIdentity-parity cases pass on base by accident: nothing starts a watcher.)

eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
# lib.sh must have exported the switch before this suite changes anything.
eq "0" "${AUTOPILOT_RUNS_WATCH_AUTOSTART:-}" "lib.sh exports AUTOPILOT_RUNS_WATCH_AUTOSTART=0 for every suite"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=1 # this suite is the one that wants a watcher

CLI="$REPO_ROOT/bin/autopilot.js"
SM="$REPO_ROOT/scripts/session-mode.js"
NODE="$(command -v node)"
SB="$TEST_TMP/smw"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"; RUNS="$SB/runs"; REPO="$SB/repo"; NONREPO="$SB/nonrepo"
AHOME="$FAKE_HOME/.autopilot"; MARKERS="$AHOME/session-mode"
mkdir -p "$AHOME" "$FAKE_CLAUDE/metrics" "$FAKE_XDG" "$RUNS" "$REPO" "$NONREPO"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-smw-XXXXXX)"; chmod 700 "$LIVE"
KILL_PIDS=""
cleanup_smw() {
  local p
  for p in $KILL_PIDS; do kill -9 "$p" 2>/dev/null; done
  rm -rf "$LIVE"
}
trap 'cleanup_smw; cleanup_test_tmp' EXIT
git -C "$REPO" init -q
git -C "$REPO" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init
KEY="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"
IDENT="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).repo_identity)' "$REPO_ROOT/src/status/project-key.js")"
LOCK="$LIVE/runs/$KEY.lock"
ENV_FILE="$LIVE/runs/$KEY.json"

wenv() {
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$MARKERS" AUTOPILOT_COSTS_FILE="$SB/costs.jsonl" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" CLAUDE_CODE_SESSION_ID="smw-session-1" ${WPATH:+PATH="$WPATH"} "$@"
}
envelope_pid() { # prints writer.pid of the published envelope, or empty
  node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(e.writer&&e.writer.pid)process.stdout.write(String(e.writer.pid))}catch(_){}' "$ENV_FILE"
}
wait_writer() { # waits (<=15 s) for an envelope with a writer pid that is not $1; sets W_PID
  local i
  W_PID=""
  for i in $(seq 1 150); do
    W_PID="$(envelope_pid)"
    [ -n "$W_PID" ] && [ "$W_PID" != "${1:-}" ] && break
    W_PID=""
    sleep 0.1
  done
  [ -n "$W_PID" ] && KILL_PIDS="$KILL_PIDS $W_PID"
}
count_watchers() { # exact argv scan of /proc (no pgrep -f: it would match its own shell)
  node -e '
    const fs = require("fs"); let n = 0;
    for (const d of fs.readdirSync("/proc")) {
      if (!/^[0-9]+$/.test(d)) continue;
      let a; try { a = fs.readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0"); } catch (_) { continue; }
      const i = a.indexOf("--project");
      if (a.includes("--watch") && a.includes("runs") && i !== -1 && a[i + 1] === process.argv[1]) n += 1;
    }
    process.stdout.write(String(n));' "$KEY"
}
lock_free_within() { # seconds -> 0 when `flock -n` got the lock in time, else 1
  local i n=$(( $1 * 10 ))
  for i in $(seq 1 "$n"); do
    flock -n "$LOCK" true 2> /dev/null && { echo 0; return; }
    sleep 0.1
  done
  echo 1
}
do_set() { # [repo] -> sets SET_RC, SET_OUT, SET_ERR
  (cd "$SB" && wenv "$NODE" "$SM" set --level l3 --repo-root "${1:-$REPO}" > "$SB/set.out" 2> "$SB/set.err" < /dev/null)
  SET_RC=$?
  SET_OUT="$(cat "$SB/set.out")"; SET_ERR="$(cat "$SB/set.err")"
}

# --- 1. set starts one watcher; it holds the lock itself (lock form ii) ----------------------------
do_set
eq "0" "$SET_RC" "set exits 0"
wait_writer
eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "set starts a watcher: envelope with writer.pid appears within 15 s"
FIRST_PID="$W_PID"
eq "$LOCK" "$(readlink "/proc/$FIRST_PID/fd/9" 2> /dev/null)" "writer.pid holds fd 9 on the project lock"
LOCK_INO="$(stat -c %i "$LOCK" 2> /dev/null)"
# /proc/locks names the pid of the (already exited) `flock 9` helper that took the lock on the shared open file
# description, NOT writer.pid; the holder is verified by fd above (references/mods.md "Watcher launch").
eq "yes" "$(grep -q ":$LOCK_INO " /proc/locks && echo yes || echo no)" "the project lock inode is in /proc/locks (held)"
eq "1" "$(count_watchers)" "exactly one watcher process after the first set"

# --- 2. second set while held: no second writer, holder pid printed ----------------------------------
do_set
eq "0" "$SET_RC" "second set exits 0"
eq "yes" "$([ -n "$FIRST_PID" ] && printf '%s' "$SET_ERR" | grep -q "pid $FIRST_PID" && echo yes || echo no)" "second set while held prints the holder pid"
sleep 1
eq "$FIRST_PID" "$(envelope_pid)" "second set leaves the same writer.pid"
eq "1" "$(count_watchers)" "still exactly one watcher after the second set"
eq "yes" "$(printf '%s' "$SET_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).ok===true?"yes":"no")}catch(_){process.stdout.write("no")}})')" "stdout stays one parseable JSON document"

# --- 3. kill the writer by PID -> lock free -> set again -> a new writer -----------------------------
kill -9 "$FIRST_PID" 2> /dev/null
eq "0" "$(lock_free_within 3)" "after killing the writer the lock is free"
do_set
wait_writer "$FIRST_PID"
eq "yes" "$([ -n "$W_PID" ] && [ "$W_PID" != "$FIRST_PID" ] && echo yes || echo no)" "set after the writer was killed starts a new writer"
eq "1" "$(count_watchers)" "one watcher after restart"

# --- 4. AUTOSTART=0 never starts a watcher ------------------------------------------------------------
kill -9 "$W_PID" 2> /dev/null
eq "0" "$(lock_free_within 3)" "lock free again before the AUTOSTART=0 case"
rm -f "$ENV_FILE"
AUTOPILOT_RUNS_WATCH_AUTOSTART=0 do_set
eq "0" "$SET_RC" "AUTOSTART=0: set exits 0"
sleep 2
eq "no" "$([ -n "$(envelope_pid)" ] && echo yes || echo no)" "AUTOSTART=0: no envelope appears"
eq "0" "$(count_watchers)" "AUTOSTART=0: no watcher process"

# --- 5. flock missing on PATH: set still succeeds, marker written, one stderr line ----------------------
mkdir -p "$SB/nopath"
for tool in node git; do ln -sf "$(command -v $tool)" "$SB/nopath/$tool"; done
rm -f "$MARKERS"/*.json
WPATH="$SB/nopath" do_set
eq "0" "$SET_RC" "no flock on PATH: set exits 0"
eq "1" "$(find "$MARKERS" -name '*.json' | wc -l | tr -d ' ')" "no flock on PATH: marker is written"
eq "yes" "$(printf '%s' "$SET_ERR" | grep -qi "flock" && echo yes || echo no)" "no flock on PATH: stderr names flock"
eq "0" "$(count_watchers)" "no flock on PATH: no watcher"

# --- 6. non-repo cwd: behaviour stays as before (Mission routing rejects it, rc 2; no marker, no watcher) ----
rm -f "$MARKERS"/*.json
do_set "$NONREPO"
eq "2" "$SET_RC" "non-repo: set is still rejected by Mission routing (rc 2, pre-existing)"
eq "0" "$(find "$MARKERS" -name '*.json' | wc -l | tr -d ' ')" "non-repo: no marker written"
eq "no" "$(printf '%s' "$SET_ERR" | grep -q "session-mode: watcher" && echo yes || echo no)" "non-repo: no watcher stderr line"
eq "0" "$(count_watchers)" "non-repo: no watcher"

# --- 7. markerRepoIdentity() == scopeFromCwd().repo_identity (main, linked worktree, symlink, non-repo) -----
git -C "$REPO" worktree add -q "$SB/repo-wt" -b wt-branch 2> /dev/null
ln -sfn "$REPO" "$SB/repo-link"
cat > "$SB/ident.js" <<'JS'
const sm = require(`${process.argv[2]}/scripts/session-mode.js`);
const { scopeFromCwd } = require(`${process.argv[2]}/src/status/project-key.js`);
const out = process.argv.slice(3).map((d) => sm.markerRepoIdentity(d) === scopeFromCwd(d).repo_identity);
process.stdout.write(out.every(Boolean) ? 'same' : `differ ${JSON.stringify(out)}`);
JS
eq "same" "$("$NODE" "$SB/ident.js" "$REPO_ROOT" "$REPO" "$SB/repo-wt" "$SB/repo-link" "$NONREPO")" "markerRepoIdentity == scopeFromCwd.repo_identity for main, linked worktree, symlink, non-repo"

# --- 8. R4 fold: unwritable tmpdir -> one-line flock_unavailable exit 2, not a stack trace -------------------
(cd "$REPO" && wenv TMPDIR="$SB/does/not/exist" "$NODE" "$CLI" status runs --watch --project "$KEY" > "$SB/tmp.out" 2> "$SB/tmp.err" < /dev/null)
eq "2" "$?" "unwritable TMPDIR -> exit 2 flock_unavailable (no stack trace)"
eq "yes" "$(grep -q flock_unavailable "$SB/tmp.err" && echo yes || echo no)" "unwritable TMPDIR: stderr names flock_unavailable"
eq "no" "$(grep -q "    at " "$SB/tmp.err" && echo yes || echo no)" "unwritable TMPDIR: no stack trace on stderr"

# --- 9. R4 fold: final-publish fallback uses the project-wide fresh bound, and lastRuns is maintained ------
cat > "$SB/fallback.js" <<'JS'
const R = process.argv[2];
const { createWatcher } = require(`${R}/src/status/runs-watch.js`);
const fs = require('fs');
const path = require('path');
const [key, cwd, ident] = [process.argv[3], process.argv[4], process.argv[5]];
const t = Date.parse('2026-10-04T12:00:00Z');
const row = (id, root) => ({ run_id: id, root_run_id: root, project: ident, phase: 'running', alive: true, probe_age_s: 5, ended_at: null, final_status: null });
const rows = [row('a1', 'root-1'), row('b1', 'root-2'), row('b2', 'root-2'), row('b3', 'root-2')];
const w = createWatcher({ key, cwd, collect: () => rows, now: () => t, interval: 10, enrichCap: 1 });
w.start();
w.tick();
const maintained = Array.isArray(w.state.lastRuns) && w.state.lastRuns.length === 4;
w.state.lastCounts.delete('root-1'); // force the envelope fallback path
w.finalPublish('stopped');
const e = JSON.parse(fs.readFileSync(path.join(process.env.AUTOPILOT_LIVE_DIR, 'runs', `${key}--root-1.json`), 'utf8'));
process.stdout.write(JSON.stringify({ maintained, bound: e.counts.fresh_bound_s, runs: e.runs.length }));
JS
rm -f "$LIVE/runs/$KEY"*.json
FB="$(wenv "$NODE" "$SB/fallback.js" "$REPO_ROOT" "$KEY" "$REPO" "$IDENT" 2> /dev/null)"
cj() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j[process.argv[1]]))})' "$2"; }
eq "true" "$(cj "$FB" maintained)" "state.lastRuns is a maintained project-wide row set after a tick"
eq "1" "$(cj "$FB" runs)" "root-1 scope file holds only its own row"
# project candidates 4, enrichCap 1, interval 10 -> bound 80; the root-1-only bound would be 20
eq "80" "$(cj "$FB" bound)" "final-publish fallback uses the project-wide fresh bound (80), not the scope-local one (20)"

finalize_test
