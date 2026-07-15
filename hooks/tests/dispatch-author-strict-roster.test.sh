#!/usr/bin/env bash
# dispatch-author-strict-roster — strict roster authorization gates test.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan." > "$PROMPT"

export SENTINEL="$TEST_TMP/sentinel_touched"
FAKE_RUNNER="$TEST_TMP/fake-runner"
cat <<'EOF' > "$FAKE_RUNNER"
#!/usr/bin/env bash
touch "$SENTINEL"
echo "OK-WRITTEN"
exit 0
EOF
chmod +x "$FAKE_RUNNER"

assert_precondition_failed() {
  local out="$1"
  local exit_code="$2"
  local error_needle="$3"
  local desc="$4"

  assert_eq "2" "$exit_code" "$desc: exit code 2"
  assert_contains "$out" '"status": "precondition_failed"' "$desc: status precondition_failed"
  assert_contains "$out" '"raw_log": null' "$desc: raw_log null"
  assert_contains "$out" "$error_needle" "$desc: semantic diagnostic contains '$error_needle'"

  assert_file_absent "$SENTINEL" "$desc: fake-runner sentinel was never created"
  rm -f "$SENTINEL"
}

# Case 1: strict mode rejects manually supplied --runner/--model/--effort/--endpoint
# even when a valid project roster exists. Include regression string "GPT-OSS 120B (Medium)"
# only as rejected input; it must never reach a runner.
CASE1_DIR="$TEST_TMP/case1"
mkdir -p "$CASE1_DIR/.claude"
cat <<EOF > "$CASE1_DIR/.claude/review-loop-config.md"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: TESTEP
- implementer_engine: gpt-5.3-codex-spark
EOF

rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE1_DIR" --model "GPT-OSS 120B (Medium)" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?
assert_precondition_failed "$OUT" "$EXIT" "manual" "Case 1: manual model rejects"

rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE1_DIR" --runner cc-shim --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?
assert_precondition_failed "$OUT" "$EXIT" "manual" "Case 1: manual runner rejects"

rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE1_DIR" --effort high --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?
assert_precondition_failed "$OUT" "$EXIT" "manual" "Case 1: manual effort rejects"

rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE1_DIR" --endpoint TESTEP --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?
assert_precondition_failed "$OUT" "$EXIT" "manual" "Case 1: manual endpoint rejects"

# Case 2: strict mode with a consuming repo lacking .claude/review-loop-config.md fails closed.
CASE2_DIR="$TEST_TMP/case2"
mkdir -p "$CASE2_DIR"

rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 REVIEW_LOOP_CONFIG_OVERRIDE="$CASE1_DIR/.claude/review-loop-config.md" "$SCRIPT" --strict-roster --repo-root "$CASE2_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?
assert_precondition_failed "$OUT" "$EXIT" "config" "Case 2: lacking config fails closed"

# Case 3: project roster with verification_author_present:false and an empty tuple fails closed.
CASE3_DIR="$TEST_TMP/case3"
mkdir -p "$CASE3_DIR/.claude"
cat <<EOF > "$CASE3_DIR/.claude/review-loop-config.md"
- verification_author_present: false
- verification_author_engine:
- verification_author_runner:
- verification_author_effort:
- verification_author_endpoint:
- implementer_engine: gpt-5.3-codex-spark
EOF

rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE3_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?
assert_precondition_failed "$OUT" "$EXIT" "present" "Case 3: present=false empty tuple fails closed"

# Case 4: present tuple whose author is the same OpenAI family as the Spark implementer fails closed.
CASE4_DIR="$TEST_TMP/case4"
mkdir -p "$CASE4_DIR/.claude"
cat <<EOF > "$CASE4_DIR/.claude/review-loop-config.md"
- verification_author_present: true
- verification_author_engine: gpt-5.5
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint:
- implementer_engine: gpt-5.3-codex-spark
EOF

rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE4_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?
assert_precondition_failed "$OUT" "$EXIT" "family" "Case 4: same family fails closed"

