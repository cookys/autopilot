#!/usr/bin/env bash
# Idle / soft-deadline / hard-cap / remote-ref fingerprint for dispatch-hetero.sh.
# RED before the idle watchdog: a stub that keeps printing past --timeout was
# killed with "wall timeout"; a silent stub was not "idle timeout"; hard cap
# did not exist; refs/remotes/* mid-run was main_checkout_mutated.
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_HETERO_HARD_TIMEOUT 2>/dev/null || true
export AUTOPILOT_GROK_EFFORT_PROBE=0
export AUTOPILOT_HETERO_SAMPLE_S=1

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"

json_get() {
  echo "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const k=process.argv[1];let v=o;for (const p of k.split('.')) v=v==null?undefined:v[p];if(v===undefined)console.log('');else if(typeof v==='object')console.log(JSON.stringify(v));else console.log(String(v))}catch(e){console.log('')}})" "$2"
}
last_json() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }

install_stub() { # dest mode main: mode and main are baked in; a sudo containment wrapper's env_reset drops env vars
  { cat <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--list-models" ]; then
  echo "cursor-grok-4.6-low - Grok 4.6 (low)"
  exit 0
fi
case " $* " in *" __autopilot_probe__ "*)
  echo "Error: unknown effort level '__autopilot_probe__'" >&2
  exit 1 ;;
esac
EOF
    printf 'HETERO_IDLE_MODE=%q\nHETERO_IDLE_MAIN=%q\n' "${2:-}" "${3:-}"
    cat <<'EOF'
mode="${HETERO_IDLE_MODE:-finish}"
case "$mode" in
  extend)
    i=0
    while [ "$i" -lt 8 ]; do echo "tick $i"; sleep 1; i=$((i + 1)); done
    echo ok > ok.txt
    git add ok.txt
    git -c user.email=t@t -c user.name=t commit -q -m "extend commit"
    exit 0
    ;;
  idle)
    echo ok > ok.txt
    git add ok.txt
    git -c user.email=t@t -c user.name=t commit -q -m "idle commit"
    sleep 30
    exit 0
    ;;
  hard)
    i=0
    while [ "$i" -lt 30 ]; do echo "tick $i"; sleep 1; i=$((i + 1)); done
    exit 0
    ;;
  remote)
    sleep 1
    git --git-dir="$(git -C "$HETERO_IDLE_MAIN" rev-parse --git-dir)" update-ref refs/remotes/origin/x HEAD
    echo ok > ok.txt
    git add ok.txt
    git -c user.email=t@t -c user.name=t commit -q -m "remote commit"
    exit 0
    ;;
  heads)
    sleep 1
    git -C "$HETERO_IDLE_MAIN" checkout -q -b y
    echo ok > ok.txt
    git add ok.txt
    git -c user.email=t@t -c user.name=t commit -q -m "heads commit"
    exit 0
    ;;
  *)
    echo ok > ok.txt
    git add ok.txt
    git -c user.email=t@t -c user.name=t commit -q -m "fast commit"
    exit 0
    ;;
esac
EOF
  } > "$1"
  chmod +x "$1"
}

