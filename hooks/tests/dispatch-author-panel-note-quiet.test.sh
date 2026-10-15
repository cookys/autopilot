#!/usr/bin/env bash
# dispatch-author-panel-note-quiet — BL-0097: the resolver's per-seat final-panel intake notes
# ("qc_panel[N] seat ... has no recorded operator admission") describe the managed review rail's
# final panel, which the author role never touches. dispatch-author must not forward them, but
# must still forward every other resolver stderr line (failures especially), and the resolver
# itself must keep printing the notes for its other callers.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
RESOLVER="$REPO_ROOT/scripts/resolve-review-loop.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan." > "$PROMPT"

# Scratch HOME so no real ~/.autopilot qualification store or pin is consulted.
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/no-config.json"

FAKE_RUNNER="$TEST_TMP/fake-runner"
cat <<'EOF' > "$FAKE_RUNNER"
#!/usr/bin/env bash
echo "OK-WRITTEN"
exit 0
EOF
chmod +x "$FAKE_RUNNER"

NOTE='has no recorded operator admission'

CFG_DIR="$TEST_TMP/proj"
mkdir -p "$CFG_DIR/.claude"
cat <<EOF > "$CFG_DIR/.claude/review-loop-config.md"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: TESTEP
- implementer_engine: gpt-5.3-codex-spark
- qc_panel: gpt-5.5, claude-opus, gemini-flash
- qc_panel_runners: codex, claude-native, agy
- qc_panel_efforts: high, high, high
EOF

# Positive control: the resolver itself still prints the three notes for this config.
RES_ERR="$(cd "$CFG_DIR" && REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_DIR/.claude/review-loop-config.md" "$RESOLVER" 2>&1 >/dev/null)"
assert_contains "$RES_ERR" "qc_panel[0] seat" "resolver still prints qc_panel[0] intake note"
assert_contains "$RES_ERR" "qc_panel[2] seat" "resolver still prints qc_panel[2] intake note"
assert_contains "$RES_ERR" "$NOTE" "resolver still prints the admission note text"

# Case 1: a strict-roster author dispatch does not forward the notes.
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CFG_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>"$TEST_TMP/case1.stderr")"; EXIT=$?
ERR="$(cat "$TEST_TMP/case1.stderr")"
# The dispatch gets past the resolver (the unconfigured TESTEP endpoint then stops it, which is
# irrelevant here): the resolver ran, so its stderr is what we are judging.
assert_contains "$OUT" '"selection_source": "strict_roster"' "case 1: strict roster resolved (exit $EXIT)"
assert_not_contains "$ERR" "$NOTE" "case 1: admission notes are not forwarded to author stderr"
assert_not_contains "$ERR" "qc_panel[" "case 1: no per-seat panel line reaches author stderr"
# Unrelated resolver diagnostics (here the endpoint-length notice) are still forwarded.
assert_contains "$ERR" "invalid qc_panel_endpoints length" "case 1: unrelated resolver stderr is still forwarded"

# Case 2 (negative control): when the resolver FAILS, its whole stderr is forwarded, notes included.
BAD_DIR="$TEST_TMP/bad"
mkdir -p "$BAD_DIR/.claude"
cat <<EOF > "$BAD_DIR/.claude/review-loop-config.md"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: TESTEP
- implementer_engine: gpt-5.3-codex-spark
- qc_panel: gpt-5.5, claude-opus
- qc_panel_runners: codex, cursor
- qc_panel_efforts: high, high
- qc_panel_endpoints: ,
EOF
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$BAD_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>"$TEST_TMP/case2.stderr")"; EXIT=$?
ERR="$(cat "$TEST_TMP/case2.stderr")"
assert_eq "2" "$EXIT" "case 2: resolver failure fails the dispatch closed"
assert_contains "$ERR" "NOT qualified for any role" "case 2: resolver failure stderr is forwarded unfiltered"
assert_contains "$ERR" "$NOTE" "case 2: notes are kept in the failure diagnostic"

finalize_test
