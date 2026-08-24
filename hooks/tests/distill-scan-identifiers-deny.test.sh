#!/usr/bin/env bash
# hooks/tests/distill-scan-identifiers-deny.test.sh — regression: a stale
# ~/.autopilot/distill/identifiers.deny (from the previously-documented, now-removed
# deny-list config surface — ADR-0001, references/knowledge-routing.md §5) must warn
# on stderr ONLY and never change the --path lint's exit code or stdout.
#
# HOME is redirected to the per-test sandbox (lib.sh's HOOK_HOME) — this test never
# touches the operator's real ~/.autopilot.

set -uo pipefail

. "$(dirname "$0")/lib.sh"

SCAN_JS="$REPO_ROOT/scripts/distill-scan.js"
DIRTY_DIR="$REPO_ROOT/hooks/tests/fixtures/identifier-scan/dirty"
CLEAN_DIR="$REPO_ROOT/hooks/tests/fixtures/identifier-scan/clean"

run_with_home() {
  local home="$1"; shift
  local out
  local exit_code=0
  out=$(HOME="$home" node "$SCAN_JS" "$@" 2>&1) || exit_code=$?
  __OUT="$out"
  __EXIT="$exit_code"
}

# Baseline: no identifiers.deny present in this sandboxed HOME.
NO_DENY_HOME="$TEST_TMP/home-no-deny"
mkdir -p "$NO_DENY_HOME"

echo "Testing --path lint without a stale identifiers.deny (baseline)..."
run_with_home "$NO_DENY_HOME" --path "$DIRTY_DIR"
BASELINE_EXIT="$__EXIT"
assert_exit_code "$BASELINE_EXIT" 1 "baseline: dirty dir exits 1"
assert_not_contains "$__OUT" "identifiers.deny is now ignored" "baseline: no stale-deny warning when file absent"

echo "Testing --path lint clean dir without a stale identifiers.deny (baseline)..."
run_with_home "$NO_DENY_HOME" --path "$CLEAN_DIR"
BASELINE_CLEAN_EXIT="$__EXIT"
assert_exit_code "$BASELINE_CLEAN_EXIT" 0 "baseline: clean dir exits 0"

# Now create a stale identifiers.deny in an ISOLATED sandbox HOME (never the real one).
DENY_HOME="$TEST_TMP/home-with-deny"
mkdir -p "$DENY_HOME/.autopilot/distill"
echo "some-old-hostname" > "$DENY_HOME/.autopilot/distill/identifiers.deny"

echo "Testing --path lint WITH a stale identifiers.deny present..."
run_with_home "$DENY_HOME" --path "$DIRTY_DIR"
assert_exit_code "$__EXIT" "$BASELINE_EXIT" "stale identifiers.deny: exit code unchanged vs baseline (dirty)"
assert_contains "$__OUT" "identifiers.deny is now ignored (ADR-0001); see references/knowledge-routing.md §5" "stale identifiers.deny: warning line present"

run_with_home "$DENY_HOME" --path "$CLEAN_DIR"
assert_exit_code "$__EXIT" "$BASELINE_CLEAN_EXIT" "stale identifiers.deny: exit code unchanged vs baseline (clean)"

# stdout must be byte-identical to baseline — the warning is stderr-only. Re-run
# capturing streams separately to check this precisely.
BASELINE_STDOUT=$(HOME="$NO_DENY_HOME" node "$SCAN_JS" --path "$DIRTY_DIR" 2>/dev/null)
DENY_STDOUT=$(HOME="$DENY_HOME" node "$SCAN_JS" --path "$DIRTY_DIR" 2>/dev/null)
assert_eq "$DENY_STDOUT" "$BASELINE_STDOUT" "stale identifiers.deny: stdout byte-identical to baseline (warning is stderr-only)"

DENY_STDERR=$(HOME="$DENY_HOME" node "$SCAN_JS" --path "$DIRTY_DIR" 2>&1 1>/dev/null)
assert_contains "$DENY_STDERR" "identifiers.deny is now ignored" "stale identifiers.deny: warning appears on stderr"

finalize_test
