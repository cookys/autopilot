#!/usr/bin/env bash
# Stage-1 reviewer qualifier tests.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"

# 1) --help exits 0
HELP_OUT="$($SCRIPT --help 2>&1)"
HELP_RC=$?
assert_exit_code "$HELP_RC" "0" "--help exits 0"
assert_contains "$HELP_OUT" "subcommand" "--help prints subcommand"

PASS_PANEL='printf '\''{"verdict":"fail"}'\'''
PARTIAL_PASS_PANEL='COUNT_FILE='"$TEST_TMP"'/engine-qualify-sens.count; N="$(cat "$COUNT_FILE" 2>/dev/null || echo 0)"; N=$((N + 1)); printf "%s" "$N" > "$COUNT_FILE"; if [ "$N" -le 8 ]; then printf "%s" '\''{"verdict":"fail"}'\''; else printf "%s" '\''{"verdict":"pass"}'\''; fi'

ALL_PASS_PANEL='printf '\''{"verdict":"pass"}'\'''

# 2) Correct panel verdicts -> qualified true, exit 0, verdict JSON on stdout
PASS_OUT="$($SCRIPT reviewer --engine eng-review --runner cc-shim --family openai --panel-cmd "$PASS_PANEL" 2>&1)"
PASS_RC=$?
assert_exit_code "$PASS_RC" "0" "all-correct panel-cmd exits 0"
assert_contains "$PASS_OUT" '"qualified":true' "qualified true when panel catches all"

# 3) Critical false-pass -> qualified false, emits failed row with --emit-row
FAIL_OUT="$($SCRIPT reviewer --engine eng-review --runner cc-shim --family openai --panel-cmd "$ALL_PASS_PANEL" --emit-row 2>&1)"
FAIL_RC=$?
assert_exit_code "$FAIL_RC" "1" "all-true panel-cmd exits 1 (qualification failed)"
assert_contains "$FAIL_OUT" '"status":"failed"' "emit-row status failed on false positive critical"
assert_not_contains "$FAIL_OUT" '"false_pass_critical":0' "critical false-pass present"

# 4) Sensitivity miss -> qualified false
SENS_OUT="$($SCRIPT reviewer --engine eng-review --runner cc-shim --family openai --panel-cmd "$PARTIAL_PASS_PANEL" 2>&1)"
SENS_RC=$?
assert_exit_code "$SENS_RC" "1" "partial-hit panel-cmd exits 1 (sensitivity fail)"
assert_contains "$SENS_OUT" '"qualified":false' "qualified false on low sensitivity"

# 5) --emit-row emits engine-scorecard row accepted by record
ROW_OUT="$($SCRIPT reviewer --engine eng-review --runner cc-shim --family openai --panel-cmd "$PASS_PANEL" --emit-row)"
RECORD_RC=0
printf '%s\n' "$ROW_OUT" | node "$REPO_ROOT/scripts/engine-scorecard.js" record >/tmp/engine-qualify-row.out 2>/tmp/engine-qualify-row.err || RECORD_RC=$?
assert_exit_code "$RECORD_RC" "0" "emit-row output is accepted by engine-scorecard record"
assert_contains "$ROW_OUT" '"source":"unknown"' "emit-row row uses cost.source=unknown"
assert_contains "$ROW_OUT" '"status":"qualified"' "emit-row on pass uses qualified status"

# 6) bad args exit 2
$SCRIPT reviewer --engine eng-review --runner cc-shim --family openai 2>/dev/null
BAD_RC=$?
assert_exit_code "$BAD_RC" "2" "missing --panel-cmd is exit 2"

$SCRIPT unknown 2>/dev/null
BAD_SUBRC=$?
assert_exit_code "$BAD_SUBRC" "2" "unknown subcommand is exit 2"

finalize_test
