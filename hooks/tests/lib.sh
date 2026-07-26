# hooks/tests/lib.sh — assertions + per-test sandbox for *.test.sh scripts.
#
# Source this from each test file:
#   . "$(dirname "$0")/lib.sh"
#
# Provides:
#   - TEST_NAME, TEST_TMP (mktemp -d, auto-cleaned on exit)
#   - HOOKS_DIR, REPO_ROOT
#   - assert_eq, assert_neq, assert_contains, assert_not_contains
#   - assert_file_exists, assert_file_absent, assert_exit_code
#   - run_hook (capture stdout/stderr/exit into vars)
#   - fail (print + exit 1), finalize_test (call once at EOF: PASS/FAIL summary + exit)
#   - Per-test sandbox AUTOPILOT_HOME (overrides ~/.autopilot so tests don't
#     touch the user's real state). Hooks read os.homedir() → HOME, so we set
#     HOME to TEST_TMP for hook invocations via run_hook.

set -uo pipefail   # NOT -e — we want to handle assertion failures explicitly

TEST_NAME="${TEST_NAME:-$(basename "${BASH_SOURCE[1]:-$0}" .test.sh)}"
TEST_TMP=$(mktemp -d -t "autopilot-test-${TEST_NAME}-XXXXXX")
HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$HOOKS_DIR/.." && pwd)"

# Each hook reads from os.homedir(). Redirecting HOME to the per-test sandbox
# isolates ~/.autopilot/* writes.
HOOK_HOME="$TEST_TMP/home"
mkdir -p "$HOOK_HOME"

# Some hooks also write to os.tmpdir() (accumulator.js, batch-format.js,
# suggest-compact.js, intent-capture.js SESSION_TOOL_COUNTER). Redirect TMPDIR
# alongside HOME so test runs don't leak `/tmp/claude-*` files into the host
# tmp namespace. The hook-spawning `run_hook` exports this for the child.
HOOK_TMPDIR="$TEST_TMP/tmp"
mkdir -p "$HOOK_TMPDIR"

# Export the redirect GLOBALLY, not just via run_hook: tests that invoke
# scripts/*.sh directly (dispatch-hetero.test.sh etc.) used to inherit the REAL
# /tmp, so every mktemp the script-under-test performed leaked into the host tmp
# namespace — 616 hetero-feat-*/hetero-t-* fixture logs accumulated and helped
# exhaust the /tmp per-user quota (2026-07-13 incident, BACKLOG (c)). TEST_TMP
# itself was created above with the REAL TMPDIR (it must be, to survive this
# export) and the EXIT trap cleans everything under it. A test that needs a
# different TMPDIR can still export its own after sourcing lib.sh.
export TMPDIR="$HOOK_TMPDIR"

cleanup_test_tmp() { rm -rf "$TEST_TMP"; }
trap cleanup_test_tmp EXIT

# Some legacy dispatch integration tests exercise behavior after the engine-admission
# precondition. Production now projects every disk scorecard pass as provisional, so
# those tests use a process-local Node preload to preserve their downstream coverage.
# This helper changes only the calling test's NODE_OPTIONS; production exposes no
# bypass flag, environment switch, or serializable authority format.
enable_legacy_scorecard_test_projection() {
  local preload="$TEST_TMP/legacy-scorecard-test-projection.cjs"
  cat > "$preload" <<'NODE'
'use strict';
const path = require('path');
const childProcess = require('child_process');
const originalSpawnSync = childProcess.spawnSync;

childProcess.spawnSync = function projectedSpawnSync(command, args, options) {
  const result = originalSpawnSync.call(this, command, args, options);
  if (!Array.isArray(args) || args.length < 2
      || path.basename(String(args[0])) !== 'engine-scorecard.js'
      || args[1] !== 'current' || result.status !== 0) {
    return result;
  }
  try {
    const rows = JSON.parse(String(result.stdout || ''));
    if (!Array.isArray(rows)) return result;
    const projected = rows.map((row) => (
      row && row.status === 'provisional' && row.observed_status === 'qualified'
        ? { ...row, status: 'qualified' }
        : row
    ));
    return { ...result, stdout: `${JSON.stringify(projected)}\n` };
  } catch {
    return result;
  }
};
NODE
  if [ -n "${NODE_OPTIONS:-}" ]; then
    export NODE_OPTIONS="$NODE_OPTIONS --require=$preload"
  else
    export NODE_OPTIONS="--require=$preload"
  fi
}

