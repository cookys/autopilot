#!/usr/bin/env bash
# Tests for the runs watcher's single-writer lock (mods plan P1a R4a, plan §4 P1a "鎖的前提與退路").
# Real watcher processes against a fixture repo and fixture manifest dir. HOME, CLAUDE_CONFIG_DIR,
# XDG_RUNTIME_DIR, AUTOPILOT_LIVE_DIR (a /dev/shm tmpdir), AUTOPILOT_SESSION_MODE_DIR and
# AUTOPILOT_DISPATCH_RUNS_DIR all point under a mktemp dir: nothing touches the real ~/.autopilot,
# ~/.claude, /run/user/*/autopilot or the dispatch manifest dir. Every background process is killed
# BY PID in the cleanup trap.
. "$(dirname "$0")/lib.sh"

# RED at c51f901f (unmodified base; no src/status/runs-watch.js, `status runs --watch` -> 'unknown status argument'):
#   FAIL 17 of 26 assertions, e.g.
#   envelope with writer.pid appears within 15 s: expected 'yes', got 'no';
#   lock held while the writer lives (flock -n fails): expected '1', got '66';
#   writer.pid holds fd 9 on the lock file (lock form ii): expected '<lock>', got '';
#   second watcher exits 0: expected '0', got '2'; kill -9 writer -> flock -n succeeds within 1 s: expected '0', got '1';
#   the writer spawned a live long-lived child: expected 'yes', got 'no';
#   stderr names flock_unavailable: expected 'yes', got 'no';
#   --stop with the envelope pid swapped to another process -> exit 1: expected '1', got '2';
#   final publish exit_reason is stopped: expected 'stopped', got ''.
#   (9 pass on base by accident: e.g. 'PATH without flock -> exit 2' because the unknown flag also exits 2.)

eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
CLI="$REPO_ROOT/bin/autopilot.js"
NODE="$(command -v node)"
SB="$TEST_TMP/runswl"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"; RUNS="$SB/runs"; REPO="$SB/repo"
mkdir -p "$FAKE_HOME/.autopilot" "$FAKE_CLAUDE" "$FAKE_XDG" "$RUNS" "$REPO"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-runswl-XXXXXX)"; chmod 700 "$LIVE"
KILL_PIDS=""
cleanup_wl() {
  local p
  for p in $KILL_PIDS; do kill -9 "$p" 2>/dev/null; done
  rm -rf "$LIVE"
}
trap 'cleanup_wl; cleanup_test_tmp' EXIT
git -C "$REPO" init -q
KEY="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"
LOCK="$LIVE/runs/$KEY.lock"
ENV_FILE="$LIVE/runs/$KEY.json"

wenv() { # command... : run with the fully isolated environment
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$FAKE_HOME/.autopilot/session-mode" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" "$@"
}
start_watcher() { # [PATH override] -> launcher pid in W_LAUNCHER
  (cd "$REPO" && wenv ${1:+PATH="$1"} "$NODE" "$CLI" status runs --watch --project "$KEY" --interval 1 \
    > "$SB/w.out" 2> "$SB/w.err" < /dev/null & echo $! > "$SB/w.launcher")
  W_LAUNCHER="$(cat "$SB/w.launcher")"; KILL_PIDS="$KILL_PIDS $W_LAUNCHER"
}
wait_envelope() { # waits (<=15 s) for a published envelope with a writer pid; sets W_PID
  local i
  W_PID=""
  for i in $(seq 1 150); do
    W_PID="$(node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(e.writer&&e.writer.pid)process.stdout.write(String(e.writer.pid))}catch(_){}' "$ENV_FILE")"
    [ -n "$W_PID" ] && break
    sleep 0.1
  done
  [ -n "$W_PID" ] && KILL_PIDS="$KILL_PIDS $W_PID"
}
lock_free_within() { # seconds -> echo 0 if `flock -n` got the lock within the budget, else 1
  local i n=$(( $1 * 10 ))
  for i in $(seq 1 "$n"); do
    flock -n "$LOCK" true && { echo 0; return; }
    sleep 0.1
  done
  echo 1
}

# --- 1. a live writer holds the lock; it is the process the envelope names ----------------------
start_watcher
wait_envelope
eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "envelope with writer.pid appears within 15 s"
flock -n "$LOCK" true; eq "1" "$?" "lock held while the writer lives (flock -n fails)"
LOCK_INO="$(stat -c %i "$LOCK")"
eq "$LOCK" "$(readlink "/proc/$W_PID/fd/9" 2>/dev/null)" "writer.pid holds fd 9 on the lock file (lock form ii)"
eq "yes" "$(grep -q ":$LOCK_INO " /proc/locks && echo yes || echo no)" "the lock inode is in /proc/locks"
eq "yes" "$(tr '\0' ' ' < "/proc/$W_PID/cmdline" | grep -q "status runs --watch --project $KEY" && echo yes || echo no)" "writer cmdline is 'status runs --watch --project <key>'"

# --- 2. second watcher, same project -> writer_busy, exit 0, names the holder -----------------------
OUT="$( (cd "$REPO" && wenv "$NODE" "$CLI" status runs --watch --project "$KEY" --interval 1 2>"$SB/b.err" < /dev/null) )"
eq "0" "$?" "second watcher exits 0"
case "$OUT" in *writer_busy*"pid $W_PID"*) eq ok ok "second watcher prints writer_busy with the holder pid" ;; *) eq "writer_busy ... pid $W_PID" "$OUT" "second watcher prints writer_busy with the holder pid" ;; esac
eq "$W_PID" "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).writer.pid))' "$ENV_FILE")" "first writer still owns the envelope"

