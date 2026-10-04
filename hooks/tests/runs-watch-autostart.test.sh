#!/usr/bin/env bash
# Tests for hooks/runs-watch-autostart.js (SessionStart: write the live pointer + ensure the project watcher; mods P1W W1c).
# Real watcher processes against a fixture repo. HOME, CLAUDE_CONFIG_DIR, XDG_RUNTIME_DIR, AUTOPILOT_LIVE_DIR
# (a /dev/shm tmpdir), AUTOPILOT_SESSION_MODE_DIR, AUTOPILOT_COSTS_FILE and AUTOPILOT_DISPATCH_RUNS_DIR all point under a
# mktemp dir: nothing touches the real ~/.autopilot, ~/.claude, /run/user/*/autopilot or the dispatch manifest dir.
# Every watcher this suite starts is killed BY PID in the trap.
. "$(dirname "$0")/lib.sh"

# RED at 39cc491c (hook file absent; hooks.json, hook-classes and hooks/README.md do not name it): 22 FAIL, e.g.
#   hook exits 0: expected '0', got '1' (MODULE_NOT_FOUND); pointer written: expected 'yes', got 'no';
#   a watcher publishes an envelope with writer.pid within 15 s: expected 'yes', got 'no';
#   writer.pid holds fd 9 on the project lock: expected '<lock>', got ''; exactly one watcher: expected '1', got '0';
#   idle watcher exits by itself and frees the lock: expected '0', got '1'; wiring / hook-classes / README assertions.
#   Full RED output: <scratchpad>/p1c/run-w/w1c/red.txt

eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
# lib.sh exports AUTOPILOT_RUNS_WATCH_AUTOSTART=0; wenv drops it and sets it from $AS (1 = forced, 0 = off, empty = unset: the opt-in rule).
AS=1

HOOK="$REPO_ROOT/hooks/runs-watch-autostart.js"
NODE="$(command -v node)"
SB="$TEST_TMP/rwa"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"; RUNS="$SB/runs"; REPO="$SB/repo"; NONREPO="$SB/nonrepo"
AHOME="$FAKE_HOME/.autopilot"; MARKERS="$AHOME/session-mode"; POINTER="$AHOME/live-pointer.json"
mkdir -p "$AHOME" "$FAKE_CLAUDE/metrics" "$FAKE_XDG" "$RUNS" "$REPO" "$NONREPO"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-rwa-XXXXXX)"; chmod 700 "$LIVE"
KILL_PIDS=""
cleanup_rwa() {
  local p
  for p in $KILL_PIDS; do kill -9 "$p" 2>/dev/null; done
  rm -rf "$LIVE"
}
trap 'cleanup_rwa; cleanup_test_tmp' EXIT
git -C "$REPO" init -q
git -C "$REPO" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init
KEY="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"
LOCK="$LIVE/runs/$KEY.lock"
ENV_FILE="$LIVE/runs/$KEY.json"

