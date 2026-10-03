#!/usr/bin/env bash
# Tests for the host review server (mods plan P1b row B2, plan R4.1): one detached
# `python3 -m http.server --bind 127.0.0.1 <port> --directory <home>/review` per host, ensured by the
# project watcher, own flock, survives its caller. HOME, CLAUDE_CONFIG_DIR, XDG_RUNTIME_DIR,
# AUTOPILOT_LIVE_DIR (a /dev/shm mktemp dir), AUTOPILOT_SESSION_MODE_DIR and the manifest dir all point
# under mktemp dirs; the port is a free ephemeral one written to the fake config (never 8787). Every
# background process is killed BY PID in the cleanup trap.
. "$(dirname "$0")/lib.sh"

# RED at 0a642f8f (unmodified base: no src/status/review-server.js, no watcher ensure): 15 passed, 25 failed, e.g.
#   FAIL ensure -> exit 0: expected '0', got '1'
#   FAIL ensure status is started: expected 'started', got ''
#   FAIL GET 127.0.0.1:<port>/ -> 200: expected '200', got '000'
#   FAIL LISTEN socket bound to 127.0.0.1 only (/proc/net/tcp): expected '0100007F', got ''
#   FAIL second ensure status is running: expected 'running', got ''
#   FAIL port busy -> status port_busy: expected 'port_busy', got ''
#   FAIL python3 missing -> status python_unavailable: expected 'python_unavailable', got ''
#   FAIL AUTOSTART=1 -> watcher ensured a live review server: expected 'yes', got 'no'
#   FAIL server survives the watcher exiting: expected 'yes', got 'no'

eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
RS="$REPO_ROOT/src/status/review-server.js"
CLI="$REPO_ROOT/bin/autopilot.js"
NODE="$(command -v node)"
SB="$TEST_TMP/revsrv"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"; RUNS="$SB/runs"; REPO="$SB/repo"
AH="$FAKE_HOME/.autopilot"
mkdir -p "$AH" "$FAKE_CLAUDE" "$FAKE_XDG" "$RUNS" "$REPO"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-revsrv-XXXXXX)"; chmod 700 "$LIVE"
KILL_PIDS=""
cleanup_rs() {
  local p
  for p in $KILL_PIDS; do kill -9 "$p" 2>/dev/null; done
  if [ -f "$LIVE/review/server.json" ]; then
    p="$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid))}catch(_){}' "$LIVE/review/server.json")"
    [ -n "$p" ] && kill -9 "$p" 2>/dev/null
  fi
  rm -rf "$LIVE"
}
trap 'cleanup_rs; cleanup_test_tmp' EXIT
git -C "$REPO" init -q
KEY="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"

wenv() {
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$AH/session-mode" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" "$@"
}
free_port() { node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})'; }
set_port() { printf '{"review":{"port":%s}}\n' "$1" > "$AH/config.json"; }
info_field() { node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]))}catch(_){}' "$LIVE/review/server.json" "$1"; }
json_field() { node -e 'try{process.stdout.write(String(JSON.parse(process.argv[1])[process.argv[2]]))}catch(_){}' "$1" "$2"; }
listen_addr() { # <port> -> local address column(s) of LISTEN sockets on that port
  local hex; hex="$(printf '%04X' "$1")"
  awk -v h="$hex" 'NR>1 && $4=="0A" {split($2,a,":"); if (a[2]==h) print a[1]}' /proc/net/tcp /proc/net/tcp6
}
alive() { [ -d "/proc/$1" ] && ! grep -q '^State:.*Z' "/proc/$1/status" 2>/dev/null && echo yes || echo no; }

PORT="$(free_port)"; set_port "$PORT"