run_case() {
  local branch="$1" mode="$2"
  shift 2
  local stub="$TEST_TMP/grok-$mode" runs="$TEST_TMP/runs-$mode"
  mkdir -p "$runs"
  install_stub "$stub" "$mode" "$SBX"
  (cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$runs" HETERO_IDLE_MODE="$mode" HETERO_IDLE_MAIN="$SBX" \
    "$SCRIPT" --no-verify-tip --runner grok --pin-reason "test fixture" --model grok-4.5 --effort high --grok-bin "$stub" \
    --branch "$branch" --prompt-file "$PROMPT" "$@" 2>&1) || true
}

# a. printing past --timeout is extended, not killed
OUT="$(run_case feat/idle-extend extend --timeout 3s --idle-timeout 4s --hard-timeout 30s)"
JSON="$(last_json "$OUT")"
[ -n "$JSON" ] || fail "a: missing JSON: $OUT"
assert_eq "committed" "$(json_get "$JSON" status)" "a: status committed"
assert_eq "false" "$(json_get "$JSON" timed_out)" "a: not timed out"
LOG="$(json_get "$JSON" agent_log)"
assert_contains "$(cat "$LOG")" "dispatch-hetero: extend: progress seen" "a: agent log has extend:"

# b. commit then silent past idle
OUT="$(run_case feat/idle-kill idle --timeout 30s --idle-timeout 3s --hard-timeout 30s)"
JSON="$(last_json "$OUT")"
[ -n "$JSON" ] || fail "b: missing JSON: $OUT"
assert_eq "failure" "$(json_get "$JSON" status)" "b: status failure"
assert_contains "$(json_get "$JSON" error)" "idle timeout" "b: idle timeout error"
assert_eq "idle" "$(json_get "$JSON" timeout_kind)" "b: timeout_kind idle"
SHA="$(json_get "$JSON" candidate_ref)"
[ -n "$SHA" ] && [ "$SHA" != "null" ] || fail "b: candidate_ref missing"
WT="$(json_get "$JSON" worktree)"
[ -d "$WT" ] || fail "b: worktree removed on idle kill ($WT)"
assert_eq "$SHA" "$(git -C "$WT" rev-parse HEAD)" "b: candidate_ref is the stub commit"

# c. still printing past the hard cap
OUT="$(run_case feat/idle-hard hard --timeout 2s --idle-timeout 4s --hard-timeout 3s)"
JSON="$(last_json "$OUT")"
[ -n "$JSON" ] || fail "c: missing JSON: $OUT"
assert_eq "failure" "$(json_get "$JSON" status)" "c: status failure"
assert_eq "hard" "$(json_get "$JSON" timeout_kind)" "c: timeout_kind hard"
assert_contains "$(json_get "$JSON" error)" "hard timeout" "c: hard timeout error"
assert_eq "hard" "$(json_get "$JSON" killed_at.signal)" "c: killed_at.signal"

# d. finishes before --timeout
OUT="$(run_case feat/idle-fast finish --timeout 8s --idle-timeout 6s --hard-timeout 30s)"
JSON="$(last_json "$OUT")"
[ -n "$JSON" ] || fail "d: missing JSON: $OUT"
assert_eq "committed" "$(json_get "$JSON" status)" "d: status committed"
assert_eq "false" "$(json_get "$JSON" timed_out)" "d: not timed out"
LOG="$(json_get "$JSON" agent_log)"
if [ -f "$LOG" ] && grep -q "extend:" "$LOG"; then
  fail "d: extend line on a run that finished inside --timeout"
fi

# e. refs/remotes added in the main checkout mid-run is not a mutation
OUT="$(run_case feat/idle-remote remote --timeout 20s --idle-timeout 15s --hard-timeout 30s)"
JSON="$(last_json "$OUT")"
[ -n "$JSON" ] || fail "e: missing JSON: $OUT"
assert_eq "committed" "$(json_get "$JSON" status)" "e: round accepted (status=$(json_get "$JSON" status) err=$(json_get "$JSON" error))"
assert_not_contains "$JSON" "main_checkout_mutated" "e: remotes are not a mutation"

# f. negative control: refs/heads/y mid-run still boundary_rejected
OUT="$(run_case feat/idle-heads heads --timeout 20s --idle-timeout 15s --hard-timeout 30s)"
JSON="$(last_json "$OUT")"
[ -n "$JSON" ] || fail "f: missing JSON: $OUT"
assert_eq "boundary_rejected" "$(json_get "$JSON" status)" "f: heads ref still boundary_rejected (err=$(json_get "$JSON" error))"
assert_contains "$JSON" "main_checkout_mutated" "f: boundary_code main_checkout_mutated"

finalize_test