# Assertion bookkeeping for the run.sh summary.
__TEST_PASS_COUNT=0
__TEST_FAIL_MSGS=()

fail() {
  echo "FAIL [$TEST_NAME] $*" >&2
  __TEST_FAIL_MSGS+=("$*")
}

assert_eq() {
  # assert_eq <actual> <expected> <msg>
  if [ "$1" = "$2" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "${3:-assert_eq}: expected '$2', got '$1'"
  fi
}

assert_neq() {
  if [ "$1" != "$2" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "${3:-assert_neq}: expected != '$2', got '$1'"
  fi
}

assert_contains() {
  # assert_contains <haystack> <needle> <msg>
  case "$1" in
    *"$2"*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
    *)      fail "${3:-assert_contains}: '$2' not found in output" ;;
  esac
}

assert_not_contains() {
  case "$1" in
    *"$2"*) fail "${3:-assert_not_contains}: unexpected '$2' in output" ;;
    *)      __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  esac
}

assert_file_exists() {
  if [ -e "$1" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "${2:-assert_file_exists}: $1 does not exist"
  fi
}

assert_file_absent() {
  if [ ! -e "$1" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "${2:-assert_file_absent}: $1 exists but should not"
  fi
}

assert_exit_code() {
  # assert_exit_code <actual> <expected> <msg>
  if [ "$1" = "$2" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "${3:-assert_exit_code}: expected exit $2, got $1"
  fi
}

# run_hook <hook-relative-path> [<stdin>]
# Captures into __RUN_STDOUT, __RUN_STDERR, __RUN_EXIT. Uses sandboxed HOME.
run_hook() {
  local hook="$1"
  local stdin_content="${2:-}"
  local stdout_file="$TEST_TMP/.stdout.$$"
  local stderr_file="$TEST_TMP/.stderr.$$"
  local cmd_exit

  case "$hook" in
    *.js)
      if [ -n "$stdin_content" ]; then
        HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
          node "$HOOKS_DIR/$hook" >"$stdout_file" 2>"$stderr_file" <<< "$stdin_content"
      else
        HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
          node "$HOOKS_DIR/$hook" >"$stdout_file" 2>"$stderr_file" </dev/null
      fi
      ;;
    *.sh)
      if [ -n "$stdin_content" ]; then
        HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
          bash "$HOOKS_DIR/$hook" >"$stdout_file" 2>"$stderr_file" <<< "$stdin_content"
      else
        HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
          bash "$HOOKS_DIR/$hook" >"$stdout_file" 2>"$stderr_file" </dev/null
      fi
      ;;
    *)
      fail "run_hook: unsupported hook extension: $hook"
      __RUN_STDOUT=""; __RUN_STDERR=""; __RUN_EXIT=255
      return
      ;;
  esac
  cmd_exit=$?
  __RUN_STDOUT=$(cat "$stdout_file")
  __RUN_STDERR=$(cat "$stderr_file")
  __RUN_EXIT=$cmd_exit
  rm -f "$stdout_file" "$stderr_file"
}

