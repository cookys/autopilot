#!/usr/bin/env bash
# RED at 027f7d863: FAIL [dispatch-foreman-cgroup] 1 passed, 2 failed — containment expected 'cgroup' got 'setsid'; setsid grandchild still alive after cap teardown
# RED at 26bffb06b: (pid file never written) FAIL [dispatch-foreman-cgroup] 1: gc.pid is non-empty before teardown — got empty
# RED at 26bffb06b: (systemd-run launch exits 1) FAIL [dispatch-foreman-cgroup] 3: failed scope launch reports setsid: expected 'setsid', got 'cgroup'
# RED at 6200e3ed4: FAIL [dispatch-foreman-cgroup] 4: tool-call cap did not stop the turn; 4: foreman turn started once (slow scope must not relaunch): expected '1', got '2'; 4: tool-call cap still stops the turn: expected 'tool_cap_reached', got '' — 7 passed, 3 failed
# RED at 3b1813e3e: case 4 old cleanup left live user scopes (foreman-cg4-1-….scope and foreman-cg4-2-….scope still active, command /bin/sleep 120, four seconds after the suite). The setsid containment assertion already passes on this base (PROBE containment=setsid); it was missing, not failing.
# Foreman rail cgroup containment: a setsid grandchild must die on cap teardown
# when a systemd user scope is usable, and containment must fall back to setsid
# when WORKER_CONTAINMENT_FORCE_NO_CGROUP=1 or systemd-run fails to start the scope.
. "$(dirname "$0")/lib.sh"

GC_PID=""
SLOW_LAUNCHER_PID=""
SLOW_UNIT_FILE=""
# Kill recorded launcher pids (and their process groups), then wait until each
# recorded scope is gone or stopped, and only then stop/kill the unit.
cleanup_slow_scope() {
  local p u i st
  if [ -n "${SLOW_LAUNCHER_PID:-}" ] && [ -f "$SLOW_LAUNCHER_PID" ]; then
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      kill -KILL -- "-$p" 2>/dev/null || true
      kill -KILL "$p" 2>/dev/null || true
    done < "$SLOW_LAUNCHER_PID"
  fi
  if [ -n "${SLOW_UNIT_FILE:-}" ] && [ -f "$SLOW_UNIT_FILE" ]; then
    while IFS= read -r u; do
      [ -n "$u" ] || continue
      i=0
      while [ "$i" -lt 50 ]; do
        st="$(systemctl --user is-active "$u" 2>/dev/null || true)"
        if [ "$st" != "active" ] && [ "$st" != "activating" ]; then
          break
        fi
        sleep 0.1
        i=$((i+1))
      done
      systemctl --user kill "$u" --signal=SIGKILL >/dev/null 2>&1 || true
      systemctl --user stop "$u" >/dev/null 2>&1 || true
    done < "$SLOW_UNIT_FILE"
  fi
}
cleanup_gc() {
  if [ -n "${GC_PID:-}" ]; then
    kill -KILL "$GC_PID" 2>/dev/null || true
  fi
  cleanup_slow_scope
  cleanup_test_tmp
}
trap cleanup_gc EXIT

SCRIPT="$REPO_ROOT/scripts/dispatch-foreman.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
BRIEF="$TEST_TMP/brief.md"
PLAN="$TEST_TMP/plan.md"
echo "brief" > "$BRIEF"
echo "plan" > "$PLAN"
STUBDIR="$TEST_TMP/bin"
mkdir -p "$STUBDIR"
cat > "$STUBDIR/kimi" << 'STUB'
#!/usr/bin/env bash
cont=0
for a in "$@"; do [ "$a" = "-c" ] && cont=1; done
spawn_child() {
  # mode=setsid starts a new session (escapes the process group).
  # mode=group stays in kimi's process group so the setsid fallback can reap it.
  local mode="$1" pidfile="$2"
  if [ "$mode" = "setsid" ]; then
    setsid bash -c 'echo $$ > "$1"; exec sleep 300' bash "$pidfile" &
  else
    bash -c 'echo $$ > "$1"; exec sleep 300' bash "$pidfile" &
  fi
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    [ -s "$pidfile" ] && break
    sleep 0.05
  done
  # Hold tool output so the test can observe the live pid before cap teardown.
  sleep 0.8
}
if [ -n "${KIMI_STUB_PIDFILE:-}" ]; then printf '%s\n' "$$" > "$KIMI_STUB_PIDFILE"; fi
# Count only the initial turn. The handoff resume (-c) is a different turn.
if [ "$cont" -eq 0 ] && [ -n "${KIMI_STUB_START_LOG:-}" ]; then
  printf 'start\n' >> "$KIMI_STUB_START_LOG"