# --- 3. kill -9 the writer -> the lock is free within 1 s ----------------------------------------
kill -9 "$W_PID"
eq "0" "$(lock_free_within 1)" "kill -9 writer -> flock -n succeeds within 1 s"

# --- 4. writer spawns a long-lived child (via a PATH git shim), then dies -> lock still released ----
SHIM="$SB/shim"; mkdir -p "$SHIM"
REAL_GIT="$(command -v git)"
cat > "$SHIM/git" <<SH
#!/bin/sh
# every 'worktree list' the watcher runs leaves a long-lived detached child behind
if [ "\$1" = worktree ]; then
  sleep 300 > /dev/null 2>&1 < /dev/null &
  echo \$! >> "$SB/children.pids"
fi
exec "$REAL_GIT" "\$@"
SH
chmod +x "$SHIM/git"
rm -f "$SB/children.pids" "$ENV_FILE"
start_watcher "$SHIM:$PATH"
wait_envelope
eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "shim run: envelope appears"
sleep 0.5
CHILD="$(head -1 "$SB/children.pids" 2>/dev/null)"
[ -n "$CHILD" ] && KILL_PIDS="$KILL_PIDS $(cat "$SB/children.pids" | tr '\n' ' ')"
eq "yes" "$([ -n "$CHILD" ] && kill -0 "$CHILD" 2>/dev/null && echo yes || echo no)" "the writer spawned a live long-lived child"
LEAK=no
for fdl in /proc/$CHILD/fd/*; do [ "$(readlink "$fdl" 2>/dev/null)" = "$LOCK" ] && LEAK=yes; done
eq "no" "$LEAK" "the child holds no fd on the lock file (fd 9 not inherited)"
kill -9 "$W_PID"
eq "0" "$(lock_free_within 1)" "writer killed while its child lives -> lock still released within 1 s"
eq "yes" "$(kill -0 "$CHILD" 2>/dev/null && echo yes || echo no)" "the child outlived the writer (so the release was not child death)"
for p in $(cat "$SB/children.pids"); do kill -9 "$p" 2>/dev/null; done

# --- 5. flock(1) missing -> flock_unavailable, exit 2, no lock file ------------------------------------
NOFLOCK="$SB/noflock-bin"; mkdir -p "$NOFLOCK"
for t in node sh git; do ln -sf "$(command -v $t)" "$NOFLOCK/$t"; done
rm -f "$LOCK" "$ENV_FILE"
(cd "$REPO" && wenv PATH="$NOFLOCK" "$NODE" "$CLI" status runs --watch --project "$KEY" --interval 1 > "$SB/nf.out" 2> "$SB/nf.err" < /dev/null)
eq "2" "$?" "PATH without flock -> exit 2"
eq "yes" "$(grep -q flock_unavailable "$SB/nf.err" && echo yes || echo no)" "stderr names flock_unavailable"
eq "no" "$([ -e "$LOCK" ] && echo yes || echo no)" "no lock file left behind"
eq "1" "$(wc -l < "$SB/nf.err" | tr -d ' ')" "stderr is one line"

# --- 6. --stop: refuses a pid that is not the watcher; stops the real one -----------------------------
sleep 300 < /dev/null > /dev/null 2>&1 &
OTHER=$!; KILL_PIDS="$KILL_PIDS $OTHER"
mkdir -p "$LIVE/runs"
printf '{"schema":"autopilot.runs-live/1","scope":{"project_key":"%s","repo_identity":null,"root_run_id":null},"published_at":"%s","valid_for_s":180,"writer":{"pid":%s,"session_id":null,"started_at":"x"},"runs":[]}\n' \
  "$KEY" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OTHER" > "$ENV_FILE"
(cd "$REPO" && wenv "$NODE" "$CLI" status runs --stop --project "$KEY" > "$SB/s.out" 2> "$SB/s.err" < /dev/null)
eq "1" "$?" "--stop with the envelope pid swapped to another process -> exit 1"
eq "yes" "$(grep -q refusing "$SB/s.err" && echo yes || echo no)" "--stop says it refuses"
eq "yes" "$(kill -0 "$OTHER" 2>/dev/null && echo yes || echo no)" "the unrelated process was not signalled"
kill -9 "$OTHER"

rm -f "$ENV_FILE" "$SB/children.pids"
start_watcher
wait_envelope
STOPPED_PID="$W_PID"
(cd "$REPO" && wenv "$NODE" "$CLI" status runs --stop --project "$KEY" > "$SB/s2.out" 2> "$SB/s2.err" < /dev/null)
eq "0" "$?" "--stop on the real watcher -> exit 0"
eq "no" "$(kill -0 "$STOPPED_PID" 2>/dev/null && echo yes || echo no)" "watcher process is gone after --stop"
eq "null" "$(node -e 'const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(e.writer))' "$ENV_FILE")" "final publish has writer: null"
eq "stopped" "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).exit_reason)' "$ENV_FILE")" "final publish exit_reason is stopped"
eq "0" "$(lock_free_within 1)" "lock is free after --stop"

finalize_test