# Case 5: present tuple with an unknown author family fails closed.
CASE5_DIR="$TEST_TMP/case5"
mkdir -p "$CASE5_DIR/.claude"
cat <<EOF > "$CASE5_DIR/.claude/review-loop-config.md"
- verification_author_present: true
- verification_author_engine: unknown-spec-engine-name
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint:
- implementer_engine: gpt-5.3-codex-spark
EOF

rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE5_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?
assert_precondition_failed "$OUT" "$EXIT" "unknown" "Case 5: unknown family fails closed"

# Case 6: present=true but incomplete tuple (missing/empty runner) fails closed.
CASE6_DIR="$TEST_TMP/case6"
mkdir -p "$CASE6_DIR/.claude"
cat <<EOF > "$CASE6_DIR/.claude/review-loop-config.md"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner:
- verification_author_effort: high
- verification_author_endpoint:
- implementer_engine: gpt-5.3-codex-spark
EOF

rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE6_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?
assert_precondition_failed "$OUT" "$EXIT" "incomplete" "Case 6: incomplete tuple fails closed"

# Case 7: an isolated tracked roster selects the Grok 4.5 verification author
# for the Spark implementer without allowing caller-supplied tuple flags.
CASE7_DIR="$TEST_TMP/case7"
mkdir -p "$CASE7_DIR/.claude"
cat <<'EOF' > "$CASE7_DIR/.claude/review-loop-config.md"
- verification_author_present: true
- verification_author_engine: grok-4.5
- verification_author_runner: grok
- verification_author_effort: high
- verification_author_endpoint:
- implementer_engine: gpt-5.3-codex-spark
EOF

GROK_ARGS="$TEST_TMP/grok-args"
export GROK_ARGS
FAKE_GROK_RUNNER="$TEST_TMP/fake-grok-runner"
cat <<'EOF' > "$FAKE_GROK_RUNNER"
#!/usr/bin/env bash
printf '%s\n' "$@" > "$GROK_ARGS"
touch "$SENTINEL"
printf '%s\n' "GROK-AUTHORED"
EOF
chmod +x "$FAKE_GROK_RUNNER"

rm -f "$SENTINEL" "$GROK_ARGS"
OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --strict-roster --repo-root "$CASE7_DIR" --prompt-file "$PROMPT" --bin "$FAKE_GROK_RUNNER" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 7: tracked Grok roster succeeds"
assert_contains "$OUT" '"status": "authored"' "Case 7: status authored"
assert_contains "$OUT" '"selection_source": "strict_roster"' "Case 7: strict_roster selection"
assert_contains "$OUT" '"selection_path": "'"$CASE7_DIR/.claude/review-loop-config.md"'"' "Case 7: selection path is temporary repo config"
assert_contains "$OUT" '"verification_author": { "engine": "grok-4.5", "runner": "grok", "effort": "high", "endpoint": "", "family": "xai" }' "Case 7: resolved Grok verification-author tuple"
assert_file_exists "$SENTINEL" "Case 7: fake Grok runner executed"
GROK_ARG_TEXT="$(cat "$GROK_ARGS")"
assert_contains "$GROK_ARG_TEXT" '--prompt-file' "Case 7: Grok prompt-file composition"
assert_contains "$GROK_ARG_TEXT" 'grok-4.5' "Case 7: Grok model composition"
assert_contains "$GROK_ARG_TEXT" '--output-format' "Case 7: Grok output-format composition"
assert_contains "$GROK_ARG_TEXT" 'plain' "Case 7: Grok plain output composition"
assert_contains "$GROK_ARG_TEXT" '--disable-web-search' "Case 7: Grok web-search disabled"
assert_not_contains "$GROK_ARG_TEXT" '--runner' "Case 7: no manual runner flag"
assert_not_contains "$GROK_ARG_TEXT" '--effort' "Case 7: no manual effort flag"
assert_not_contains "$GROK_ARG_TEXT" '--endpoint' "Case 7: no manual endpoint flag"

finalize_test