fi
if [ "$cont" -eq 0 ] && [ "${KIMI_STUB_SPAWN_GC:-}" = "1" ]; then
  spawn_child "${KIMI_STUB_GC_MODE:-setsid}" "$KIMI_STUB_GC_PID"
fi
call() { printf '{"role":"assistant","tool_calls":[{"type":"function","id":"t%s","function":{"name":"Bash","arguments":"{}"}}]}\n' "$1"; }
if [ "$cont" -eq 1 ]; then
  exit 0
fi
call 1
call 2
while :; do sleep 1; done
STUB
chmod +x "$STUBDIR/kimi"

field() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j[process.argv[1]]));})' "$2"; }

# Wait until the pid file is non-empty and the recorded pid is alive, while the
# rail is still running (before teardown). An empty GC_PID fails the test.
assert_grandchild_alive_before_teardown() {
  local label="$1" pidfile="$2" rail_pid="$3" i=0
  while [ "$i" -lt 80 ]; do
    if [ -s "$pidfile" ]; then break; fi
    if ! kill -0 "$rail_pid" 2>/dev/null; then break; fi
    sleep 0.05
    i=$((i+1))
  done
  if [ ! -s "$pidfile" ]; then
    fail "$label: gc.pid is non-empty before teardown — got empty"
    return 1
  fi
  GC_PID="$(cat "$pidfile")"
  if [ -z "${GC_PID:-}" ]; then
    fail "$label: empty GC_PID must fail"
    return 1
  fi
  if ! kill -0 "$GC_PID" 2>/dev/null; then
    fail "$label: grandchild $GC_PID is alive before teardown"
    return 1
  fi
  return 0
}

wait_grandchild_dead() {
  # An empty pid is not "already dead" — the assertion must fail.
  if [ -z "${GC_PID:-}" ]; then
    printf 'empty'
    return 1
  fi
  local i=0 alive=1
  while [ "$i" -lt 20 ]; do
    if ! kill -0 "$GC_PID" 2>/dev/null; then alive=0; break; fi
    sleep 0.25
    i=$((i+1))
  done
  printf '%s' "$alive"
}

# --- case 1: scope reap kills the setsid grandchild ---
if ! systemd-run --user --scope --quiet -- true >/dev/null 2>&1; then
  echo "SKIP: systemd-run --user --scope is unusable on this host"
else
  GC_FILE="$TEST_TMP/gc.pid"
  rm -f "$GC_FILE"
  RD="$TEST_TMP/runs/cg"
  OUTF="$TEST_TMP/cg.out"
  ( cd "$SBX" && PATH="$STUBDIR:$PATH" \
    KIMI_STUB_SPAWN_GC=1 KIMI_STUB_GC_MODE=setsid KIMI_STUB_GC_PID="$GC_FILE" \
    bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" \
      --run-id cg1 --run-dir "$RD" --tool-cap 1 --timeout 30 --handoff-timeout 5 --poll 0.2 \
      --kimi-bin "$STUBDIR/kimi" >"$OUTF" 2>"$TEST_TMP/cg.err" ) &
  RAIL_PID=$!
  if assert_grandchild_alive_before_teardown "1" "$GC_FILE" "$RAIL_PID"; then
    assert_eq "alive" "alive" "1: grandchild pid is non-empty and alive before teardown"
  fi
  wait "$RAIL_PID" || true
  OUT="$(cat "$OUTF" 2>/dev/null || true)"
  assert_eq "$(field "$OUT" containment)" "cgroup" "1: containment is cgroup after a verified scope"
  assert_eq "$(wait_grandchild_dead)" "0" "1: setsid grandchild is dead after cap teardown (pid ${GC_PID:-missing})"
  if [ -n "${GC_PID:-}" ]; then kill -KILL "$GC_PID" 2>/dev/null || true; GC_PID=""; fi
fi

# --- case 2: seam forces the setsid fallback ---
RD2="$TEST_TMP/runs/fb"
OUT2="$(cd "$SBX" && PATH="$STUBDIR:$PATH" WORKER_CONTAINMENT_FORCE_NO_CGROUP=1 \
  bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" \
    --run-id cg2 --run-dir "$RD2" --tool-cap 1 --timeout 20 --handoff-timeout 5 --poll 0.2 \
    --kimi-bin "$STUBDIR/kimi" 2>"$TEST_TMP/fb.err")" || true