wenv() {
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u AUTOPILOT_RUNS_WATCH_AUTOSTART ${AS:+AUTOPILOT_RUNS_WATCH_AUTOSTART="$AS"} \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$MARKERS" AUTOPILOT_COSTS_FILE="$SB/costs.jsonl" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" ${WPATH:+PATH="$WPATH"} "$@"
}
envelope_pid() {
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
run_hook_in() { # <cwd> [event] -> HOOK_RC, HOOK_OUT, HOOK_ERR, HOOK_MS (hook gets the payload on stdin)
  local t0 t1
  t0=$(date +%s%N)
  (cd "$SB" && printf '{"hook_event_name":"%s","source":"startup","cwd":"%s"}' "${2:-SessionStart}" "$1" | wenv "$NODE" "$HOOK" > "$SB/h.out" 2> "$SB/h.err")
  HOOK_RC=$?
  t1=$(date +%s%N)
  HOOK_MS=$(( (t1 - t0) / 1000000 ))
  HOOK_OUT="$(cat "$SB/h.out")"; HOOK_ERR="$(cat "$SB/h.err")"
}

# --- 1. repo cwd: pointer written, exactly one watcher, holding the lock by fd --------------------------
run_hook_in "$REPO"
eq "0" "$HOOK_RC" "hook exits 0"
eq "" "$HOOK_OUT" "hook writes nothing on stdout (no context injection)"
eq "yes" "$([ -f "$POINTER" ] && echo yes || echo no)" "pointer written"
eq "$LIVE" "$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).live_base)}catch(_){}' "$POINTER")" "pointer names the live base"
wait_writer
eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "a watcher publishes an envelope with writer.pid within 15 s"
FIRST_PID="$W_PID"
eq "$LOCK" "$(readlink "/proc/$FIRST_PID/fd/9" 2> /dev/null)" "writer.pid holds fd 9 on the project lock"
eq "1" "$(count_watchers)" "exactly one watcher after the first run"

# --- 2. second run while held: starts nothing, silent, fast ---------------------------------------------
run_hook_in "$REPO"
eq "0" "$HOOK_RC" "second run exits 0"
eq "" "$HOOK_ERR" "second run is silent (a held lock is the normal outcome)"
sleep 1
eq "$FIRST_PID" "$(envelope_pid)" "second run starts nothing (same writer.pid)"
eq "1" "$(count_watchers)" "still exactly one watcher after the second run"
eq "yes" "$([ "$HOOK_MS" -lt 4000 ] && echo yes || echo no)" "second run is a fast path (${HOOK_MS} ms < 4000)"

# --- 3. non-git cwd: no-op (no pointer, no watcher) -----------------------------------------------------
kill -9 "$FIRST_PID" 2> /dev/null
eq "0" "$(lock_free_within 3)" "lock free after killing the first watcher"
rm -f "$POINTER" "$ENV_FILE"
run_hook_in "$NONREPO"
eq "0" "$HOOK_RC" "non-git: exits 0"
eq "" "$HOOK_ERR" "non-git: silent"
sleep 1
eq "no" "$([ -f "$POINTER" ] && echo yes || echo no)" "non-git: no pointer written"
eq "0" "$(count_watchers)" "non-git: no watcher"

# --- 4. knob AUTOPILOT_RUNS_WATCH_AUTOSTART=0 -> no-op ----------------------------------------------------
AS=0 run_hook_in "$REPO"
eq "0" "$HOOK_RC" "knob 0: exits 0"
sleep 1
eq "no" "$([ -f "$POINTER" ] && echo yes || echo no)" "knob 0: no pointer"
eq "0" "$(count_watchers)" "knob 0: no watcher"

# --- 5. flock missing: fail-open, one stderr line naming flock ---------------------------------------------
mkdir -p "$SB/nopath"
for tool in node git; do ln -sf "$(command -v $tool)" "$SB/nopath/$tool"; done
WPATH="$SB/nopath" run_hook_in "$REPO"
eq "0" "$HOOK_RC" "no flock: exits 0"
eq "1" "$(printf '%s\n' "$HOOK_ERR" | grep -c .)" "no flock: exactly one stderr line"
eq "yes" "$(printf '%s' "$HOOK_ERR" | grep -qi flock && echo yes || echo no)" "no flock: stderr names flock"
eq "0" "$(count_watchers)" "no flock: no watcher"

# --- 6. idle watcher exits by itself and frees the lock -----------------------------------------------------
# stale session files must not keep it alive: a tasks file 1 h old for this project, a FRESH attention file of another project
mkdir -p "$LIVE/tasks" "$LIVE/attention"
STALE="$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)"
printf '{"schema":"autopilot.session-tasks/1","project_key":"%s","updated_at":"%s"}' "$KEY" "$STALE" > "$LIVE/tasks/stale.json"
printf '{"schema":"autopilot.attention/1","project_key":"otherproject0000","updated_at":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LIVE/attention/other.json"
AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S=2 AUTOPILOT_RUNS_WATCH_INTERVAL_S=1 run_hook_in "$REPO"
wait_writer
eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "idle case: watcher started"
eq "0" "$(lock_free_within 40)" "idle watcher exits by itself and frees the lock (stale tasks file + other-project attention file do not hold it)"
eq "0" "$(count_watchers)" "idle case: no watcher process left"

# --- 6b. a FRESH tasks file of this project keeps the watcher alive past the idle window; once it goes stale it exits ----
rm -f "$LIVE/tasks/stale.json" "$LIVE/attention/other.json" "$ENV_FILE"
HB_PID=""
( while :; do
    printf '{"schema":"autopilot.session-tasks/1","project_key":"%s","updated_at":"%s"}' "$KEY" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LIVE/tasks/hb.json.tmp" && mv "$LIVE/tasks/hb.json.tmp" "$LIVE/tasks/hb.json"
    sleep 1
  done ) &
HB_PID=$!
KILL_PIDS="$KILL_PIDS $HB_PID"
AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S=3 AUTOPILOT_RUNS_WATCH_INTERVAL_S=1 run_hook_in "$REPO"
wait_writer
eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "heartbeat case: watcher started"
sleep 12 # >> idle window (3 s): only the fresh tasks file can be holding it
eq "1" "$(count_watchers)" "a fresh tasks file keeps the watcher alive past the idle window"
kill "$HB_PID" 2> /dev/null; wait "$HB_PID" 2> /dev/null
eq "0" "$(lock_free_within 40)" "after the tasks file goes stale the watcher idle-exits"

# --- 6c. opt-in scope (G1 R9): AS unset => only an opted-in repo gets a watcher ----------------------------------------
AS="" run_hook_in "$REPO"
eq "0" "$HOOK_RC" "unopted repo: exits 0"
sleep 1
eq "0" "$(count_watchers)" "unopted repo (no .claude config, no marker, knob unset): starts nothing"
mkdir -p "$REPO/.claude"; printf '# dispatch\n' > "$REPO/.claude/dispatch-config.md"
rm -f "$ENV_FILE" # no stale envelope from an earlier case may satisfy wait_writer
AS="" AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S=2 AUTOPILOT_RUNS_WATCH_INTERVAL_S=1 run_hook_in "$REPO"
wait_writer
eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "repo with .claude/dispatch-config.md (onboard output): watcher started without the force knob"
eq "1" "$(count_watchers)" "config opt-in: exactly one watcher running"
eq "0" "$(lock_free_within 40)" "opt-in watcher idle-exits"
rm -rf "$REPO/.claude" "$ENV_FILE"
mkdir -p "$MARKERS"
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({project_key:process.argv[2],session_id:"s1",expires_at:new Date(Date.now()+3600e3).toISOString()}))' "$MARKERS/s1.json" "$KEY"
AS="" AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S=2 AUTOPILOT_RUNS_WATCH_INTERVAL_S=1 run_hook_in "$REPO"
wait_writer
eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "unexpired session-mode marker opts the repo in"
eq "1" "$(count_watchers)" "marker opt-in: exactly one watcher running"
kill -9 "$W_PID" 2> /dev/null
eq "0" "$(lock_free_within 3)" "lock free after killing the marker-case watcher"
rm -f "$MARKERS/s1.json" "$ENV_FILE"

