#!/usr/bin/env bash
# RED at 027f7d863: FAIL [dispatch-foreman-cgroup] 1 passed, 2 failed — containment expected 'cgroup' got 'setsid'; setsid grandchild still alive after cap teardown
# RED at 26bffb06b: (pid file never written) FAIL [dispatch-foreman-cgroup] 1: gc.pid is non-empty before teardown — got empty
# RED at 26bffb06b: (systemd-run launch exits 1) FAIL [dispatch-foreman-cgroup] 3: failed scope launch reports setsid: expected 'setsid', got 'cgroup'
# Foreman rail cgroup containment: a setsid grandchild must die on cap teardown
# when a systemd user scope is usable, and containment must fall back to setsid
# when WORKER_CONTAINMENT_FORCE_NO_CGROUP=1 or systemd-run fails to start the scope.
. "$(dirname "$0")/lib.sh"

GC_PID=""
cleanup_gc() {
  if [ -n "${GC_PID:-}" ]; then
    kill -KILL "$GC_PID" 2>/dev/null || true
  fi
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
  local i=0 alive=1
  while [ "$i" -lt 20 ]; do
    if [ -z "${GC_PID:-}" ] || ! kill -0 "$GC_PID" 2>/dev/null; then alive=0; break; fi
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

finalize_test
