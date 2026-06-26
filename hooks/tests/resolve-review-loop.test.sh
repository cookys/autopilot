#!/usr/bin/env bash
# resolve-review-loop.sh integration test — default roster, --field, enum
# fallback on garbage, and override precedence. No network.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"

# 1. --help exits 0
HELP_OUT="$(bash "$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit code"
assert_contains "$HELP_OUT" "review-loop" "--help mentions review-loop"

# 2. unknown flag → exit 2
OUT="$(bash "$SCRIPT" --bogus x 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unknown flag exit code"

# 3. default (template) JSON carries the codex roster + is parseable
OUT="$(bash "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "default exit code"
assert_contains "$OUT" '"reviewer_engine": "gpt-5.5"' "default reviewer engine"
assert_contains "$OUT" '"implementer_engine": "gpt-5.3-codex-spark"' "default implementer (codex, NOT agy on this repo)"
assert_contains "$OUT" '"loop_convergence_verdict": "SHIP-AS-IS"' "default convergence verdict"

# 4. --field accessors
assert_eq "gpt-5.5" "$(bash "$SCRIPT" --field reviewer_engine)" "--field reviewer_engine"
assert_eq "xhigh" "$(bash "$SCRIPT" --field reviewer_effort)" "--field reviewer_effort"
assert_eq "on" "$(bash "$SCRIPT" --field independent_harness)" "--field independent_harness"

# 5. unknown field → exit 2
OUT="$(bash "$SCRIPT" --field nope 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unknown field exit code"

# 6. override precedence + enum fallback on garbage
CFG="$TEST_TMP/rl.md"
printf -- '- reviewer_effort: turbo\n- implementer_runner: rocket\n- loop_max_rounds: notanum\n- implementer_engine: my-local-model\n' > "$CFG"
assert_eq "xhigh" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field reviewer_effort)" "bad effort falls back to default"
assert_eq "auto" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field implementer_runner)" "bad runner falls back to default"
assert_eq "5" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field loop_max_rounds)" "non-numeric rounds falls back to default"
assert_eq "my-local-model" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field implementer_engine)" "valid override value is honored"
assert_eq "override" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field source)" "override source reported"

finalize_test