# --- ensure starts one server bound to 127.0.0.1 -------------------------------------------------
OUT="$(wenv "$NODE" "$RS" ensure 2> "$SB/e1.err" < /dev/null)"; RC=$?
eq 0 "$RC" "ensure -> exit 0"
eq started "$(json_field "$OUT" status)" "ensure status is started"
PID="$(info_field pid)"
eq "$PID" "$(json_field "$OUT" pid)" "ensure returns the server.json pid"
eq yes "$(alive "$PID")" "server.json names a live pid"
eq "$PORT" "$(info_field port)" "server.json port is the configured port"
eq "$AH/review" "$(info_field root)" "server.json root is <autopilot_home>/review"
CMD="$(tr '\0' ' ' < /proc/$PID/cmdline 2>/dev/null)"
case "$CMD" in *"http.server --bind 127.0.0.1 $PORT --directory $AH/review"*) R=yes ;; *) R="no: $CMD" ;; esac
eq yes "$R" "cmdline is the 127.0.0.1-bound http.server on the review root"
eq 0100007F "$(listen_addr "$PORT" | sort -u | tr '\n' ' ' | sed 's/ $//')" "LISTEN socket bound to 127.0.0.1 only (/proc/net/tcp)"
eq 700 "$(stat -c %a "$AH/review")" "served root created mode 0700"
echo '<p>hi</p>' > "$AH/review/index.html"
eq 200 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/")" "GET 127.0.0.1:<port>/ -> 200"
eq 1 "$(wenv flock -n "$LIVE/review/server.lock" true < /dev/null; echo $?)" "server lock is held while the server lives"

# --- idempotent + survives the caller ------------------------------------------------------------
OUT2="$(wenv "$NODE" "$RS" ensure 2> "$SB/e2.err" < /dev/null)"; RC=$?
eq 0 "$RC" "second ensure -> exit 0"
eq running "$(json_field "$OUT2" status)" "second ensure status is running"
eq "$PID" "$(json_field "$OUT2" pid)" "second ensure returns the holder pid"
eq "$PID" "$(info_field pid)" "no second server: server.json pid unchanged"
eq yes "$(alive "$PID")" "server survives the exited ensure caller"

# --- stop ----------------------------------------------------------------------------------------
wenv "$NODE" "$RS" stop > "$SB/s1.out" 2> "$SB/s1.err" < /dev/null; RC=$?
eq 0 "$RC" "stop -> exit 0"
eq no "$(alive "$PID")" "stop -> process gone"
eq 0 "$(wenv flock -n "$LIVE/review/server.lock" true < /dev/null; echo $?)" "stop -> lock free"
eq 000 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/")" "stop -> port no longer answers"

# --- stop refuses a pid that is not the server -----------------------------------------------------
sleep 300 < /dev/null > /dev/null 2>&1 & SLEEP_PID=$!; KILL_PIDS="$KILL_PIDS $SLEEP_PID"
printf '{"pid":%s,"port":%s,"root":"%s","started_at":"x"}\n' "$SLEEP_PID" "$PORT" "$AH/review" > "$LIVE/review/server.json"
wenv "$NODE" "$RS" stop > "$SB/s2.out" 2> "$SB/s2.err" < /dev/null; RC=$?
eq 1 "$RC" "stop with a foreign pid -> exit 1"
eq yes "$(alive "$SLEEP_PID")" "stop with a foreign pid does not signal it"
eq yes "$(grep -q 'is not the review server' "$SB/s2.err" && echo yes || echo no)" "refusal names the reason on stderr"
kill -9 "$SLEEP_PID" 2>/dev/null; rm -f "$LIVE/review/server.json"

# --- port busy: named status, no server, no other port ---------------------------------------------
BUSY="$(free_port)"; set_port "$BUSY"
node -e 'require("net").createServer().listen(+process.argv[1],"127.0.0.1");setInterval(()=>{},1e6)' "$BUSY" < /dev/null > /dev/null 2>&1 &
BUSY_PID=$!; KILL_PIDS="$KILL_PIDS $BUSY_PID"
for _ in $(seq 1 50); do [ -n "$(listen_addr "$BUSY")" ] && break; sleep 0.1; done
OUT3="$(wenv "$NODE" "$RS" ensure 2> "$SB/e3.err" < /dev/null)"; RC=$?
eq 1 "$RC" "port busy -> exit 1"
eq port_busy "$(json_field "$OUT3" status)" "port busy -> status port_busy"
eq "$BUSY" "$(json_field "$OUT3" port)" "port busy reports the configured port, no other port"
eq "review server: port busy" "$(cat "$SB/e3.err")" "port busy -> one stderr line"
eq no "$([ -e "$LIVE/review/server.json" ] && echo yes || echo no)" "port busy -> no server.json"
eq 0 "$(wenv flock -n "$LIVE/review/server.lock" true < /dev/null; echo $?)" "port busy -> no server holds the lock"
kill -9 "$BUSY_PID" 2>/dev/null