assert_eq "$(field "$OUT2" containment)" "setsid" "2: seam forces containment setsid"

# --- case 3: systemd-run fails to start the scope → rerun with setsid ---
if ! systemd-run --user --scope --quiet -- true >/dev/null 2>&1; then
  echo "SKIP: systemd-run --user --scope is unusable on this host (case 3)"
else
  FAKEBIN="$TEST_TMP/fakebin"
  mkdir -p "$FAKEBIN"
  cat > "$FAKEBIN/systemd-run" << 'FAKE'
#!/usr/bin/env bash
# Detection probe is `systemd-run --user --scope --quiet -- true`. Let that pass.
# Any real worker launch fails before a scope exists.
last=""
for a in "$@"; do last="$a"; done
if [ "$last" = "true" ]; then
  exit 0
fi
exit 1
FAKE
  chmod +x "$FAKEBIN/systemd-run"
  GC_FILE3="$TEST_TMP/gc3.pid"
  rm -f "$GC_FILE3"
  RD3="$TEST_TMP/runs/failstart"
  OUTF3="$TEST_TMP/fail.out"
  ( cd "$SBX" && PATH="$FAKEBIN:$STUBDIR:$PATH" \
    KIMI_STUB_SPAWN_GC=1 KIMI_STUB_GC_MODE=group KIMI_STUB_GC_PID="$GC_FILE3" \
    bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" \
      --run-id cg3 --run-dir "$RD3" --tool-cap 1 --timeout 30 --handoff-timeout 5 --poll 0.2 \
      --kimi-bin "$STUBDIR/kimi" >"$OUTF3" 2>"$TEST_TMP/fail.err" ) &
  RAIL3=$!
  if assert_grandchild_alive_before_teardown "3" "$GC_FILE3" "$RAIL3"; then
    assert_eq "alive" "alive" "3: grandchild pid is non-empty and alive before teardown"
  fi
  wait "$RAIL3" || true
  OUT3="$(cat "$OUTF3" 2>/dev/null || true)"
  assert_eq "$(field "$OUT3" containment)" "setsid" "3: failed scope launch reports setsid"
  assert_eq "$(wait_grandchild_dead)" "0" "3: in-session grandchild is reaped after setsid fallback (pid ${GC_PID:-missing})"
  if [ -n "${GC_PID:-}" ]; then kill -KILL "$GC_PID" 2>/dev/null || true; GC_PID=""; fi
fi

# --- case 4: scope becomes active 3s late; the live worker is the turn (once) ---
# A user manager slower than the 2s probe must not drop cap monitoring and must
# not start the same turn a second time.
if ! systemd-run --user --scope --quiet -- true >/dev/null 2>&1; then
  echo "SKIP: systemd-run --user --scope is unusable on this host (case 4)"
else
  SLOWBIN="$TEST_TMP/slowbin"
  mkdir -p "$SLOWBIN"
  SLOW_UNIT_FILE="$TEST_TMP/slow.unit"
  SLOW_LAUNCHER_PID="$TEST_TMP/slow.launcher.pid"
  SLOW_WORKER_PID="$TEST_TMP/slow.worker.pid"
  SLOW_STARTS="$TEST_TMP/slow.starts"
  # Resolve before PATH puts the fake systemd-run first.
  SLOW_REAL_SYSTEMD_RUN="$(command -v systemd-run)"
  rm -f "$SLOW_UNIT_FILE" "$SLOW_LAUNCHER_PID" "$SLOW_WORKER_PID" "$SLOW_STARTS"
  cat > "$SLOWBIN/systemd-run" << 'FAKE'
#!/usr/bin/env bash
# Detection probe (`-- true`) succeeds so HAVE_CGROUP=1.
# A worker launch stays alive immediately and makes the named scope active
# only after 3 seconds, via the real systemd-run outside this process group.
last=""
unit=""
for a in "$@"; do
  case "$a" in
    --unit=*) unit="${a#--unit=}" ;;
  esac
  last="$a"
done
if [ "$last" = "true" ]; then
  exit 0
