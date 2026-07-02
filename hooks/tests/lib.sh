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
#   - fail (print + exit 1), pass_test (print + exit 0)
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

cleanup_test_tmp() { rm -rf "$TEST_TMP"; }
trap cleanup_test_tmp EXIT

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
