#!/usr/bin/env bash
# hook-output-channel-audit.test.sh — BL-0304. A hook registered on a non-context event must not write plain text to
# stdout (the model never sees it); its model-facing message travels as one hookSpecificOutput.additionalContext object.
# Negative control: failure-escalation reverted to the old plain-text write must turn both audits red (red before green).
. "$(dirname "$0")/lib.sh"

AUDIT="$REPO_ROOT/hooks/tests/lib/hook-output-audit.js"

# --- green control on the real tree ---
OUT="$(node "$AUDIT" static "$HOOKS_DIR" 2>&1 < /dev/null)"; RC=$?
assert_exit_code "$RC" 0 "real tree: every non-context stdout write site is a JSON emitter or allowlisted"
assert_contains "$OUT" "AUDIT GREEN (static)" "static audit prints GREEN"
mkdir -p "$TEST_TMP/home-real"
OUT="$(node "$AUDIT" dynamic "$HOOKS_DIR" "$TEST_TMP/home-real" 2>&1 < /dev/null)"; RC=$?
assert_exit_code "$RC" 0 "real tree: failure-escalation L1 is one pure PostToolUse additionalContext object"
assert_contains "$OUT" "AUDIT GREEN (dynamic)" "dynamic audit prints GREEN"

# --- negative control: a hooks dir where failure-escalation writes the message as plain text again ---
NEG="$TEST_TMP/neg-hooks"
mkdir -p "$NEG"
for f in "$HOOKS_DIR"/*; do ln -s "$f" "$NEG/$(basename "$f")"; done
rm "$NEG/failure-escalation.js"
cp "$HOOKS_DIR/failure-escalation.js" "$NEG/failure-escalation.js"
sed_mutate "$NEG/failure-escalation.js" "s/emitAdditionalContext('PostToolUse', msg);/process.stdout.write(msg + '\\\\n');/" \
  || { echo "FATAL [$TEST_NAME] negative control not applied (mutation missed its anchor)" >&2; exit 1; }
OUT="$(node "$AUDIT" static "$NEG" 2>&1 < /dev/null)"; RC=$?
assert_neq "$RC" 0 "negative control: static audit is RED on plain-text failure-escalation"
assert_contains "$OUT" "failure-escalation.js:" "static audit names the offending file"
mkdir -p "$TEST_TMP/home-neg"
OUT="$(node "$AUDIT" dynamic "$NEG" "$TEST_TMP/home-neg" 2>&1 < /dev/null)"; RC=$?
assert_neq "$RC" 0 "negative control: dynamic audit is RED on plain-text failure-escalation"
assert_contains "$OUT" "not one JSON object" "dynamic audit explains why"

finalize_test