# --- python3 missing: named status, no throw ---------------------------------------------------------
set_port "$PORT"
NOPY="$SB/nopy-bin"; mkdir -p "$NOPY"
for t in flock nohup sh env; do ln -sf "$(command -v $t)" "$NOPY/$t"; done
ln -sf /usr/bin/true "$NOPY/true"
for t in flock nohup sh env true; do [ -x "$NOPY/$t" ] || echo "nopy-bin: missing $t" >&2; done
OUT4="$(wenv PATH="$NOPY" "$NODE" "$RS" ensure 2> "$SB/e4.err" < /dev/null)"; RC=$?
eq 1 "$RC" "python3 missing -> exit 1 (no throw)"
eq python_unavailable "$(json_field "$OUT4" status)" "python3 missing -> status python_unavailable"

# --- watcher path: AUTOSTART=0 respected, AUTOSTART=1 ensures, server outlives the watcher -----------
start_watcher() { # <autostart>
  (cd "$REPO" && wenv AUTOPILOT_REVIEW_SERVER_AUTOSTART="$1" "$NODE" "$CLI" status runs --watch --project "$KEY" --interval 1 \
    > "$SB/w.out" 2> "$SB/w.err" < /dev/null & echo $! > "$SB/w.launcher")
  KILL_PIDS="$KILL_PIDS $(cat "$SB/w.launcher")"
}
wait_writer() {
  local i
  W_PID=""
  for i in $(seq 1 150); do
    W_PID="$(node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(e.writer&&e.writer.pid)process.stdout.write(String(e.writer.pid))}catch(_){}' "$LIVE/runs/$KEY.json")"
    [ -n "$W_PID" ] && break
    sleep 0.1
  done
  [ -n "$W_PID" ] && KILL_PIDS="$KILL_PIDS $W_PID"
}
start_watcher 0; wait_writer
eq yes "$([ -n "$W_PID" ] && echo yes || echo no)" "watcher (autostart 0) published an envelope"
sleep 2
eq no "$([ -e "$LIVE/review/server.json" ] && echo yes || echo no)" "AUTOSTART=0 -> watcher starts no review server"
eq 0 "$(wenv flock -n "$LIVE/review/server.lock" true < /dev/null; echo $?)" "AUTOSTART=0 -> server lock free"
kill "$W_PID" 2>/dev/null
for _ in $(seq 1 150); do [ "$(alive "$W_PID")" = no ] && break; sleep 0.1; done
rm -f "$LIVE/runs/$KEY.json"

start_watcher 1; wait_writer
eq yes "$([ -n "$W_PID" ] && echo yes || echo no)" "watcher (autostart 1) published an envelope"
for _ in $(seq 1 50); do [ -s "$LIVE/review/server.json" ] && break; sleep 0.1; done
SPID="$(info_field pid)"
eq yes "$(alive "${SPID:-0}")" "AUTOSTART=1 -> watcher ensured a live review server"
eq 200 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/")" "watcher-started server answers 200"
kill "$W_PID" 2>/dev/null
for _ in $(seq 1 150); do [ "$(alive "$W_PID")" = no ] && break; sleep 0.1; done
eq no "$(alive "$W_PID")" "watcher stopped"
eq yes "$(alive "${SPID:-0}")" "server survives the watcher exiting"
wenv "$NODE" "$RS" stop > /dev/null 2>&1 < /dev/null
eq no "$(alive "${SPID:-0}")" "stop after the watcher run -> process gone"

finalize_test
