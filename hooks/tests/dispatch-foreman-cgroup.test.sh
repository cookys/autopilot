#!/usr/bin/env bash
# RED at 027f7d863: FAIL [dispatch-foreman-cgroup] 1 passed, 2 failed — containment expected 'cgroup' got 'setsid'; setsid grandchild still alive after cap teardown
# Foreman rail cgroup containment: a setsid grandchild must die on cap teardown
# when a systemd user scope is usable, and containment must fall back to setsid
# when WORKER_CONTAINMENT_FORCE_NO_CGROUP=1.
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
if [ "$cont" -eq 0 ] && [ "${KIMI_STUB_SPAWN_GC:-}" = "1" ]; then
  setsid bash -c 'echo $$ > "$1"; exec sleep 300' bash "$KIMI_STUB_GC_PID" &
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

# --- case 1: scope reap kills the setsid grandchild ---
if ! systemd-run --user --scope --quiet -- true >/dev/null 2>&1; then
  echo "SKIP: systemd-run --user --scope is unusable on this host"
else
  GC_FILE="$TEST_TMP/gc.pid"
  rm -f "$GC_FILE"
  RD="$TEST_TMP/runs/cg"
  OUT="$(cd "$SBX" && PATH="$STUBDIR:$PATH" \
    KIMI_STUB_SPAWN_GC=1 KIMI_STUB_GC_PID="$GC_FILE" \
    bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" \
      --run-id cg1 --run-dir "$RD" --tool-cap 1 --timeout 30 --handoff-timeout 5 --poll 0.2 \
      --kimi-bin "$STUBDIR/kimi" 2>"$TEST_TMP/cg.err")" || true
  if [ -f "$GC_FILE" ]; then GC_PID="$(cat "$GC_FILE")"; fi
  assert_eq "$(field "$OUT" containment)" "cgroup" "1: containment is cgroup after a verified scope"
  alive=1
  i=0
  while [ "$i" -lt 20 ]; do
    if [ -z "${GC_PID:-}" ] || ! kill -0 "$GC_PID" 2>/dev/null; then alive=0; break; fi
    sleep 0.25
    i=$((i+1))
  done
  assert_eq "$alive" "0" "1: setsid grandchild is dead after cap teardown (pid ${GC_PID:-missing})"
  if [ -n "${GC_PID:-}" ]; then kill -KILL "$GC_PID" 2>/dev/null || true; GC_PID=""; fi
fi

# --- case 2: seam forces the setsid fallback ---
RD2="$TEST_TMP/runs/fb"
OUT2="$(cd "$SBX" && PATH="$STUBDIR:$PATH" WORKER_CONTAINMENT_FORCE_NO_CGROUP=1 \
  bash "$SCRIPT" --brief-file "$BRIEF" --plan-file "$PLAN" \
    --run-id cg2 --run-dir "$RD2" --tool-cap 1 --timeout 20 --handoff-timeout 5 --poll 0.2 \
    --kimi-bin "$STUBDIR/kimi" 2>"$TEST_TMP/fb.err")" || true
assert_eq "$(field "$OUT2" containment)" "setsid" "2: seam forces containment setsid"

finalize_test
