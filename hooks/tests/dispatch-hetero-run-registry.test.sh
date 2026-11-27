#!/usr/bin/env bash
# Integration coverage for the registry around an actual dispatch, with no model calls.
. "$(dirname "$0")/lib.sh"
export AUTOPILOT_TEST_CN_GATE_OFF=1 DISPATCH_QUIET=1 AUTOPILOT_ENDPOINT_PREPROBE=off
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/state/runs"
export AUTOPILOT_HETERO_RUNS_DIR="$TEST_TMP/state/hetero-runs"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude"
export AUTOPILOT_SETTLE_MS=0
mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR" "$CLAUDE_CONFIG_DIR" "$TEST_TMP/bin" "$TEST_TMP/wts"
cat > "$TEST_TMP/bin/grok" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = --version ]; then echo 'grok-cli 0.2.111'; exit 0; fi
case " $* " in *' __autopilot_probe__ '*) echo 'unknown effort level: low, medium, high, xhigh' >&2; exit 2;; esac
printf '%s\n' "$$" > "$FAKE_DIR/pid"
while [ ! -e "$FAKE_DIR/release" ]; do sleep 0.1; done
printf 'fixture\n' > fixture.txt
exit "${FAKE_EXIT:-0}"
STUB
chmod +x "$TEST_TMP/bin/grok"
GIT='git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false'
mkdir -p "$TEST_TMP/repo"
$GIT -C "$TEST_TMP/repo" init -q
$GIT -C "$TEST_TMP/repo" commit -q --allow-empty -m base
printf 'edit fixture.txt\n' > "$TEST_TMP/prompt"
STARTED_PIDS=()
cleanup_registry_test() {
  for pid in "${STARTED_PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${STARTED_PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
  cleanup_test_tmp
}
trap cleanup_registry_test EXIT
wait_file() {
  local file="$1" i
  for ((i=0; i<300; i++)); do [ -s "$file" ] && return 0; sleep 0.1; done
  echo "timed out waiting for $file" >&2; return 1
}
field() {
  node -e 'const r=require(process.argv[1]).getRun(process.argv[2],process.argv[3]);process.stdout.write(r ? String(r[process.argv[4]]) : "missing")' "$REPO_ROOT/scripts/lib/hetero-run-registry.js" "$1" "$AUTOPILOT_HETERO_RUNS_DIR" "$2"
}
launch() {
  local tag="$1" script="$2"; shift 2
  export FAKE_DIR="$TEST_TMP/$tag"
  mkdir -p "$FAKE_DIR"
  ( cd "$TEST_TMP/repo" && exec "$script" --no-verify-tip --context-window off --runner grok --pin-reason "test fixture" --grok-bin "$TEST_TMP/bin/grok" --branch "feat/$tag" --worktree-parent "$TEST_TMP/wts" --prompt-file "$TEST_TMP/prompt" --run-id "$tag" "$@" ) >"$FAKE_DIR/out" 2>"$FAKE_DIR/err" &
  LAUNCH_PID=$!; STARTED_PIDS+=("$LAUNCH_PID")
  wait_file "$FAKE_DIR/pid" || { cat "$FAKE_DIR/err" >&2; return 1; }
  if ! wait_file "$AUTOPILOT_HETERO_RUNS_DIR/$tag.json"; then
    touch "$FAKE_DIR/release"
    wait "$LAUNCH_PID" 2>/dev/null || true
    return 1
  fi
}
launch success "$REPO_ROOT/scripts/dispatch-hetero.sh" || exit 1
assert_eq running "$(field success status)" 'success: running while child lives'
assert_eq true "$(field success inflight)" 'success: reader reports inflight'
touch "$FAKE_DIR/release"
wait "$LAUNCH_PID"; rc=$?
assert_eq 0 "$rc" 'success: dispatch exits zero'
assert_eq done "$(field success status)" 'success: terminal status'
assert_eq false "$(field success inflight)" 'success: reader reports not inflight'
assert_eq 0 "$(node -e 'const fs=require("fs");process.stdout.write(String(fs.readdirSync(process.argv[1]).filter(n=>n.includes(".tmp")).length))' "$AUTOPILOT_HETERO_RUNS_DIR")" 'success: no temporary registry files'
export FAKE_EXIT=7
launch failure "$REPO_ROOT/scripts/dispatch-hetero.sh" || exit 1
touch "$FAKE_DIR/release"
wait "$LAUNCH_PID"; rc=$?
assert_neq 0 "$rc" 'failure: dispatch exits nonzero'
assert_eq failed "$(field failure status)" 'failure: registry records failed'
unset FAKE_EXIT
launch detached "$REPO_ROOT/scripts/dispatch-hetero.sh" --ledger "$TEST_TMP/ledger" --stage implement || exit 1
worker_pid="$(cat "$FAKE_DIR/pid")"
STARTED_PIDS+=("$worker_pid")
kill -KILL "$LAUNCH_PID"
wait "$LAUNCH_PID" 2>/dev/null || true
kill -0 "$worker_pid" 2>/dev/null; assert_eq 0 "$?" 'detached: fake child survives launcher'
assert_eq running "$(field detached status)" 'detached: registry remains running'
assert_eq true "$(field detached inflight)" 'detached: reader reports inflight'
touch "$FAKE_DIR/release"
wait_file "$TEST_TMP/ledger.results/detached.implement.exit" || exit 1
assert_eq done "$(field detached status)" 'detached: registry reaches done'
finalize_test