fi
args=()
seen=0
for a in "$@"; do
  if [ "$seen" -eq 1 ]; then args+=("$a"); continue; fi
  [ "$a" = "--" ] && seen=1
done
if [ -n "${SLOW_SCOPE_UNIT_FILE:-}" ] && [ -n "$unit" ]; then
  printf '%s\n' "$unit" >> "$SLOW_SCOPE_UNIT_FILE"
fi
if [ -n "$unit" ] && [ -n "${SLOW_REAL_SYSTEMD_RUN:-}" ]; then
  # setsid so the delayed scope is not killed with the worker's process group
  # before the 3s mark. Record the launcher pid (session leader) for cleanup.
  # $0 is the real systemd-run path, $1 the unit, $2 the pidfile.
  setsid /bin/bash -c 'printf "%s\n" $$ >> "$2"; sleep 3; exec "$0" --user --scope --quiet --unit="$1" -- /bin/sleep 20' \
    "$SLOW_REAL_SYSTEMD_RUN" "$unit" "${SLOW_LAUNCHER_PIDFILE:-/dev/null}" >/dev/null 2>&1 &
fi
exec "${args[@]}"
FAKE
  chmod +x "$SLOWBIN/systemd-run"
  RD4="$TEST_TMP/runs/slow"
  OUTF4="$TEST_TMP/slow.out"
  ( cd "$SBX" && PATH="$SLOWBIN:$STUBDIR:$PATH" \
    SLOW_SCOPE_UNIT_FILE="$SLOW_UNIT_FILE" \
    SLOW_REAL_SYSTEMD_RUN="$SLOW_REAL_SYSTEMD_RUN" \
    SLOW_LAUNCHER_PIDFILE="$SLOW_LAUNCHER_PID" \
    KIMI_STUB_START_LOG="$SLOW_STARTS" KIMI_STUB_PIDFILE="$SLOW_WORKER_PID" \
    bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" \
      --run-id cg4 --run-dir "$RD4" --tool-cap 1 --timeout 30 --handoff-timeout 5 --poll 0.2 \
      --kimi-bin "$STUBDIR/kimi" >"$OUTF4" 2>"$TEST_TMP/slow.err" ) &
  RAIL4=$!
  i=0
  while kill -0 "$RAIL4" 2>/dev/null && [ "$i" -lt 40 ]; do
    sleep 0.5
    i=$((i+1))
  done
  if kill -0 "$RAIL4" 2>/dev/null; then
    kill -TERM "$RAIL4" 2>/dev/null || true
    sleep 0.5
    kill -KILL "$RAIL4" 2>/dev/null || true
    fail "4: tool-call cap did not stop the turn"
  fi
  wait "$RAIL4" 2>/dev/null || true
  if [ -s "$SLOW_WORKER_PID" ]; then
    kill -KILL "$(cat "$SLOW_WORKER_PID")" 2>/dev/null || true
  fi
  cleanup_slow_scope
  OUT4="$(cat "$OUTF4" 2>/dev/null || true)"
  START_LINES=0
  if [ -f "$SLOW_STARTS" ]; then START_LINES="$(grep -c . "$SLOW_STARTS" || true)"; fi
  assert_eq "$START_LINES" "1" "4: foreman turn started once (slow scope must not relaunch)"
  assert_eq "$(field "$OUT4" status)" "tool_cap_reached" "4: tool-call cap still stops the turn"
  assert_eq "$(field "$OUT4" containment)" "setsid" "4: slow scope reports containment setsid"
  if [ ! -s "$SLOW_LAUNCHER_PID" ]; then
    fail "4: launcher pidfile is non-empty — got empty"
  else
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      if kill -0 "$p" 2>/dev/null; then
        fail "4: launcher pid $p is dead after cleanup"
      fi
    done < "$SLOW_LAUNCHER_PID"
  fi
  if [ ! -s "$SLOW_UNIT_FILE" ]; then
    fail "4: scope unit file is non-empty — got empty"
  else
    while IFS= read -r u; do
      [ -n "$u" ] || continue
      st="$(systemctl --user is-active "$u" 2>/dev/null || true)"
      if [ "$st" = "active" ] || [ "$st" = "activating" ]; then
        fail "4: unit $u is not active after cleanup — got $st"
      fi
    done < "$SLOW_UNIT_FILE"
  fi
fi

finalize_test