# --- 6d. UserPromptSubmit re-ensures: starts one when free, never a second while held ----------------------------------
run_hook_in "$REPO" UserPromptSubmit
wait_writer
eq "yes" "$([ -n "$W_PID" ] && echo yes || echo no)" "UserPromptSubmit with a free lock starts the watcher"
UPS_PID="$W_PID"
run_hook_in "$REPO" UserPromptSubmit
eq "" "$HOOK_ERR" "UserPromptSubmit while held is silent"
sleep 1
eq "$UPS_PID" "$(envelope_pid)" "UserPromptSubmit while held starts nothing (same writer.pid)"
eq "1" "$(count_watchers)" "exactly one watcher after repeated prompts"
kill -9 "$UPS_PID" 2> /dev/null
eq "0" "$(lock_free_within 3)" "lock free after killing the prompt-case watcher"

# --- 7. wiring ------------------------------------------------------------------------------------------------
eq "yes" "$(node -e '
  const h = require(process.argv[1] + "/hooks/hooks.json").hooks.SessionStart || [];
  const u = require(process.argv[1] + "/hooks/hooks.json").hooks.UserPromptSubmit || [];
  const w = (a) => a.some((g) => (g.hooks || []).some((x) => /hooks\/runs-watch-autostart\.js/.test(x.command || "")));
  process.stdout.write(w(h) && w(u) ? "yes" : "no");' "$REPO_ROOT")" "hooks.json wires runs-watch-autostart under SessionStart and UserPromptSubmit"
eq "yes" "$(node -e '
  const c = require(process.argv[1] + "/profiles/hook-classes.json");
  process.stdout.write(JSON.stringify(c).includes("\"runs-watch-autostart\"") ? "yes" : "no");' "$REPO_ROOT")" "hook-classes classifies runs-watch-autostart"
eq "yes" "$(grep -q 'AUTOPILOT_RUNS_WATCH_AUTOSTART' "$REPO_ROOT/hooks/README.md" && grep -q 'runs-watch-autostart' "$REPO_ROOT/hooks/README.md" && grep -q 'SessionEnd does not stop the watcher' "$REPO_ROOT/hooks/README.md" && echo yes || echo no)" "hooks/README.md documents the hook and its opt-out knob"

finalize_test
