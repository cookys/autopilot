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
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE2_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?
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

finalize_test
