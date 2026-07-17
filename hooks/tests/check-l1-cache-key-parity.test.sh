#!/usr/bin/env bash
# check-l1-cache-key-parity.test.sh — tests for scripts/check-l1-cache-key-parity.js
. "$(dirname "$0")/lib.sh"

# --- Green case (real repo) ----------------------------------------------------
node "$REPO_ROOT/scripts/check-l1-cache-key-parity.js"; assert_exit_code "$?" 0 "repo is in parity"

# --- Green case with --json ---------------------------------------------------
out_json="$(node "$REPO_ROOT/scripts/check-l1-cache-key-parity.js" --json)"; rc_json=$?
assert_exit_code "$rc_json" 0 "json flag exit 0 on green repo"
assert_contains "$out_json" '"ok":true' "json output contains ok:true"

# --- Red case (drifted repo in sandbox) ---------------------------------------
sandbox="$TEST_TMP/sandbox"
mkdir -p "$sandbox/scripts" "$sandbox/.github/workflows" "$sandbox/hooks/tests"
cp "$REPO_ROOT/scripts/check-l1-cache-key-parity.js" "$sandbox/scripts/"

# drifted workflow: vitest version bumped so it no longer matches the test pin
printf '          key: }-l1-js-runtime-jest29.7.0-vitest9.9.9\n' > "$sandbox/.github/workflows/test.yml"
# test file keeps the original pins
printf '  local jest_ver="29.7.0"\n  local vitest_ver="2.1.8"\n' > "$sandbox/hooks/tests/check-test-integrity-l1.test.sh"

out="$(node "$sandbox/scripts/check-l1-cache-key-parity.js" 2>&1)"; rc=$?
assert_exit_code "$rc" 1 "drift detected -> exit 1"
assert_contains "$out" "9.9.9" "drift message names the drifted value"

# --- Red case with --json -----------------------------------------------------
out_json_red="$(node "$sandbox/scripts/check-l1-cache-key-parity.js" --json 2>&1)"; rc_json_red=$?
assert_exit_code "$rc_json_red" 1 "json flag exit 1 on red repo"
assert_contains "$out_json_red" '"ok":false' "json output contains ok:false on red repo"

finalize_test