# setup_sync_version_sandbox <sandbox-dir>
# Materialises a self-contained mini-repo so sync-version.js can be invoked
# WITHOUT touching the live repo's manifest files. sync-version uses
# `path.resolve(__dirname, '..')` to find REPO_ROOT, so by copying the script
# into <sandbox-dir>/scripts/ and the tracked mirrors into the sandbox at the
# same relative paths, the script edits the sandbox copies.
#
# Echoes the sandbox script's full path. Caller can pass it to `node`.
#
# Files mirrored. sync-version's editPlan writes manifest versions and description
# fragments where it owns them; README.md = version badge only. README.md +
# hooks/README.md are still copied so round-trip / dry-run can assert byte-identity
# where appropriate — the hooks badge + hooks/README tier tables are owned by
# check-hook-inventory.js, NOT sync-version, so they must stay untouched:
#   - .claude-plugin/plugin.json   (canonical)
#   - plugin.json                  (root mirror)
#   - .claude-plugin/marketplace.json
#   - platforms/codex/plugin/.codex-plugin/plugin.json
#   - README.md                    (version badge; hooks badge NOT sync-version's)
#   - hooks/README.md              (untouched by sync-version; byte-identity guard)
setup_sync_version_sandbox() {
  local sandbox="$1"
  mkdir -p "$sandbox/.claude-plugin" "$sandbox/scripts" "$sandbox/hooks" "$sandbox/platforms/codex/plugin/.codex-plugin" "$sandbox/platforms/codex/.agents/plugins"
  cp "$REPO_ROOT/scripts/sync-version.js"        "$sandbox/scripts/sync-version.js"
  cp "$REPO_ROOT/.claude-plugin/plugin.json"     "$sandbox/.claude-plugin/plugin.json"
  cp "$REPO_ROOT/.claude-plugin/marketplace.json" "$sandbox/.claude-plugin/marketplace.json"
  cp "$REPO_ROOT/plugin.json"                    "$sandbox/plugin.json"
  cp "$REPO_ROOT/platforms/codex/plugin/.codex-plugin/plugin.json" "$sandbox/platforms/codex/plugin/.codex-plugin/plugin.json"
  cp "$REPO_ROOT/platforms/codex/.agents/plugins/marketplace.json" "$sandbox/platforms/codex/.agents/plugins/marketplace.json"
  cp "$REPO_ROOT/README.md"                      "$sandbox/README.md"
  cp "$REPO_ROOT/hooks/README.md"                "$sandbox/hooks/README.md"
  echo "$sandbox/scripts/sync-version.js"
}

# ---------------------------------------------------------------------------
# Timing helpers (load-sensitive test windows under --parallel contention)
# ---------------------------------------------------------------------------
# AUTOPILOT_TEST_TIMING_FACTOR: positive integer multiplier (default 1).
# factor=1 keeps serial timings byte-identical to the historical suite;
# raise under CPU load to widen upper-bound margins and poll timeouts.
_AUTOPILOT_TEST_TIMING_FACTOR_RAW="${AUTOPILOT_TEST_TIMING_FACTOR:-1}"
case "$_AUTOPILOT_TEST_TIMING_FACTOR_RAW" in
  ''|*[!0-9]*) AUTOPILOT_TEST_TIMING_FACTOR=1 ;;
  0)           AUTOPILOT_TEST_TIMING_FACTOR=1 ;;
  *)           AUTOPILOT_TEST_TIMING_FACTOR="$_AUTOPILOT_TEST_TIMING_FACTOR_RAW" ;;
esac
unset _AUTOPILOT_TEST_TIMING_FACTOR_RAW

# test_timing_scale <base_int>
# Echoes base_int * factor (integer arithmetic). Never smaller than base_int
# (floor is implicit in bash $(( )); overflow / zero-factor clamp to base).
test_timing_scale() {
  local base="${1:?test_timing_scale: base_int required}"
  local factor="${AUTOPILOT_TEST_TIMING_FACTOR:-1}"
  local scaled=$(( base * factor ))
  if [ "$scaled" -lt "$base" ]; then
    scaled=$base
  fi
  printf '%s\n' "$scaled"
}

# poll_until <timeout_secs> <shell-cmd...>
# Re-evaluate the command every ~0.1s until it exits 0 (return 0) or the
# (timing-factor-scaled) timeout elapses (return 1). Dependency-free (bash +
# sleep). Safe under `set -uo pipefail`: a failing command is expected while
# waiting and does not abort the helper.
poll_until() {
  local timeout_base="${1:?poll_until: timeout_secs required}"
  shift
  if [ "$#" -lt 1 ]; then
    echo "poll_until: command required" >&2
    return 1
  fi
  local timeout
  timeout="$(test_timing_scale "$timeout_base")"
  local start now
  start=$(date +%s)
  while true; do
    if "$@"; then
      return 0
    fi
    now=$(date +%s)
    if [ $(( now - start )) -ge "$timeout" ]; then
      return 1
    fi
    sleep 0.1
  done
}

# Call once at end of each *.test.sh file.
finalize_test() {
  if [ "${#__TEST_FAIL_MSGS[@]}" -eq 0 ]; then
    echo "PASS [$TEST_NAME] $__TEST_PASS_COUNT assertions"
    exit 0
  else
    echo "FAIL [$TEST_NAME] $__TEST_PASS_COUNT passed, ${#__TEST_FAIL_MSGS[@]} failed" >&2
    for msg in "${__TEST_FAIL_MSGS[@]}"; do echo "      - $msg" >&2; done
    exit 1
  fi
}
