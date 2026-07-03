#!/usr/bin/env bash
# Independent unit test for scripts/bench-engine-capability.sh
# Exercises dry-run plans, argument validation, and help outputs (no network / live CLI).

. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/bench-engine-capability.sh"

# 1. --help exits 0 and prints usage
HELP_OUT="$("$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit code"
assert_contains "$HELP_OUT" "Usage:" "--help output contains Usage"
assert_contains "$HELP_OUT" "--runner" "--help output contains --runner option"

# 2. missing options → usage / exit 2
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing options exit code"
assert_contains "$OUT" "Error:" "missing options shows error message"

OUT="$("$SCRIPT" --runner agy --model "gpt-5.5" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing --skill-mode exit code"

# 3. bad --skill-mode → exit 2
OUT="$("$SCRIPT" --runner agy --model "gpt-5.5" --skill-mode invalid 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "invalid --skill-mode exit code"

# 4. --dry-run for native mode prints correct plan
OUT="$("$SCRIPT" --runner agy --model "gpt-5.5" --skill-mode native --dry-run 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "--dry-run native exit code"
assert_contains "$OUT" "Bench plan for runner: agy, model: gpt-5.5, skill-mode: native" "dry-run native matches header"
assert_contains "$OUT" "brainstorm-gate" "dry-run native contains brainstorm-gate"
assert_contains "$OUT" "quality-review-findings-first" "dry-run native contains quality-review-findings-first"
assert_contains "$OUT" "dev-flow-branch-check" "dry-run native contains dev-flow-branch-check"
assert_not_contains "$OUT" "no-skill-claim" "dry-run native does NOT contain no-skill-claim"

# 5. --dry-run for prompt mode prints correct plan
OUT="$("$SCRIPT" --runner agy --model "gpt-5.5" --skill-mode prompt --dry-run 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "--dry-run prompt exit code"
assert_contains "$OUT" "Bench plan for runner: agy, model: gpt-5.5, skill-mode: prompt" "dry-run prompt matches header"
assert_contains "$OUT" "brainstorm-gate" "dry-run prompt contains brainstorm-gate"
assert_contains "$OUT" "no-skill-claim" "dry-run prompt contains no-skill-claim"

# 6. running without --live-spend fails with exit 1
OUT="$("$SCRIPT" --runner agy --model "gpt-5.5" --skill-mode prompt 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "without live-spend exit code"
assert_contains "$OUT" "ERROR: --live-spend is required" "without live-spend mentions required flag"

finalize_test
